"""Speech-to-text service for AccessRoute (Whisper), designed to run on the DGX Spark GPU.

Runs as your own user, no Docker or admin rights needed. Listens on 127.0.0.1 only; the
laptop reaches it through an SSH tunnel, exactly like Ollama. See docs/VOICE.md.

    ~/asr/bin/python asr_server.py            # GPU if available, else CPU
    ASR_MODEL=openai/whisper-base.en python asr_server.py   # smaller model (e.g. laptop CPU)

Input: a WAV file (16-bit PCM, mono or stereo, 8–48 kHz). The browser converts the recording
to 16 kHz mono WAV, so no ffmpeg is needed anywhere.

Endpoints
    GET  /health      -> {"status": "ready"|"loading"|"error", "model", "device", ...}
    POST /transcribe  -> {"text", "duration_s", "speech_detected", "warnings", "model", "device"}
"""
import io
import os
from contextlib import asynccontextmanager
import re
import threading
import time
import wave

import numpy as np
from fastapi import FastAPI, HTTPException, UploadFile

MODEL_ID = os.environ.get("ASR_MODEL", "openai/whisper-large-v3-turbo")
HOST = os.environ.get("ASR_HOST", "127.0.0.1")
PORT = int(os.environ.get("ASR_PORT", "9100"))
MAX_BYTES = 10 * 1024 * 1024
MIN_SECONDS = 0.5
MAX_SECONDS = 90.0
TARGET_RATE = 16_000
SILENCE_RMS = 0.006  # below this the clip is treated as silence (float audio in [-1, 1])

# Phrases Whisper is known to invent from silence or noise (training-data artefacts).
HALLUCINATIONS = re.compile(
    r"^\W*(thank you( very much)?( for watching| for listening)?|thanks for watching|"
    r"subtitles by.*|please subscribe.*|you|bye( bye)?|\.+|♪+|music)\W*$",
    re.IGNORECASE,
)

_state = {"status": "loading", "error": None, "device": None, "pipe": None, "loaded_at": None}
_gpu_lock = threading.Lock()


def build_pipeline():
    """Load Whisper. Separate function so tests can replace it with a stub."""
    import torch
    from transformers import pipeline

    cuda = torch.cuda.is_available()
    device = "cuda:0" if cuda else "cpu"
    dtype = torch.float16 if cuda else torch.float32
    try:
        pipe = pipeline("automatic-speech-recognition", model=MODEL_ID, dtype=dtype, device=device)
    except TypeError:  # older transformers versions
        pipe = pipeline("automatic-speech-recognition", model=MODEL_ID, torch_dtype=dtype, device=device)
    return pipe, (torch.cuda.get_device_name(0) if cuda else "cpu")


def generate_kwargs():
    # English-only checkpoints (*.en) reject language/task arguments.
    return {} if MODEL_ID.endswith(".en") else {"language": "english", "task": "transcribe"}


def load_model():
    try:
        pipe, device = build_pipeline()
        # Warm-up so the first real request is fast (also catches GPU problems early).
        run_pipe(np.zeros(TARGET_RATE, dtype=np.float32), pipe)
        _state.update(status="ready", pipe=pipe, device=device, loaded_at=time.time())
    except Exception as exc:  # noqa: BLE001 - report any load failure through /health
        _state.update(status="error", error=f"{type(exc).__name__}: {exc}")


@asynccontextmanager
async def lifespan(_app):
    # Load in the background so /health answers ("loading") while the model downloads/loads.
    threading.Thread(target=load_model, daemon=True).start()
    yield


app = FastAPI(title="AccessRoute speech-to-text", lifespan=lifespan)


def read_wav(data: bytes) -> tuple[np.ndarray, int]:
    """Decode 16-bit PCM WAV to mono float32 in [-1, 1]. Raises ValueError for anything else."""
    if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("Audio must be a WAV file.")
    try:
        with wave.open(io.BytesIO(data)) as wav:
            channels, width, rate, frames = wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()
            raw = wav.readframes(frames)
    except (wave.Error, EOFError) as exc:
        raise ValueError("The WAV file is damaged or incomplete.") from exc
    if width != 2:
        raise ValueError("Audio must be 16-bit PCM.")
    if not 8_000 <= rate <= 48_000 or channels not in (1, 2):
        raise ValueError("Unsupported sample rate or channel count.")
    samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if channels == 2:
        samples = samples[: len(samples) // 2 * 2].reshape(-1, 2).mean(axis=1)
    return samples, rate


def resample(samples: np.ndarray, rate: int) -> np.ndarray:
    if rate == TARGET_RATE or len(samples) == 0:
        return samples
    count = int(round(len(samples) * TARGET_RATE / rate))
    positions = np.linspace(0, len(samples) - 1, count)
    return np.interp(positions, np.arange(len(samples)), samples).astype(np.float32)


def run_pipe(samples: np.ndarray, pipe=None):
    pipe = pipe or _state["pipe"]
    with _gpu_lock:  # one transcription at a time on the GPU
        try:
            return pipe({"raw": samples, "sampling_rate": TARGET_RATE},
                        chunk_length_s=30, generate_kwargs=generate_kwargs())
        except (TypeError, ValueError):
            # Some transformers versions reject an option: retry with the minimum.
            return pipe({"raw": samples, "sampling_rate": TARGET_RATE})


def clean_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return "" if HALLUCINATIONS.match(text) else text


@app.get("/health")
def health():
    return {"status": _state["status"], "model": MODEL_ID, "device": _state["device"], "error": _state["error"]}


@app.post("/transcribe")
async def transcribe(file: UploadFile):
    if _state["status"] != "ready":
        raise HTTPException(503, "The speech model is still loading." if _state["status"] == "loading"
                            else f"The speech model failed to load: {_state['error']}")
    data = await file.read(MAX_BYTES + 1)
    await file.close()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Recording is too large.")
    try:
        samples, rate = read_wav(data)
    except ValueError as exc:
        raise HTTPException(415, str(exc)) from exc
    duration = len(samples) / rate
    if duration < MIN_SECONDS:
        raise HTTPException(422, "Recording is too short.")
    if duration > MAX_SECONDS:
        raise HTTPException(422, f"Recording is longer than {int(MAX_SECONDS)} seconds.")
    samples = resample(samples, rate)
    rms = float(np.sqrt(np.mean(np.square(samples)))) if len(samples) else 0.0
    base = {"duration_s": round(duration, 2), "model": MODEL_ID, "device": _state["device"]}
    if rms < SILENCE_RMS:
        return {**base, "text": "", "speech_detected": False, "warnings": ["No speech was detected."]}
    peak = float(np.max(np.abs(samples)))
    if peak > 0:
        samples = samples / peak * 0.9  # normalise quiet recordings
    started = time.perf_counter()
    try:
        result = run_pipe(samples)
    except Exception as exc:  # noqa: BLE001 - never crash the service on one bad request
        raise HTTPException(500, f"Transcription failed: {type(exc).__name__}") from exc
    text = clean_text(result.get("text", "") if isinstance(result, dict) else "")
    warnings = [] if text else ["Speech was too unclear to transcribe."]
    if 0 < len(text.split()) < 3:
        warnings.append("Only a few words were recognised.")
    return {**base, "text": text, "speech_detected": bool(text), "warnings": warnings,
            "seconds": round(time.perf_counter() - started, 2)}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT)
