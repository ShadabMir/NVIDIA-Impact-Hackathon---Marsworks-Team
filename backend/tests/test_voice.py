"""Voice input: every way speech, the speech service or the model can go wrong."""
import io
import json
import wave
from datetime import date

import httpx
import pytest
from fastapi.testclient import TestClient

from app import voice
from app.config import get_settings
from app.main import app
from app.services import llm

client = TestClient(app)
TODAY = date(2026, 11, 13)  # a Friday


def wav(seconds=2.0):
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(16_000)
        out.writeframes(b"\x10\x00" * int(16_000 * seconds))
    return buffer.getvalue()


@pytest.fixture(autouse=True)
def setup(monkeypatch):
    monkeypatch.setattr(get_settings(), "asr_base_url", "http://speech.test")
    monkeypatch.setattr(voice, "today_london", lambda: TODAY)


def fake_asr(monkeypatch, handler):
    monkeypatch.setattr(voice, "make_asr_client",
                        lambda timeout: httpx.AsyncClient(transport=httpx.MockTransport(handler)))


def heard(text, warnings=()):
    return lambda request: httpx.Response(200, json={"text": text, "warnings": list(warnings),
                                                     "model": "whisper-test", "duration_s": 3.2})


def fake_model(monkeypatch, fields=None, raw=None, fail=False):
    calls = []

    def handler(request):
        calls.append(json.loads(request.content))
        if fail:
            raise httpx.ConnectError("Spark unreachable")
        content = raw if raw is not None else json.dumps(fields)
        return httpx.Response(200, json={"message": {"role": "assistant", "content": content}})

    monkeypatch.setattr(llm, "make_client", lambda s: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    return calls


def say(audio=None):
    return client.post("/api/v1/appointments/voice", files={"file": ("speech.wav", audio or wav(), "audio/wav")})


GOOD = {"hospital": "Royal Hallamshire Hospital", "department": "Neuro-Rehabilitation Outpatients",
        "appointment_date": "2026-11-16", "appointment_time": "10:30", "arrival_time": None,
        "starting_place": "Walkley"}


def test_happy_path_fills_details_and_suggests_arrival(monkeypatch):
    fake_asr(monkeypatch, heard("It's neuro rehab at the Hallamshire next Monday at half ten, from Walkley"))
    calls = fake_model(monkeypatch, GOOD)
    body = say().json()
    d = body["details"]
    assert body["extraction"] == "model" and body["requires_confirmation"] is True
    assert d == {"hospital_id": "royal-hallamshire", "hospital_said": "Royal Hallamshire Hospital",
                 "department": "Neuro-Rehabilitation Outpatients", "date": "2026-11-16",
                 "appointment_time": "10:30", "arrival": "10:15", "origin": "Walkley"}
    assert any("15 minutes before" in w for w in body["warnings"])
    system_prompt = calls[0]["messages"][0]["content"]
    assert "Friday 13 November 2026" in system_prompt and "untrusted" in system_prompt


def test_silence_returns_guidance_without_calling_the_model(monkeypatch):
    fake_asr(monkeypatch, heard("", ["No speech was detected."]))
    calls = fake_model(monkeypatch, GOOD)
    response = say()
    assert response.status_code == 200
    body = response.json()
    assert body["transcript"] == "" and body["extraction"] == "none" and body["details"]["date"] is None
    assert "No speech was detected." in body["warnings"] and calls == []


@pytest.mark.parametrize("fields,expected_warning", [
    ({**GOOD, "appointment_date": "2026-02-30"}, "couldn't understand the date"),
    ({**GOOD, "appointment_date": "2025-01-10"}, "in the past"),
    ({**GOOD, "appointment_date": "2029-01-10"}, "more than a year away"),
    ({**GOOD, "appointment_time": "25:99"}, "couldn't understand the appointment time"),
    ({**GOOD, "appointment_time": "03:00"}, "unusual"),
    ({**GOOD, "arrival_time": "11:00"}, "after the appointment time"),
    ({**GOOD, "department": None}, "didn't catch the clinic"),
    ({**GOOD, "appointment_date": None}, "didn't catch the appointment date"),
    ({**GOOD, "appointment_time": None}, "didn't catch a time"),
    ({**GOOD, "hospital": "Northern General"}, "Royal Hallamshire Hospital only"),
])
def test_doubtful_values_are_flagged(monkeypatch, fields, expected_warning):
    fake_asr(monkeypatch, heard("something about my appointment"))
    fake_model(monkeypatch, fields)
    body = say().json()
    assert any(expected_warning in w for w in body["warnings"]), body["warnings"]


def test_impossible_values_are_dropped_not_passed_on(monkeypatch):
    fake_asr(monkeypatch, heard("some words"))
    fake_model(monkeypatch, {**GOOD, "appointment_date": "next week", "appointment_time": "teatime",
                             "hospital": "Northern General"})
    d = say().json()["details"]
    assert d["date"] is None and d["appointment_time"] is None and d["arrival"] is None
    assert d["hospital_id"] is None and d["hospital_said"] == "Northern General"


def test_time_formats_are_normalised(monkeypatch):
    fake_asr(monkeypatch, heard("two pm"))
    fake_model(monkeypatch, {**GOOD, "appointment_time": "2:00 PM", "arrival_time": "13.45"})
    d = say().json()["details"]
    assert d["appointment_time"] == "14:00" and d["arrival"] == "13:45"


@pytest.mark.parametrize("model_kwargs", [{"fail": True}, {"raw": "not json"}, {"raw": "[1, 2]"}])
def test_model_problems_keep_the_transcript(monkeypatch, model_kwargs):
    fake_asr(monkeypatch, heard("neuro rehab Monday half ten"))
    fake_model(monkeypatch, **model_kwargs)
    response = say()
    assert response.status_code == 200
    body = response.json()
    assert body["transcript"] == "neuro rehab Monday half ten" and body["extraction"] == "unavailable"
    assert body["details"]["date"] is None and body["warnings"]


@pytest.mark.parametrize("handler,status", [
    (lambda r: (_ for _ in ()).throw(httpx.ConnectError("refused")), 503),
    (lambda r: (_ for _ in ()).throw(httpx.ReadTimeout("slow")), 504),
    (lambda r: httpx.Response(422, json={"detail": "Recording is too short."}), 422),
    (lambda r: httpx.Response(415, json={"detail": "Audio must be a WAV file."}), 422),
    (lambda r: httpx.Response(503, json={"detail": "The speech model is still loading."}), 503),
    (lambda r: httpx.Response(500, json={"detail": "Transcription failed: RuntimeError"}), 502),
    (lambda r: httpx.Response(200, content=b"<html>proxy error</html>"), 502),
])
def test_speech_service_failures_become_clear_errors(monkeypatch, handler, status):
    fake_asr(monkeypatch, handler)
    response = say()
    assert response.status_code == status
    assert isinstance(response.json()["detail"], str) and response.json()["detail"]


def test_not_configured(monkeypatch):
    monkeypatch.setattr(get_settings(), "asr_base_url", "")
    assert say().status_code == 503
    assert client.get("/api/v1/appointments/voice/health").json() == {"status": "not_configured"}


@pytest.mark.parametrize("audio,status", [(b"this is not audio" * 5, 415), (b"RIFF" + b"\x00" * (11 * 1024 * 1024), 413)])
def test_bad_uploads_rejected_before_the_speech_service(monkeypatch, audio, status):
    def handler(request):
        raise AssertionError("must not be called")
    fake_asr(monkeypatch, handler)
    assert say(audio).status_code == status


def test_health_reports_unreachable_and_ready(monkeypatch):
    fake_asr(monkeypatch, lambda r: (_ for _ in ()).throw(httpx.ConnectError("down")))
    assert client.get("/api/v1/appointments/voice/health").json() == {"status": "unreachable"}
    fake_asr(monkeypatch, lambda r: httpx.Response(200, json={"status": "ready", "model": "w", "device": "NVIDIA GB10"}))
    assert client.get("/api/v1/appointments/voice/health").json()["device"] == "NVIDIA GB10"


def test_corrected_transcript_is_re_read(monkeypatch):
    fake_model(monkeypatch, GOOD)
    body = client.post("/api/v1/appointments/voice/text", json={"transcript": "  neuro rehab   monday half ten "}).json()
    assert body["transcript"] == "neuro rehab monday half ten" and body["details"]["date"] == "2026-11-16"
    assert client.post("/api/v1/appointments/voice/text", json={"transcript": "   "}).status_code == 422
    assert client.post("/api/v1/appointments/voice/text", json={"transcript": "x" * 1001}).status_code == 422


def test_contract_with_the_real_speech_service_code(monkeypatch):
    """Backend -> the actual spark/asr_server.py app (Whisper stubbed) -> Nemotron (stubbed)."""
    import sys
    from pathlib import Path

    # The speech service needs numpy, which is installed with it on the Spark, not in the backend venv.
    pytest.importorskip("numpy", reason="speech service dependency (numpy) not installed here")
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "spark"))
    import asr_server

    class Pipe:
        def __call__(self, audio, **kwargs):
            return {"text": " Neuro rehab at the Hallamshire, next Monday at half ten. "}

    monkeypatch.setitem(asr_server._state, "status", "ready")
    monkeypatch.setitem(asr_server._state, "pipe", Pipe())
    monkeypatch.setitem(asr_server._state, "device", "Fake GB10")
    monkeypatch.setattr(voice, "make_asr_client", lambda timeout: httpx.AsyncClient(
        transport=httpx.ASGITransport(app=asr_server.app), base_url="http://speech.test"))
    fake_model(monkeypatch, GOOD)
    loud = io.BytesIO()
    with wave.open(loud, "wb") as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(16_000)
        out.writeframes((b"\x00\x30\x00\xd0") * 16_000)  # 2 s of loud square wave
    body = say(loud.getvalue()).json()
    assert body["transcript"] == "Neuro rehab at the Hallamshire, next Monday at half ten."
    assert body["details"]["date"] == "2026-11-16" and body["speech_model"] == asr_server.MODEL_ID
    quiet = say(wav()).json()  # near-silent audio: service says no speech, model never asked
    assert quiet["transcript"] == "" and quiet["extraction"] == "none"
