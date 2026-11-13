import json

import httpx
import pytest
from fastapi.testclient import TestClient

import app.agent_routes as agent_routes
from app.config import Settings
from app.main import app
from app.services import llm

client = TestClient(app)

MARGARET = {
    "origin_id": "walkley",
    "appointment": {
        "department": "Neuro-Rehabilitation Outpatients",
        "arrive_by": "2026-11-16T10:15:00+00:00",
        "confirmed_by_user": True,
    },
    "needs": {"mobility_aid": "powered_wheelchair", "needs_accessible_toilet": True},
    "use_model": False,
}


@pytest.fixture(autouse=True)
def offline_settings(monkeypatch):
    settings = Settings(live_weather=False, ollama_agent_model="nemotron-3-nano:30b")
    monkeypatch.setattr(agent_routes, "get_settings", lambda: settings)
    return settings


def fake_model(monkeypatch, handler):
    monkeypatch.setattr(llm, "make_client", lambda s: httpx.AsyncClient(transport=httpx.MockTransport(handler)))


def by_id(plan):
    return {o["id"]: o for o in plan["options"]}


def test_context_lists_origins_entrances_and_scenarios():
    body = client.get("/api/v1/agent/context").json()
    assert body["hospital"]["name"] == "Royal Hallamshire Hospital"
    assert any(o["id"] == "walkley" for o in body["origins"])
    assert any(s["id"] == "beech-hill-blocked" for s in body["scenarios"])


def test_rules_plan_avoids_steep_hills_and_closed_pavements():
    r = client.post("/api/v1/agent/plan", json=MARGARET)
    assert r.status_code == 200, r.text
    plan = r.json()
    options = by_id(plan)
    assert plan["recommendation"]["option_id"] == "walkley-bus-95"
    assert plan["options"][0]["id"] == "walkley-bus-95"
    assert options["walkley-bus-95"]["status"] == "suitable"
    assert options["walkley-tram-western-bank"]["status"] == "unsuitable"
    assert any(b["category"] == "gradient" for b in options["walkley-tram-western-bank"]["barriers"])
    assert any(b["category"] == "roadworks" and b["severity"] == "blocking"
               for b in options["walkley-tram-western-bank"]["barriers"])
    assert options["walkley-bus-52-clarkehouse"]["status"] == "unsuitable"
    assert plan["entrance"]["id"] == "rhh-entrance-2"
    assert plan["support_needed"] is False
    assert plan["agent_mode"] == "rules_only"
    assert plan["toilets"], "toilet check should run when the patient needs one"
    assert "find_accessible_toilets" in {s["tool"] for s in plan["agent_steps"]}


def test_blocked_pavement_reassessment_falls_back_to_taxi_and_offers_drafts():
    scenario = next(s for s in client.get("/api/v1/agent/context").json()["scenarios"] if s["id"] == "beech-hill-blocked")
    r = client.post("/api/v1/agent/reassess", json={"request": MARGARET, "disruptions": scenario["disruptions"]})
    plan = r.json()
    assert by_id(plan)["walkley-bus-95"]["status"] == "unsuitable"
    assert plan["recommendation"]["option_id"] == "walkley-taxi"
    assert plan["support_needed"] is True
    kinds = {a["kind"] for a in plan["suggested_actions"]}
    assert {"blocked_pavement_report", "hospital_transport_request"} <= kinds


def test_partial_tram_cancellation_is_a_warning_not_a_block():
    req = {**MARGARET, "origin_id": "hillsborough",
           "disruptions": [{"type": "tram_cancelled", "target": "Blue", "description": "Blue line suspended"}]}
    tram = by_id(client.post("/api/v1/agent/plan", json=req).json())["hillsborough-tram"]
    cancels = [b for b in tram["barriers"] if b["category"] == "cancellation"]
    assert cancels and all(b["severity"] == "warning" for b in cancels)


def test_ice_and_late_start_are_enforced():
    req = {**MARGARET, "disruptions": [{"type": "severe_weather", "target": "ice"}],
           "earliest_departure": "2026-11-16T10:00:00+00:00"}
    plan = client.post("/api/v1/agent/plan", json=req).json()
    assert plan["weather"]["ice_risk"] is True
    bus = by_id(plan)["walkley-bus-95"]
    assert any(b["category"] == "timing" for b in bus["barriers"])
    assert bus["status"] == "unsuitable"


def test_unknown_origin_rejected():
    assert client.post("/api/v1/agent/plan", json={**MARGARET, "origin_id": "mars"}).status_code == 422


