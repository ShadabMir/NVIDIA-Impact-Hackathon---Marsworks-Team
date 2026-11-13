from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def journey():
    return {
        "appointment": {
            "hospital_id": "northern-general-demo",
            "department": "Demo outpatient department",
            "arrive_by": "2026-11-20T10:00:00+00:00",
            "confirmed_by_user": True,
        },
        "access": {"step_free_required": True},
    }


def test_walking_transfer_and_unknown_access_are_enforced():
    response = client.post("/api/v1/journeys/plan", json=journey())
    assert response.status_code == 200
    data = response.json()
    assert data["data_status"] == "simulated"
    assert data["recommended_route_id"] == "demo-direct"
    results = {item["route"]["id"]: item for item in data["assessments"]}
    assert results["demo-short-transfer"]["status"] == "rejected"
    assert len(results["demo-short-transfer"]["reasons"]) >= 3
    assert results["demo-unknown-access"]["status"] == "needs_verification"
    assert results["demo-direct"]["leave_at"] == "2026-11-20T09:15:00Z"


def test_disruption_triggers_support_instead_of_recommending_unknown_access():
    payload = {"journey": journey(), "disruption": {"unavailable_route_ids": ["demo-direct"]}}
    data = client.post("/api/v1/journeys/reassess", json=payload).json()
    assert data["support_needed"] is True
    assert data["recommended_route_id"] is None
    draft = client.post("/api/v1/support/draft", json=payload).json()
    assert draft["sent"] is False
    assert "Route is unavailable" in draft["body"]


def test_delay_cannot_require_departure_before_earliest_departure():
    payload = {
        "journey": journey(),
        "disruption": {"delay_minutes_by_route": {"demo-direct": 30}},
        "earliest_departure": "2026-11-20T09:00:00+00:00",
    }
    data = client.post("/api/v1/journeys/reassess", json=payload).json()
    assert data["recommended_route_id"] is None


def test_confirmation_and_timezone_required():
    payload = journey()
    payload["appointment"]["confirmed_by_user"] = False
    assert client.post("/api/v1/journeys/plan", json=payload).status_code == 422
    payload = journey()
    payload["appointment"]["arrive_by"] = "2026-11-20T10:00:00"
    assert client.post("/api/v1/journeys/plan", json=payload).status_code == 422


def test_unknown_route_and_negative_delay_rejected():
    for disruption in [
        {"unavailable_route_ids": ["invented"]},
        {"delay_minutes_by_route": {"demo-direct": -5}},
    ]:
        assert client.post("/api/v1/journeys/reassess", json={
            "journey": journey(), "disruption": disruption,
        }).status_code == 422


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
            details=AppointmentExtraction(hospital="Northern General Hospital"),
            model="test-model",
        )

    monkeypatch.setattr("app.main.extract_appointment", fake_extract)
    response = client.post("/api/v1/appointments/extract", files={
        "file": ("letter.png", b"\x89PNG\r\n\x1a\nfixture", "image/png"),
    })
    assert response.status_code == 200
    assert response.json()["requires_confirmation"] is True
    assert response.json()["details"]["appointment_time"] is None
