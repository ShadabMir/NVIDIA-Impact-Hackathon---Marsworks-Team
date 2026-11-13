from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_upload_rejects_unsupported_files():
    response = client.post("/api/v1/appointments/extract", files={
        "file": ("letter.pdf", b"%PDF", "application/pdf"),
    })
    assert response.status_code == 415
    response = client.post("/api/v1/appointments/extract", files={
        "file": ("letter.png", b"not an image", "image/png"),
    })
    assert response.status_code == 415


def test_extraction_contract_without_real_model(monkeypatch):
    from app.schemas import AppointmentExtraction, ExtractionResponse

    async def fake_extract(data, settings):
        return ExtractionResponse(
            details=AppointmentExtraction(hospital="Royal Hallamshire Hospital"),
            model="test-model",
        )

    monkeypatch.setattr("app.main.extract_appointment", fake_extract)
    response = client.post("/api/v1/appointments/extract", files={
        "file": ("letter.png", b"\x89PNG\r\n\x1a\nfixture", "image/png"),
    })
    assert response.status_code == 200
    assert response.json()["requires_confirmation"] is True
    assert response.json()["details"]["appointment_time"] is None