def test_model_directed_agent_with_safety_net(monkeypatch):
    calls = {"n": 0}

    def handler(request):
        payload = json.loads(request.content)
        calls["n"] += 1
        if "format" in payload:
            content = json.dumps({"option_id": "walkley-bus-95", "summary": "Leave at 09:35 for the 95.",
                                  "reasons": ["Avoids Howard Road"], "tips": ["Ask for the ramp"]})
            return httpx.Response(200, json={"message": {"role": "assistant", "content": content}})
        tool_turns = sum(m["role"] == "tool" for m in payload["messages"])
        if tool_turns == 0:
            return httpx.Response(200, json={"message": {"role": "assistant", "content": "", "tool_calls": [
                {"function": {"name": "list_route_options", "arguments": {}}},
                {"function": {"name": "get_weather_forecast", "arguments": {}}},
                {"function": {"name": "not_a_tool", "arguments": {}}},
            ]}})
        if tool_turns == 3:
            return httpx.Response(200, json={"message": {"role": "assistant", "content": "", "tool_calls": [
                {"function": {"name": "check_roadworks", "arguments": "{\"streets\": [\"western-bank\"]}"}},
            ]}})
        return httpx.Response(200, json={"message": {"role": "assistant", "content": "Done."}})

    fake_model(monkeypatch, handler)
    plan = client.post("/api/v1/agent/plan", json={**MARGARET, "use_model": True}).json()
    assert plan["agent_mode"] == "model_directed"
    actors = {(s["tool"], s["actor"]) for s in plan["agent_steps"]}
    assert ("list_route_options", "model") in actors
    assert ("check_events", "safety_net") in actors  # model skipped it; safety net ran it
    assert plan["recommendation"]["generated_by"] == "model"
    assert plan["recommendation"]["option_id"] == "walkley-bus-95"


def test_model_cannot_choose_an_unsafe_route(monkeypatch):
    def handler(request):
        payload = json.loads(request.content)
        if "format" in payload:
            content = json.dumps({"option_id": "walkley-tram-western-bank", "summary": "Take the tram",
                                  "reasons": [], "tips": []})
            return httpx.Response(200, json={"message": {"role": "assistant", "content": content}})
        return httpx.Response(200, json={"message": {"role": "assistant", "content": "ok"}})

    fake_model(monkeypatch, handler)
    plan = client.post("/api/v1/agent/plan", json={**MARGARET, "use_model": True}).json()
    assert plan["recommendation"]["option_id"] == "walkley-bus-95"
    assert plan["recommendation"]["generated_by"] == "rules"


def test_model_down_falls_back_to_rules(monkeypatch):
    def handler(request):
        raise httpx.ConnectError("no route to Spark")

    fake_model(monkeypatch, handler)
    plan = client.post("/api/v1/agent/plan", json={**MARGARET, "use_model": True}).json()
    assert plan["agent_mode"] == "model_unavailable_fallback"
    assert plan["recommendation"]["option_id"] == "walkley-bus-95"


@pytest.mark.parametrize("kind", ["blocked_pavement_report", "hospital_transport_request", "operator_feedback"])
def test_drafts_are_never_sent(kind):
    body = {"kind": kind, "request": MARGARET, "location": "Beech Hill Road footway", "use_model": False}
    r = client.post("/api/v1/agent/draft", json=body)
    assert r.status_code == 200, r.text
    draft = r.json()
    assert draft["sent"] is False and draft["requires_review"] is True
    assert draft["body"].startswith("DRAFT")


def test_original_routes_still_work():
    assert client.get("/health").status_code == 200
    assert client.get("/api/v1/hospitals").status_code == 200


def test_open_meteo_parsing_detects_ice(monkeypatch):
    import asyncio
    from datetime import datetime, timezone

    from app.services import weather

    hours = [f"2026-11-{d}T{h:02d}:00" for d in (15, 16) for h in range(24)]
    n = len(hours)
    body = {"hourly": {"time": hours, "temperature_2m": [0.5] * n, "precipitation": [0.0] * 30 + [0.4] + [0.0] * (n - 31),
                       "precipitation_probability": [20] * n, "wind_speed_10m": [12.0] * n, "snowfall": [0.0] * n}}
    monkeypatch.setattr(weather, "make_client",
                        lambda: httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=body))))
    out = asyncio.run(weather.forecast(53.37, -1.48, datetime(2026, 11, 16, 10, 15, tzinfo=timezone.utc)))
    assert out.source == "open-meteo"
    assert out.ice_risk is True and out.temperature_c == 0.5
