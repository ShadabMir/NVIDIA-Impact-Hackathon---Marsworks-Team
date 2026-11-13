"""Live weather from Open-Meteo (free, no API key). Falls back cleanly when offline."""
from datetime import datetime, timedelta

import httpx

from app.agent_schemas import AgentDisruption, WeatherOut
from app.services.sheffield import LONDON

OPEN_METEO = "https://api.open-meteo.com/v1/forecast"


def make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=6)  # Tests monkeypatch this.


def scenario_weather(disruptions: list[AgentDisruption]) -> WeatherOut | None:
    for d in disruptions:
        if d.type == "severe_weather":
            kind = d.target.lower()
            return WeatherOut(
                source="scenario",
                summary=d.description or f"Severe weather: {kind}",
                rain="rain" in kind or "storm" in kind,
                ice_risk="ice" in kind or "snow" in kind,
                strong_wind="wind" in kind or "storm" in kind,
            )
    return None


async def forecast(lat: float, lon: float, at: datetime, enabled: bool = True) -> WeatherOut:
    if not enabled:
        return WeatherOut(source="unavailable", summary="Live weather disabled in settings.")
    local = at.astimezone(LONDON)
    day = local.date()
    params = {
        "latitude": lat, "longitude": lon, "timezone": "Europe/London",
        "hourly": "temperature_2m,precipitation,precipitation_probability,wind_speed_10m,snowfall",
        "start_date": (day - timedelta(days=1)).isoformat(), "end_date": day.isoformat(),
    }
    try:
        async with make_client() as client:
            r = await client.get(OPEN_METEO, params=params)
            r.raise_for_status()
        hourly = r.json()["hourly"]
        key = local.strftime("%Y-%m-%dT%H:00")
        i = hourly["time"].index(key)
    except (httpx.HTTPError, KeyError, ValueError, TypeError):
        return WeatherOut(source="unavailable",
                          summary="Weather forecast unavailable (offline, or date more than 16 days ahead).")

    temp = hourly["temperature_2m"][i]
    precip = hourly["precipitation"][i] or 0
    prob = hourly["precipitation_probability"][i]
    wind = hourly["wind_speed_10m"][i]
    wet_before = sum((p or 0) for p in hourly["precipitation"][max(0, i - 12):i + 1]) + \
        sum((s or 0) for s in hourly["snowfall"][max(0, i - 12):i + 1])
    rain = precip >= 0.3 or (prob or 0) >= 60
    ice = temp is not None and temp <= 1 and wet_before > 0
    strong_wind = (wind or 0) >= 40
    parts = [f"{temp:.0f}°C" if temp is not None else "temperature unknown"]
    parts.append(f"{prob}% chance of rain" if prob is not None else f"{precip} mm rain")
    parts.append(f"wind {wind:.0f} km/h" if wind is not None else "")
    if ice:
        parts.append("ICE RISK on untreated pavements")
    return WeatherOut(
        source="open-meteo", summary=", ".join(p for p in parts if p),
        temperature_c=temp, precipitation_mm=precip, precipitation_probability=prob,
        wind_kph=wind, rain=rain, ice_risk=ice, strong_wind=strong_wind,
    )
