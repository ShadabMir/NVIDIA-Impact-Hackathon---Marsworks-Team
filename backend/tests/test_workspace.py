import json

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.profiles import database


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "database_path", str(tmp_path / "accounts.sqlite3"))
    with TestClient(app) as instance:
        yield instance


def register(client, email="first@example.test"):
    return client.post("/api/v1/auth/register", json={
        "first_name": "Fictional", "last_name": "Patient", "email": email,
        "password": "fictional-test-password", "access": {},
    })


def appointment():
    return {"hospital_id": "royal-hallamshire", "department": "Demo clinic",
            "date": "2026-11-20", "arrival": "10:00", "origin": "Fictional starting address"}


def agent_request():
    return {"origin_id": "walkley", "appointment": {"department": "Demo clinic",
            "arrive_by": "2026-11-20T10:00:00+00:00", "confirmed_by_user": True},
            "needs": {"needs_accessible_toilet": True, "avoid_crowds": True}, "use_model": False}


def test_workspace_requires_login_and_rejects_cross_origin_writes(client):
    assert client.get("/api/v1/workspace").status_code == 401
    assert client.patch("/api/v1/workspace", json={"appointment": appointment()}).status_code == 401
    register(client)
    assert client.patch("/api/v1/workspace", json={}, headers={"Origin": "https://untrusted.example"}).status_code == 403


def test_partial_updates_preserve_both_forms_and_survive_sign_in(client):
    register(client)
    assert client.get("/api/v1/workspace").json()["appointment"] is None
    first = client.patch("/api/v1/workspace", json={"appointment": appointment()})
    assert first.status_code == 200
    assert first.json()["updated_at"]
    second = client.patch("/api/v1/workspace", json={"agent_request": agent_request()})
    assert second.status_code == 200
    assert second.json()["appointment"] == appointment()
    assert second.json()["agent_request"]["needs"]["avoid_crowds"] is True
    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={"email": "first@example.test", "password": "fictional-test-password"})
    restored = client.get("/api/v1/workspace")
    assert restored.headers["cache-control"] == "no-store"
    assert restored.json()["appointment"] == appointment()
    assert restored.json()["agent_request"]["needs"]["needs_accessible_toilet"] is True


def test_saved_forms_are_scoped_to_current_account(client):
    register(client)
    client.patch("/api/v1/workspace", json={"appointment": appointment()})
    client.post("/api/v1/auth/logout")
    register(client, "second@example.test")
    assert client.get("/api/v1/workspace").json()["appointment"] is None
    client.patch("/api/v1/workspace", json={"agent_request": agent_request()})
    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={"email": "first@example.test", "password": "fictional-test-password"})
    own = client.get("/api/v1/workspace").json()
    assert own["appointment"] == appointment()
    assert own["agent_request"] is None


def test_clear_one_form_does_not_delete_the_other(client):
    register(client)
    client.patch("/api/v1/workspace", json={"appointment": appointment(), "agent_request": agent_request()})
    cleared = client.patch("/api/v1/workspace", json={"appointment": None}).json()
    assert cleared["appointment"] is None
    assert cleared["agent_request"] is not None


def test_invalid_dates_and_unexpected_gps_payloads_rejected(client):
    register(client)
    bad = {**appointment(), "date": "not-a-date"}
    assert client.patch("/api/v1/workspace", json={"appointment": bad}).status_code == 422
    assert client.patch("/api/v1/workspace", json={"gps_trace": [[53.3, -1.4]]}).status_code == 422
    assert client.patch("/api/v1/workspace", json={"appointment": {**appointment(), "raw_letter": "test"}}).status_code == 422


def test_existing_profiles_and_passwords_survive_schema_extension(client):
    register(client)
    connection = database()
    try:
        row = connection.execute("SELECT id, profile, password_hash FROM users").fetchone()
        legacy = json.loads(row["profile"])
        legacy.pop("default_starting_address", None)
        with connection:
            connection.execute("UPDATE users SET profile=? WHERE id=?", (json.dumps(legacy), row["id"]))
        original_hash = row["password_hash"]
    finally:
        connection.close()
    data = client.get("/api/v1/profile").json()
    assert data["default_starting_address"] == ""
    data["default_starting_address"] = "Fictional saved address"
    assert client.put("/api/v1/profile", json=data).status_code == 200
    assert client.get("/api/v1/profile").json()["default_starting_address"] == "Fictional saved address"
    connection = database()
    try:
        assert connection.execute("SELECT password_hash FROM users").fetchone()[0] == original_hash
        assert connection.execute("PRAGMA user_version").fetchone()[0] >= 1
    finally:
        connection.close()


def test_data_saved_by_other_branches_still_loads(client):
    """Branches share backend/.data: a Northern General profile/appointment saved on main must not
    crash this app's login, profile or saved-form loading."""
    register(client)
    connection = database()
    with connection:
        row = connection.execute("SELECT id, profile FROM users").fetchone()
        legacy = {**json.loads(row["profile"]), "default_hospital_id": "northern-general-demo"}
        connection.execute("UPDATE users SET profile=? WHERE id=?", (json.dumps(legacy), row["id"]))
        connection.execute(
            "INSERT INTO user_workspace (user_id,appointment,agent_request,updated_at) VALUES (?,?,?,?)",
            (row["id"], json.dumps({"hospital_id": "northern-general-demo", "department": "Demo", "date": "2026-11-20",
                                    "arrival": "10:00", "origin": ""}), json.dumps({"not": "an agent request"}),
             "2026-11-13T12:00:00+00:00"))
    connection.close()
    login = client.post("/api/v1/auth/login", json={"email": "first@example.test", "password": "fictional-test-password"})
    assert login.status_code == 200 and login.json()["default_hospital_id"] == "royal-hallamshire"
    assert client.get("/api/v1/profile").status_code == 200
    saved = client.get("/api/v1/workspace")
    assert saved.status_code == 200 and saved.json()["appointment"] is None and saved.json()["agent_request"] is None
    assert client.patch("/api/v1/workspace", json={"appointment": appointment()}).status_code == 200
