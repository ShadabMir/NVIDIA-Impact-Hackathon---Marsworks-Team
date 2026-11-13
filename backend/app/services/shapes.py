"""Road-following map shapes for journey legs (used by live guidance).

Each leg runs between known points: start area -> first stop -> ... -> last stop -> entrance.
With ORS_API_KEY set, openrouteservice gives a road route for each leg (bus/tram/taxi:
driving-car; wheeling: wheelchair, then foot-walking if no wheelchair route). Without a key, or
if the provider fails, the leg is a straight line between the correct points and is marked
"straight". Results are cached in memory, so repeated demos don't re-query the provider.
"""
from typing import Any

import httpx

from app.config import Settings
from app.services import sheffield as sh

PROFILE = {"roll": ["wheelchair", "foot-walking"], "bus": ["driving-car"], "tram": ["driving-car"], "taxi": ["driving-car"]}
_cache: dict[tuple, list[list[float]] | None] = {}


def make_client(settings: Settings) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=15)  # tests replace this with a fake provider


def stop_point(stop_id: str) -> list[float] | None:
    stop = sh.data().get("stops", {}).get(stop_id)
    return stop["coordinate"] if stop else None


def origin_point(origin_id: str) -> list[float] | None:
    origin = next((o for o in sh.origins() if o["id"] == origin_id), None)
    return [origin["lon"], origin["lat"]] if origin and origin.get("lat") is not None else None


def endpoints(legs: list[dict], start: list[float], goal: list[float]) -> list[tuple[list[float], list[float]]]:
    """From/to point for every leg, using stop coordinates for bus/tram legs."""
    ends, previous = [], start
    for i, leg in enumerate(legs):
        stops = [p for p in (stop_point(s) for s in leg.get("stops", [])) if p]
        if leg["mode"] in sh.TRANSIT and len(stops) >= 2:
            a, b = stops[0], stops[-1]
        else:
            a = previous
            following = next((l for l in legs[i + 1:] if l["mode"] in sh.TRANSIT and l.get("stops")), None)
            b = (stop_point(following["stops"][0]) if following else None) or goal
        ends.append((a, b))
        previous = b
    return ends


async def road_shape(client: httpx.AsyncClient, settings: Settings, mode: str, a: list[float], b: list[float]):
    key = (mode, round(a[0], 5), round(a[1], 5), round(b[0], 5), round(b[1], 5))
    if key in _cache:
        return _cache[key]
    shape = None
    for profile in PROFILE.get(mode, ["driving-car"]):
        try:
            response = await client.post(f"{settings.ors_base_url.rstrip('/')}/v2/directions/{profile}/geojson",
                                         headers={"Authorization": settings.ors_api_key},
                                         json={"coordinates": [a, b]})
            if response.status_code != 200:
                continue
            coords = response.json()["features"][0]["geometry"]["coordinates"]
            if len(coords) >= 2:
                shape = [[float(c[0]), float(c[1])] for c in coords]
                break
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
            continue
    _cache[key] = shape
    return shape


async def shape_legs(legs: list[dict[str, Any]], start: list[float], goal: list[float], settings: Settings,
                     keep_existing: bool = False) -> tuple[list[dict], str]:
    """Return legs with geometry and map_stops filled in, plus "roads", "partial" or "straight"."""
    shaped, sources = [], []
    use_roads = bool(settings.ors_api_key)
    client = make_client(settings) if use_roads else None
    try:
        for leg, (a, b) in zip(legs, endpoints(legs, start, goal)):
            leg = dict(leg)
            existing = (leg.get("geometry") or {}).get("coordinates")
            if keep_existing and existing:
                sources.append("existing")
            else:
                road = await road_shape(client, settings, leg["mode"], a, b) if use_roads and a != b else None
                if road:
                    leg["geometry"] = {"type": "LineString", "coordinates": road}
                    sources.append("roads")
                elif existing:
                    sources.append("existing")
                else:
                    leg["geometry"] = {"type": "LineString", "coordinates": [a, b] if a != b else [a, [b[0] + 1e-5, b[1]]]}
                    sources.append("straight")
            if leg["mode"] in sh.TRANSIT and not leg.get("map_stops"):
                leg["map_stops"] = [{"name": sh.data()["stops"][s]["name"], "coordinate": stop_point(s)}
                                    for s in leg.get("stops", []) if stop_point(s)]
            shaped.append(leg)
    finally:
        if client:
            await client.aclose()
    overall = "roads" if all(s in {"roads", "existing"} for s in sources) and "roads" in sources else \
        "straight" if all(s == "straight" for s in sources) else "partial"
    if not use_roads and "straight" not in sources:
        overall = "existing"
    return shaped, overall
