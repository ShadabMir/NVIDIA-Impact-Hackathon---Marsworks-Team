"""Live guidance: mid-journey re-planning from the current position."""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

import app.agent_routes as agent_routes
from app.config import Settings
from app.main import app
from app.services import llm

client = TestClient(app)
REQUEST = {"origin_id": "walkley", "use_model": False,
           "appointment": {"department": "Neuro-Rehabilitation Outpatients",
                           "arrive_by": "2026-11-16T10:15:00+00:00", "confirmed_by_user": True},
           "needs": {"mobility_aid": "powered_wheelchair"}}
ON_BUS = {"lat": 53.3830, "lon": -1.4895}


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    monkeypatch.setattr(agent_routes, "get_settings", lambda: Settings(live_weather=False))


def replan(problem, leg_index=1, progress=0.8, now="2026-11-16T09:50:00+00:00", position=ON_BUS, **extra):
    body = {"request": REQUEST, "option_id": "walkley-bus-95", "leg_index": leg_index, "leg_progress": progress,
            "position": position, "now": now, "problem": problem, "use_model": False, **extra}
    return client.post("/api/v1/agent/guide/replan", json=body)


def by_id(decision):
    return {c["id"]: c for c in decision["candidates"]}


def test_blocked_pavement_ahead_while_on_the_bus():
    d = replan("pavement_blocked_ahead").json()
    cands = by_id(d)
    assert cands["continue"]["status"] == "unsuitable"
    assert "glossop-to-entrance-9" in cands and "taxi-from-here" in cands
    assert d["action_id"] != "continue" and cands[d["action_id"]]["status"] != "unsuitable"
    assert d["disruptions_applied"][0]["target"] == "beech-hill-road"
    assert all(leg["geometry"] for leg in d["legs"])  # the map can draw the new route
    assert d["say"] and d["decided_by"] == "rules"


def test_bus_delay_moves_the_arrival():
    d = replan("bus_delayed", progress=0.2, now="2026-11-16T09:40:00+00:00", delay_minutes=20).json()
    cont = by_id(d)["continue"]
    assert cont["late_minutes"] >= 1 and any("late" in p for p in cont["problems"])
    assert d["eta"] <= cont["eta"]  # chose something at least as fast


def test_stuck_on_the_final_stretch_offers_going_back_to_another_entrance():
    d = replan("stuck", leg_index=2, progress=0.3, now="2026-11-16T10:00:00+00:00",
               position={"lat": 53.3797, "lon": -1.4886}).json()
    alt = by_id(d)["glossop-to-entrance-9"]
    assert alt["kind"] == "alternative_entrance" and by_id(d)["continue"]["status"] == "unsuitable"


def test_running_late_flags_the_hospital():
    d = replan("running_late", leg_index=0, progress=0.5, now="2026-11-16T10:05:00+00:00",
               position={"lat": 53.3952, "lon": -1.4982}).json()
    assert d["late_minutes"] > 0 and d["notify_hospital"] is True


def test_custom_legs_after_an_earlier_replan():
    taxi = [{"mode": "taxi", "instruction": "Taxi", "minutes": 15, "frequency_minutes": 0}]
    d = replan("running_late", leg_index=0, progress=0.1, now="2026-11-16T09:50:00+00:00", legs=taxi).json()
    assert by_id(d)["continue"]["status"] == "suitable"


@pytest.mark.parametrize("changes,status", [({"option_id": "nope"}, 422), ({"leg_index": 9}, 422),
                                            ({"leg_progress": 1.5}, 422), ({"problem": "aliens"}, 422)])
def test_bad_requests(changes, status):
    body = {"request": REQUEST, "option_id": "walkley-bus-95", "leg_index": 1, "leg_progress": 0.5,
            "position": ON_BUS, "now": "2026-11-16T09:50:00+00:00", "problem": "stuck", **changes}
    assert client.post("/api/v1/agent/guide/replan", json=body).status_code == status


def fake_model(monkeypatch, content=None, fail=False):
    def handler(request):
        if fail:
            raise httpx.ConnectError("Spark down")
        return httpx.Response(200, json={"message": {"role": "assistant", "content": json.dumps(content)},
                                         "eval_count": 30, "eval_duration": 1_000_000_000})
    monkeypatch.setattr(llm, "make_client", lambda s: httpx.AsyncClient(transport=httpx.MockTransport(handler)))


def test_model_choice_is_used_when_allowed(monkeypatch):
    fake_model(monkeypatch, {"action_id": "glossop-to-entrance-9", "say": "Stay on the bus. Use the Glossop Road entrance.",
                             "reason": "On time and step-free."})
    d = replan("pavement_blocked_ahead", use_model=True).json()
    assert d["decided_by"] == "model" and d["action_id"] == "glossop-to-entrance-9"
    assert d["say"].startswith("Stay on the bus") and d["model_stats"]["calls"] == 1
    assert d["entrance"]["id"] == "rhh-entrance-9"


def test_model_cannot_choose_the_blocked_route(monkeypatch):
    fake_model(monkeypatch, {"action_id": "continue", "say": "Carry on.", "reason": "fastest"})
    d = replan("pavement_blocked_ahead", use_model=True).json()
    assert d["action_id"] != "continue" and d["decided_by"] == "rules"


def test_model_down_falls_back_to_rules(monkeypatch):
    fake_model(monkeypatch, fail=True)
    d = replan("pavement_blocked_ahead", use_model=True).json()
    assert d["decided_by"] == "rules" and d["say"]


def test_model_cannot_choose_a_late_option_when_an_on_time_one_is_suitable(monkeypatch):
    fake_model(monkeypatch, {"action_id": "glossop-to-entrance-9", "say": "Use the other entrance.", "reason": "x"})
    d = replan("bus_delayed", progress=0.2, now="2026-11-16T09:40:00+00:00", delay_minutes=20, use_model=True).json()
    chosen = by_id(d)[d["action_id"]]
    assert by_id(d)["glossop-to-entrance-9"]["late_minutes"] > 0
    assert chosen["late_minutes"] == 0 and d["decided_by"] == "rules"
    assert any(s["tool"] == "reject_late_choice" for s in d["agent_steps"])
