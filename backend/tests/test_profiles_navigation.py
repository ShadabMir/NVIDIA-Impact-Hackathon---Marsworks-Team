import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "database_path", str(tmp_path / "test.sqlite3"))
    monkeypatch.setattr(get_settings(), "ors_api_key", "")
    with TestClient(app) as instance:
        yield instance


def registration(email="demo@example.test"):
    return {
        "first_name": "Demo", "last_name": "Patient", "email": email,
        "password": "fictional-test-password", "mobility_aid": "manual_wheelchair",
        "access": {"wheelchair_user": True, "step_free_required": True, "max_gradient_percent": 5},
    }


def test_accounts_persist_preferences_and_logout_revokes_session(client):
    assert client.get("/api/v1/profile").status_code == 401
    response = client.post("/api/v1/auth/register", json=registration())
    assert response.status_code == 200
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "password" not in response.json()
    old_cookie = client.cookies.get("accessroute_session")
    profile = client.get("/api/v1/profile").json()
    profile["access"]["max_continuous_walking_m"] = 40
    assert client.put("/api/v1/profile", json=profile).status_code == 200
    assert client.get("/api/v1/profile").json()["access"]["max_continuous_walking_m"] == 40
    assert client.post("/api/v1/auth/logout").status_code == 200
    assert client.get("/api/v1/profile").status_code == 401
    client.cookies.set("accessroute_session", old_cookie)
    assert client.get("/api/v1/profile").status_code == 401
    client.cookies.clear()
    assert client.post("/api/v1/auth/login", json={"email": "demo@example.test", "password": "wrong"}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": "demo@example.test", "password": "fictional-test-password"}).status_code == 200
    assert client.get("/api/v1/profile").json()["access"]["max_continuous_walking_m"] == 40


def test_profile_cannot_be_read_by_another_account(client):
    client.post("/api/v1/auth/register", json=registration())
    client.post("/api/v1/auth/logout")
    other = registration("other@example.test")
    other["first_name"] = "Other"
    client.post("/api/v1/auth/register", json=other)
    assert client.get("/api/v1/profile").json()["first_name"] == "Other"
    assert client.post("/api/v1/auth/register", json=registration()).status_code == 409


def test_cross_origin_account_writes_are_rejected(client):
    response = client.post("/api/v1/auth/register", json=registration(), headers={"Origin": "https://untrusted.example"})
    assert response.status_code == 403


def test_defaults_are_guidance_and_distinguish_assumptions(client):
    data = client.get("/api/v1/access/defaults").json()
    assert data["presets"]["manual_wheelchair"]["max_continuous_walking_m"] == 150
    assert data["presets"]["walking_aid"]["max_continuous_walking_m"] == 50
    assert data["presets"]["manual_wheelchair"]["max_gradient_percent"] == 5
    assert "assumptions" in data["sources"][1]["title"]


def test_navigation_does_not_fabricate_a_route_without_provider(client):
    payload = {"origin": {"latitude": 53.39, "longitude": -1.49},
               "destination": {"latitude": 53.4, "longitude": -1.48}, "access": {}}
    assert client.post("/api/v1/navigation/route", json=payload).status_code == 503
    payload["origin"]["latitude"] = 999
    assert client.post("/api/v1/navigation/route", json=payload).status_code == 422


def test_provider_incline_is_rounded_down_not_up():
    from app.navigation import route_options
    from app.schemas import AccessRequirements
    assert route_options(AccessRequirements(max_gradient_percent=5))[0] == 3


def test_navigation_provider_contract_and_distance_warnings(client, monkeypatch):
    import httpx
    import app.navigation as navigation_module

    monkeypatch.setattr(get_settings(), "ors_api_key", "test-key")
    real_client = httpx.AsyncClient

    def handler(request):
        import json
        body = json.loads(request.content)
        assert request.url.path.endswith("/wheelchair/geojson")
        assert body["options"]["profile_params"]["restrictions"]["maximum_incline"] == 3
        assert request.headers["authorization"] == "test-key"
        return httpx.Response(200, json={"features": [{
            "geometry": {"type": "LineString", "coordinates": [[-1.49, 53.39], [-1.48, 53.4]]},
            "properties": {"summary": {"distance": 400, "duration": 300}, "segments": [{"steps": [{
                "instruction": "Continue to the selected point", "distance": 400, "duration": 300, "way_points": [0, 1],
            }]}]},
        }]})

    monkeypatch.setattr(navigation_module.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs))
    payload = {"origin": {"latitude": 53.39, "longitude": -1.49},
               "destination": {"latitude": 53.4, "longitude": -1.48},
               "access": {"max_gradient_percent": 5, "max_total_walking_m": 300}}
    response = client.post("/api/v1/navigation/route", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["data_status"] == "provider_route_unverified_access"
    assert data["exceeds_total_distance"] is True
    assert len(data["warnings"]) == 2
    assert data["steps"][0]["coordinate"] == [-1.49, 53.39]


def test_slope_and_boarding_allowance_change_assessment(client):
    payload = {"appointment": {"hospital_id": "northern-general-demo", "department": "Demo",
                              "arrive_by": "2026-11-20T10:00:00+00:00", "confirmed_by_user": True},
               "access": {"step_free_required": True, "max_gradient_percent": 5, "boarding_buffer_minutes": 3}}
    data = client.post("/api/v1/journeys/plan", json=payload).json()
    assert data["recommended_route_id"] == "demo-direct"
    assert data["assessments"][0]["leave_at"] == "2026-11-20T09:12:00Z"
    payload["access"]["max_gradient_percent"] = 3
    assert client.post("/api/v1/journeys/plan", json=payload).json()["recommended_route_id"] is None
