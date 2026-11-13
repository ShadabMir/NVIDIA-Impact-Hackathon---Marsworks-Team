"""Road-following leg shapes for live guidance."""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

import app.agent_routes as agent_routes
from app.config import Settings
from app.main import app
from app.services import shapes

client = TestClient(app)
ARUNDEL, GLOSSOP = [-1.4663, 53.3812], [-1.4883, 53.38005]
CITY = [-1.4645, 53.3797]


@pytest.fixture(autouse=True)
def fresh_cache():
    shapes._cache.clear()


def use(monkeypatch, key="", handler=None):
    monkeypatch.setattr(agent_routes, "get_settings", lambda: Settings(live_weather=False, ors_api_key=key))
    calls = []
    if handler:
        def recording(request):
            calls.append((request.url.path, json.loads(request.content)["coordinates"]))
            return handler(request)
        monkeypatch.setattr(shapes, "make_client", lambda s: httpx.AsyncClient(transport=httpx.MockTransport(recording)))
    return calls


def get(origin="city-centre", option="city-bus-120"):
    return client.post("/api/v1/agent/guide/shapes", json={"origin_id": origin, "option_id": option, "entrance_id": "rhh-entrance-2"})


def road(request):
    a, b = json.loads(request.content)["coordinates"]
    mid = [(a[0] + b[0]) / 2 + 0.001, (a[1] + b[1]) / 2]
    return httpx.Response(200, json={"features": [{"geometry": {"type": "LineString", "coordinates": [a, mid, b]}}]})


def test_without_a_key_legs_run_straight_between_the_right_stops(monkeypatch):
    use(monkeypatch)
    body = get().json()
    walk, bus, final = (leg["geometry"]["coordinates"] for leg in body["legs"])
    assert walk == [CITY, ARUNDEL] and bus == [ARUNDEL, GLOSSOP] and final[0] == GLOSSOP
    assert body["source"] == "straight"
    assert [s["name"] for s in body["legs"][1]["map_stops"]] == ["Arundel Gate", "Glossop Rd / Beech Hill Rd"]


def test_with_a_key_legs_follow_roads_with_the_right_profiles_and_are_cached(monkeypatch):
    calls = use(monkeypatch, "test-key", road)
    body = get().json()
    assert body["source"] == "roads"
    assert all(len(leg["geometry"]["coordinates"]) == 3 for leg in body["legs"])
    assert [path.split("/")[-2] for path, _ in calls] == ["wheelchair", "driving-car", "wheelchair"]
    assert calls[1][1] == [ARUNDEL, GLOSSOP]
    get()
    assert len(calls) == 3  # second request served from cache


def test_no_wheelchair_route_falls_back_to_walking_then_straight(monkeypatch):
    def handler(request):
        if "wheelchair" in request.url.path:
            return httpx.Response(404, json={"error": {"code": 2009}})
        if "foot-walking" in request.url.path:
            raise httpx.ConnectError("down")
        return road(request)
    calls = use(monkeypatch, "test-key", handler)
    body = get().json()
    assert body["source"] == "partial"
    assert body["legs"][1]["geometry"]["coordinates"][0] == ARUNDEL and len(body["legs"][1]["geometry"]["coordinates"]) == 3
    assert len(body["legs"][0]["geometry"]["coordinates"]) == 2  # straight, but between the right points
    assert {p.split("/")[-2] for p, _ in calls} == {"wheelchair", "foot-walking", "driving-car"}


def test_walkley_keeps_its_route_when_offline(monkeypatch):
    use(monkeypatch)
    body = get("walkley", "walkley-bus-95").json()
    assert body["source"] == "existing" and len(body["legs"][1]["geometry"]["coordinates"]) > 2


@pytest.mark.parametrize("origin,option", [("mars", "city-bus-120"), ("city-centre", "nope")])
def test_bad_requests(monkeypatch, origin, option):
    use(monkeypatch)
    assert get(origin, option).status_code == 422


def test_taxi_from_here_follows_roads_when_a_key_is_set(monkeypatch):
    use(monkeypatch, "test-key", road)
    request = {"origin_id": "walkley", "use_model": False,
               "appointment": {"department": "Neuro", "arrive_by": "2026-11-16T10:15:00+00:00", "confirmed_by_user": True},
               "needs": {"mobility_aid": "powered_wheelchair"}}
    d = client.post("/api/v1/agent/guide/replan", json={
        "request": request, "option_id": "walkley-bus-95", "leg_index": 1, "leg_progress": 0.3,
        "position": {"lat": 53.39, "lon": -1.494}, "now": "2026-11-16T09:40:00+00:00",
        "problem": "bus_delayed", "delay_minutes": 40, "use_model": False}).json()
    assert d["action_kind"] == "taxi_from_here"
    assert len(d["legs"][0]["geometry"]["coordinates"]) == 3
