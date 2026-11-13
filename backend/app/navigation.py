"""Explicit geocoding and optional wheelchair routing; never substitute a car route."""
import threading
import time
from functools import lru_cache

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import Field

from app.config import get_settings
from app.schemas import AccessRequirements, StrictModel

router = APIRouter(prefix="/api/v1", tags=["Location and navigation"])
_geocode_lock = threading.Lock()
_last_geocode = 0.0
USER_AGENT = "AccessRouteSheffieldHackathon/0.2 (https://github.com/ShadabMir/NVIDIA-Impact-Hackathon---Marsworks-Team)"


class Coordinates(StrictModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class NavigationRequest(StrictModel):
    origin: Coordinates
    destination: Coordinates
    access: AccessRequirements


@lru_cache(maxsize=100)
def geocode_request(kind: str, params: tuple):
    global _last_geocode
    # Public Nominatim: single worker, identify the app, cache and <=1 request/sec.
    with _geocode_lock:
        remaining = 1.05 - (time.monotonic() - _last_geocode)
        if remaining > 0:
            time.sleep(remaining)
        _last_geocode = time.monotonic()
        try:
            with httpx.Client(timeout=12, headers={"User-Agent": USER_AGENT}) as client:
                response = client.get(f"https://nominatim.openstreetmap.org/{kind}", params=dict(params))
                response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(502, "Address lookup is unavailable. You can enter an address manually or select a map point.") from exc


@router.get("/locations/reverse")
def reverse(latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180)):
    result = geocode_request("reverse", tuple(sorted({
        "format": "jsonv2", "lat": round(latitude, 5), "lon": round(longitude, 5),
    }.items())))
    if not result.get("display_name"):
        raise HTTPException(404, "No nearby address was found; use the coordinates or enter an address")
    return {"address": result["display_name"], "latitude": latitude, "longitude": longitude,
            "notice": "Approximate nearby address; confirm it before travelling.", "source": "OpenStreetMap / Nominatim"}


@router.get("/locations/search")
def search(q: str = Query(min_length=3, max_length=250)):
    result = geocode_request("search", tuple(sorted({
        "format": "jsonv2", "q": q, "limit": 3, "countrycodes": "gb",
    }.items())))
    return [{"label": item["display_name"], "latitude": float(item["lat"]),
             "longitude": float(item["lon"]), "source": "OpenStreetMap / Nominatim"} for item in result]


def route_options(access: AccessRequirements):
    # ORS only supports discrete incline limits. Round DOWN, never weaken a preference.
    requested = access.max_gradient_percent if access.max_gradient_percent is not None else 5
    supported = [value for value in [3, 6, 10, 15] if value <= requested]
    if not supported:
        raise HTTPException(422, "The routing provider cannot enforce a slope preference below 3%; no route was requested.")
    incline = max(supported)
    return incline, {
        "avoid_features": ["steps", "ferries"],
        "profile_params": {"restrictions": {"maximum_incline": incline, "maximum_sloped_kerb": 0.03}},
    }


@router.post("/navigation/route")
async def navigation(payload: NavigationRequest):
    settings = get_settings()
    if not settings.ors_api_key:
        raise HTTPException(503, "Live directions are not configured. Set ORS_API_KEY on the backend. GPS tracking still works.")
    incline, options = route_options(payload.access)
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            response = await client.post(
                f"{settings.ors_base_url.rstrip('/')}/v2/directions/wheelchair/geojson",
                headers={"Authorization": settings.ors_api_key},
                json={"coordinates": [
                    [payload.origin.longitude, payload.origin.latitude],
                    [payload.destination.longitude, payload.destination.latitude],
                ], "instructions": True, "options": options},
            )
            response.raise_for_status()
        feature = response.json()["features"][0]
        if feature["geometry"]["type"] != "LineString":
            raise ValueError("Unexpected geometry")
        coordinates = feature["geometry"]["coordinates"]
        properties = feature["properties"]
        summary = properties["summary"]
        steps = [{
            "instruction": step["instruction"], "distance_m": step["distance"],
            "duration_seconds": step["duration"],
            "coordinate": coordinates[step["way_points"][0]][:2],
        } for segment in properties["segments"] for step in segment["steps"]]
    except httpx.TimeoutException as exc:
        raise HTTPException(504, "Directions provider timed out; please retry") from exc
    except httpx.HTTPStatusError as exc:
        try:
            error = exc.response.json().get("error", {})
            code = error.get("code") if isinstance(error, dict) else None
        except ValueError:
            code = None
        if code in {2009, 2010}:
            raise HTTPException(422, "No wheelchair route was found between these map points with your current preferences. Check the starting point and exact hospital entrance; no alternative route has been assumed.") from exc
        if exc.response.status_code in {401, 403}:
            raise HTTPException(503, "The directions provider rejected its configured key. Check the backend routing configuration.") from exc
        if exc.response.status_code == 429:
            raise HTTPException(503, "The directions provider's request limit was reached. Please retry later.") from exc
        raise HTTPException(502, "The wheelchair routing provider could not supply a route. Check its key, quota and route coverage.") from exc
    except (httpx.HTTPError, KeyError, ValueError, IndexError, TypeError) as exc:
        raise HTTPException(502, "No usable wheelchair directions were returned") from exc
    exceeds_total = summary["distance"] > payload.access.max_total_walking_m
    warnings = []
    if exceeds_total:
        warnings.append("The route exceeds your total distance preference; it is not recommended against that preference.")
    if summary["distance"] > payload.access.max_continuous_walking_m:
        warnings.append("The route exceeds your distance-before-a-rest preference. Rest locations are not verified.")
    return {
        "geometry": feature["geometry"], "steps": steps,
        "distance_m": summary["distance"], "duration_seconds": summary["duration"],
        "provider": "openrouteservice", "data_status": "provider_route_unverified_access",
        "applied_max_gradient_percent": incline,
        "exceeds_total_distance": exceeds_total,
        "notice": "Outdoor wheelchair-profile directions, not live public transport. Access tags, rest opportunities and the destination entrance are not independently verified. Confirm local conditions.",
        "warnings": warnings,
        "provider_warnings": properties.get("warnings", []),
    }
