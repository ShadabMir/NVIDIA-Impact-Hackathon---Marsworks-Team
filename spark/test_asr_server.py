"""Tests for the speech service with Whisper replaced by a stub (run: python -m pytest spark -q)."""
import io
import time
import wave

import numpy as np
import pytest
from fastapi.testclient import TestClient

import asr_server


def wav_bytes(seconds=2.0, rate=16_000, channels=1, amplitude=0.3, width=2):
    count = int(seconds * rate)
    tone = (amplitude * np.sin(2 * np.pi * 220 * np.arange(count) / rate)) if amplitude else np.zeros(count)
    pcm = (tone * 32767).astype("<i2")
    if channels == 2:
        pcm = np.repeat(pcm, 2)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(width)
        wav.setframerate(rate)
        wav.writeframes(pcm.tobytes() if width == 2 else (pcm // 256).astype("i1").tobytes())
    return buffer.getvalue()


class FakePipe:
    def __init__(self, text="My appointment is on Monday at half ten"):
        self.text = text
        self.calls = []

    def __call__(self, audio, **kwargs):
        self.calls.append(audio)
        return {"text": self.text}


@pytest.fixture
def make_client(monkeypatch):
    def factory(pipe=None, fail=False):
        pipe = pipe or FakePipe()

        def build():
            if fail:
                raise RuntimeError("CUDA out of memory")
            return pipe, "Fake GPU"

        monkeypatch.setattr(asr_server, "build_pipeline", build)
        asr_server._state.update(status="loading", error=None, pipe=None, device=None)
        client = TestClient(asr_server.app)
        client.__enter__()
        for _ in range(100):
            if asr_server._state["status"] != "loading":
                break
            time.sleep(0.01)
        return client, pipe

    return factory


def post(client, data, name="a.wav"):
    return client.post("/transcribe", files={"file": (name, data, "audio/wav")})


def test_transcribes_speech(make_client):
    client, pipe = make_client()
    assert client.get("/health").json()["status"] == "ready"
    body = post(client, wav_bytes()).json()
    assert body["text"].startswith("My appointment") and body["speech_detected"] is True
    assert body["device"] == "Fake GPU" and body["warnings"] == []
    assert pipe.calls[-1]["sampling_rate"] == 16_000


def test_silence_skips_the_model(make_client):
    client, pipe = make_client()
    calls_after_warmup = len(pipe.calls)
    body = post(client, wav_bytes(amplitude=0)).json()
    assert body["speech_detected"] is False and body["text"] == ""
    assert len(pipe.calls) == calls_after_warmup  # Whisper never ran on silence


@pytest.mark.parametrize("phrase", ["Thank you for watching.", " you ", "♪♪", "Thanks for watching!"])
def test_known_hallucinations_are_dropped(make_client, phrase):
    client, _ = make_client(FakePipe(phrase))
    body = post(client, wav_bytes()).json()
    assert body["text"] == "" and body["speech_detected"] is False and body["warnings"]


def test_stereo_and_48khz_are_converted(make_client):
    client, pipe = make_client()
    assert post(client, wav_bytes(rate=48_000, channels=2)).status_code == 200
    assert len(pipe.calls[-1]["raw"]) == pytest.approx(2 * 16_000, abs=2)


@pytest.mark.parametrize("data,code", [
    (b"not audio at all" * 10, 415),
    (wav_bytes()[:60], 415),            # truncated header/data still parses as tiny -> too short or damaged
    (wav_bytes(width=1), 415),          # 8-bit PCM
    (wav_bytes(seconds=0.2), 422),      # too short
    (wav_bytes(seconds=95, rate=8_000), 422),  # too long
])
def test_bad_audio_is_rejected_cleanly(make_client, data, code):
    client, _ = make_client()
    response = post(client, data)
    assert response.status_code in {code, 415, 422}
    assert "detail" in response.json()


def test_model_failure_is_reported_not_crashing(make_client):
    client, _ = make_client(fail=True)
    health = client.get("/health").json()
    assert health["status"] == "error" and "out of memory" in health["error"]
    assert post(client, wav_bytes()).status_code == 503


def test_few_words_warns(make_client):
    client, _ = make_client(FakePipe("Monday"))
    body = post(client, wav_bytes()).json()
    assert body["text"] == "Monday" and any("few words" in w for w in body["warnings"])


class PickyPipe(FakePipe):
    """Rejects call-time options, like some transformers versions."""
    def __call__(self, audio, **kwargs):
        if kwargs:
            raise TypeError("unexpected keyword argument 'chunk_length_s'")
        return super().__call__(audio)


class BrokenPipe(FakePipe):
    def __call__(self, audio, **kwargs):
        if len(audio["raw"]) > 16_000:  # warm-up (1 s) succeeds, real requests fail
            raise RuntimeError("CUDA error: device-side assert")
        return {"text": ""}


def test_retries_without_unsupported_options(make_client):
    client, _ = make_client(PickyPipe())
    assert client.get("/health").json()["status"] == "ready"
    assert post(client, wav_bytes()).json()["speech_detected"] is True


def test_runtime_failure_returns_error_not_crash(make_client):
    client, _ = make_client(BrokenPipe())
    response = post(client, wav_bytes())
    assert response.status_code == 500 and "Transcription failed" in response.json()["detail"]
    assert client.get("/health").json()["status"] == "ready"  # service still alive
