"""Text-to-speech via a speech model running locally on the DGX Spark.

Additive module: it does not change any existing route. Start the API with
``python -m uvicorn app.main_tts:app`` to include these endpoints (see backend/TTS.md).

The default target is the Chatterbox TTS Multilingual NIM container, which exposes
``POST /v1/audio/synthesize`` (multipart form fields) on port 9000. Point TTS_BASE_URL at the
container on the Spark. Never point it at a hosted cloud endpoint: the hackathon requires
local models.
"""

import io
import re
import wave

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Chatterbox rejects more than 500 characters per request; keep a margin for normalisation.
CHUNK_LIMIT = 450
MAX_TEXT = 2000


class TtsSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    tts_base_url: str = ""  # e.g. http://127.0.0.1:9000 when the NIM runs on the Spark
    tts_voice: str = "Chatterbox-Multilingual.en-US.Male"
    tts_language: str = "en-US"
    tts_timeout_seconds: float = Field(default=30, gt=0, le=120)


class TtsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=MAX_TEXT)


def get_tts_settings() -> TtsSettings:
    return TtsSettings()


def make_client(timeout: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout)


def split_text(text: str, limit: int = CHUNK_LIMIT) -> list[str]:
    """Split text into sentence-based chunks of at most ``limit`` characters."""
    text = " ".join(text.split())
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        while len(sentence) > limit:  # a single very long sentence: break at a space
            cut = sentence.rfind(" ", 0, limit)
            cut = cut if cut > 0 else limit
            if current:
                chunks.append(current)
                current = ""
            chunks.append(sentence[:cut].strip())
            sentence = sentence[cut:].strip()
        if not sentence:
            continue
        candidate = f"{current} {sentence}".strip()
        if len(candidate) <= limit:
            current = candidate
        else:
            chunks.append(current)
            current = sentence
    if current:
        chunks.append(current)
    return [c for c in chunks if c]


def join_wavs(parts: list[bytes]) -> bytes:
    """Concatenate WAV files that share the same format into one WAV file."""
    if len(parts) == 1:
        return parts[0]
    out = io.BytesIO()
    params = None
    with wave.open(out, "wb") as writer:
        for part in parts:
            with wave.open(io.BytesIO(part), "rb") as reader:
                current = (reader.getnchannels(), reader.getsampwidth(), reader.getframerate())
                if params is None:
                    params = current
                    writer.setnchannels(current[0])
                    writer.setsampwidth(current[1])
                    writer.setframerate(current[2])
                elif current != params:
                    raise ValueError("Audio chunks use different formats.")
                writer.writeframes(reader.readframes(reader.getnframes()))
    return out.getvalue()


router = APIRouter(prefix="/api/v1/tts", tags=["Text to speech"])


@router.get("/health")
async def tts_health():
    settings = get_tts_settings()
    if not settings.tts_base_url:
        raise HTTPException(503, "TTS_BASE_URL is not configured; the app will use the browser voice.")
    try:
        async with make_client(5) as client:
            response = await client.get(f"{settings.tts_base_url.rstrip('/')}/v1/health/ready")
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(503, "The speech model on the Spark is not ready.") from exc
    return {"status": "ready", "voice": settings.tts_voice, "language": settings.tts_language}


@router.post(
    "",
    response_class=Response,
    responses={200: {"content": {"audio/wav": {}}, "description": "Spoken audio as WAV"}},
)
async def synthesize(request: TtsRequest):
    settings = get_tts_settings()
    if not settings.tts_base_url:
        raise HTTPException(503, "TTS_BASE_URL is not configured; the app will use the browser voice.")
    chunks = split_text(request.text)
    if not chunks:
        raise HTTPException(422, "No text to speak.")
    url = f"{settings.tts_base_url.rstrip('/')}/v1/audio/synthesize"
    parts: list[bytes] = []
    try:
        async with make_client(settings.tts_timeout_seconds) as client:
            for chunk in chunks:
                response = await client.post(url, data={
                    "text": chunk,
                    "language": settings.tts_language,
                    "voice": settings.tts_voice,
                })
                response.raise_for_status()
                parts.append(response.content)
        audio = join_wavs(parts)
    except httpx.TimeoutException as exc:
        raise HTTPException(504, "The speech model timed out.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, "The speech model could not produce audio.") from exc
    except (wave.Error, EOFError, ValueError) as exc:
        raise HTTPException(502, "The speech model returned audio in an unexpected format.") from exc
    return Response(content=audio, media_type="audio/wav")
