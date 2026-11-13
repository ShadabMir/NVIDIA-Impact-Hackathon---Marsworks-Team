import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.services import transport_map as tm


def test_osm_stops_and_alignment_are_sourced_and_labelled():
    option = tm.option_by_id("city-bus-120")
    points = [
        {"type": "node", "id": 1, "lat": 53.38, "lon": -1.47, "tags": {"name": "Arundel Gate", "highway": "bus_stop"}},
        {"type": "node", "id": 2, "lat": 53.379, "lon": -1.488, "tags": {"name": "Glossop Road/Beech Hill Road", "highway": "bus_stop"}},
        {"type": "relation", "id": 3, "tags": {"route": "bus", "ref": "120"}, "members": [
            {"type": "way", "role": "", "geometry": [{"lon": -1.47, "lat": 53.38}, {"lon": -1.488, "lat": 53.379}]}]},
    ]
    result = tm.map_option(option, points)
    bus = result["legs"][0]
    assert [stop["role"] for stop in bus["map_stops"]] == ["board", "alight"]
    assert bus["map_stops"][0]["source"] == "https://www.openstreetmap.org/node/1"
    assert bus["geometry"]["type"] == "MultiLineString"
    assert bus["service_alignment"] is True
    assert "whole mapped service alignment" in result["notice"]


def test_missing_stops_or_shapes_are_not_invented():
    result = tm.map_option(tm.option_by_id("city-bus-120"), [])
    assert result["legs"][0]["map_stops"] == []
    assert len(result["legs"][0]["missing_stops"]) == 2
    assert result["legs"][0]["geometry"] is None


def test_wrong_transport_mode_is_not_a_stop_match():
    element = {"tags": {"name": "Cathedral", "highway": "bus_stop"}}
    assert tm.stop_match(element, ["cathedral"], "tram") is False


def test_option_map_endpoint_and_unknown_option(monkeypatch):
    monkeypatch.setattr(tm, "fetch_map_elements", lambda option_id: [])
    client = TestClient(app)
    assert client.get("/api/v1/navigation/options/city-bus-120/map").status_code == 200
    assert client.get("/api/v1/navigation/options/unknown/map").status_code == 404


def test_lookup_failure_does_not_cache_an_invented_success(monkeypatch):
    class OfflineClient:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, *args, **kwargs): raise httpx.ConnectError("offline")
    monkeypatch.setattr(tm.httpx, "Client", OfflineClient)
    def no_geocode(*args, **kwargs):
        raise HTTPException(502, "offline")
    monkeypatch.setattr("app.navigation.geocode_request", no_geocode)
    tm.fetch_map_elements.cache_clear()
    with pytest.raises(HTTPException) as error:
        tm.fetch_map_elements("city-bus-120")
    assert error.value.status_code == 502


def test_stop_fallback_filters_roads_out_of_geocoding_results(monkeypatch):
    class BlockedOverpass:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, *args, **kwargs): raise httpx.ConnectError("blocked")
    monkeypatch.setattr(tm.httpx, "Client", BlockedOverpass)
    def geocode(kind, params):
        if "Arundel" not in dict(params)["q"]:
            return []
        return [
            {"category": "highway", "type": "residential", "name": "Arundel Gate", "lat": "53.38", "lon": "-1.47", "osm_type": "way", "osm_id": 1},
            {"category": "highway", "type": "bus_stop", "name": "Arundel Gate AG6", "lat": "53.38", "lon": "-1.47", "osm_type": "node", "osm_id": 2},
        ]
    monkeypatch.setattr("app.navigation.geocode_request", geocode)
    tm.fetch_map_elements.cache_clear()
    elements = tm.fetch_map_elements("city-bus-120")
    assert len(elements) == 1
    assert elements[0]["id"] == 2
    tm.fetch_map_elements.cache_clear()
