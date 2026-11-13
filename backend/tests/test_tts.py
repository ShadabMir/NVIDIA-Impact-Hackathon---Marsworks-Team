import io
import wave

import httpx
from fastapi.testclient import TestClient

from app import tts
from app.main_tts import app

client = TestClient(app)


def make_wav(frames: int, rate: int = 24000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(rate)
        writer.writeframes(b"\x00\x00" * frames)
    return buffer.getvalue()


def fake_nim(monkeypatch, handler):
    monkeypatch.setenv("TTS_BASE_URL", "http://spark.test:9000")
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(tts, "make_client", lambda timeout: httpx.AsyncClient(transport=transport))


def test_split_text_respects_limit_and_keeps_all_words():
    text = "Turn left now. " * 60 + "x" * 600
    chunks = tts.split_text(text)
    assert all(0 < len(c) <= tts.CHUNK_LIMIT for c in chunks)
    assert "".join(chunks).replace(" ", "") == text.replace(" ", "")


def test_not_configured_returns_503(monkeypatch):
    monkeypatch.setenv("TTS_BASE_URL", "")
    assert client.post("/api/v1/tts", json={"text": "Hello"}).status_code == 503
    assert client.get("/api/v1/tts/health").status_code == 503


def test_synthesize_sends_form_fields_and_joins_chunks(monkeypatch):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.content.decode())
        return httpx.Response(200, content=make_wav(100), headers={"Content-Type": "audio/wav"})

    fake_nim(monkeypatch, handler)
    text = "Your route has changed. " * 40  # about 960 characters, so more than one chunk
    response = client.post("/api/v1/tts", json={"text": text})
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert len(calls) >= 2
    assert "Chatterbox-Multilingual.en-US.Male" in calls[0]
    with wave.open(io.BytesIO(response.content), "rb") as reader:
        assert reader.getnframes() == 100 * len(calls)


def test_upstream_error_returns_502(monkeypatch):
    fake_nim(monkeypatch, lambda request: httpx.Response(500))
    assert client.post("/api/v1/tts", json={"text": "Hello"}).status_code == 502


def test_mismatched_audio_formats_return_502(monkeypatch):
    rates = iter([24000, 22050])
    fake_nim(monkeypatch, lambda request: httpx.Response(200, content=make_wav(10, next(rates))))
    text = "A sentence. " * 60
    assert client.post("/api/v1/tts", json={"text": text}).status_code == 502


def test_empty_and_too_long_text_rejected():
    assert client.post("/api/v1/tts", json={"text": ""}).status_code == 422
    assert client.post("/api/v1/tts", json={"text": "a" * 2001}).status_code == 422


def test_health_ready(monkeypatch):
    fake_nim(monkeypatch, lambda request: httpx.Response(200, json={"status": "ready"}))
    response = client.get("/api/v1/tts/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ready"


def test_existing_routes_still_present():
    paths = set(client.get("/openapi.json").json()["paths"])
    assert {"/health", "/api/v1/journeys/plan", "/api/v1/tts", "/api/v1/tts/health"} <= paths
