"""Source stop pins and service alignments from OSM; never synthesise transit geometry."""
import re
from functools import lru_cache

import httpx
from fastapi import HTTPException

from app.services import sheffield as sh

# Names identify fixture stops; coordinates must come from a provider, not the LLM.
STOPS = {
    "south-rd-fir-st": ("South Road / Fir Street", ["south road", "fir street"]),
    "glossop-rd-beech-hill": ("Glossop Road / Beech Hill Road", ["glossop road", "beech hill"]),
    "infirmary-road-tram": ("Infirmary Road tram stop", ["infirmary road"]),
    "university-tram": ("University of Sheffield tram stop", ["university of sheffield"]),
    "walkley-rd-stop": ("Walkley Road bus stop", ["walkley road"]),
    "clarkehouse-rd-stop": ("Clarkehouse Road bus stop", ["clarkehouse road"]),
    "hillsborough-tram": ("Hillsborough tram stop", ["hillsborough"]),
    "hillsborough-interchange": ("Hillsborough Interchange", ["hillsborough interchange"]),
    "arundel-gate-stop": ("Arundel Gate bus stop", ["arundel gate"]),
    "cathedral-tram": ("Cathedral tram stop", ["cathedral"]),
    "station-tram": ("Sheffield Station / Sheffield Hallam University tram stop", ["sheffield station"]),
    "meadowhall-tram": ("Meadowhall Interchange tram stop", ["meadowhall"]),
}
BBOX = "53.35,-1.56,53.44,-1.38"


def option_by_id(option_id):
    option = next((item for item in sh.data()["options"] if item["id"] == option_id), None)
    if option is None:
        raise HTTPException(404, "Unknown journey option")
    return option


def query_for(option):
    names = [STOPS[stop][1][0] for leg in option["legs"] for stop in leg.get("stops", []) if stop in STOPS]
    clauses = []
    if names:
        pattern = "|".join(re.escape(name).replace(r"\ ", " ") for name in sorted(set(names)))
        clauses.append(f'nwr({BBOX})["name"~"{pattern}",i][~"^(highway|railway|public_transport)$"~"bus_stop|tram_stop|platform|stop_position"];')
    for leg in option["legs"]:
        if leg["mode"] in {"bus", "tram"} and leg.get("line"):
            # Values are trusted fixture data, never a user-provided Overpass expression.
            line = re.sub(r"[^a-zA-Z0-9 -]", "", leg["line"])
            clauses.append(f'rel({BBOX})["route"="{leg["mode"]}"]["ref"~"^{line}$",i];')
    return "[out:json][timeout:15];(" + "".join(clauses) + ");out geom;"


@lru_cache(maxsize=30)
def fetch_map_elements(option_id):
    option = option_by_id(option_id)
    if not any(leg["mode"] in {"bus", "tram"} for leg in option["legs"]):
        return []
    try:
        with httpx.Client(timeout=6, trust_env=False, headers={"User-Agent": "AccessRouteSheffieldHackathon/0.2"}) as client:
            response = client.post("https://overpass-api.de/api/interpreter", data={"data": query_for(option)})
            response.raise_for_status()
        return response.json()["elements"]
    except (httpx.HTTPError, ValueError, KeyError):
        # Some venue networks block Overpass. Reuse the existing cached, rate-limited
        # Nominatim integration for real stop pins; this cannot supply a service line.
        from app.navigation import geocode_request
        elements = []
        for leg in option["legs"]:
            for stop_id in leg.get("stops", []):
                if stop_id not in STOPS:
                    continue
                name, _ = STOPS[stop_id]
                kind = "tram stop" if leg["mode"] == "tram" else "bus stop"
                query = f'{name.replace(" / ", " ")}{"" if kind in name.lower() else " " + kind} Sheffield'
                try:
                    results = geocode_request("search", tuple(sorted({"format": "jsonv2", "q": query,
                        "limit": 5, "countrycodes": "gb", "extratags": 1}.items())))
                except HTTPException:
                    continue
                for result in results:
                    category = result.get("category", result.get("class", ""))
                    tags = {**(result.get("extratags") or {}), "name": result.get("name", ""), category: result.get("type", "")}
                    # A nearby road/building is not evidence for a bus or tram stop.
                    if not stop_match({"tags": tags}, STOPS[stop_id][1], leg["mode"]):
                        continue
                    elements.append({"type": result["osm_type"], "id": result["osm_id"],
                        "lat": float(result["lat"]), "lon": float(result["lon"]), "tags": tags})
        if elements:
            return elements
        raise HTTPException(502, "Transport map lookup is unavailable. Stop names are shown, but no coordinates or service path have been assumed.")


def stop_match(element, tokens, mode):
    tags = element.get("tags", {})
    name = tags.get("name", "").lower()
    if not all(token in name for token in tokens):
        return False
    if mode == "tram":
        return tags.get("railway") == "tram_stop" or tags.get("tram") == "yes"
    return tags.get("highway") == "bus_stop" or tags.get("bus") == "yes"


def map_option(option, elements):
    legs = []
    for index, leg in enumerate(option["legs"]):
        if leg["mode"] not in {"bus", "tram", "taxi"}:
            continue
        stops, missing = [], []
        ids = leg.get("stops", [])
        for stop_index, stop_id in enumerate(ids):
            name, tokens = STOPS.get(stop_id, (stop_id, [stop_id]))
            role = "board" if stop_index == 0 else "alight" if stop_index == len(ids) - 1 else "via"
            matches = [item for item in elements if stop_match(item, tokens, leg["mode"])]
            matches.sort(key=lambda item: (item.get("tags", {}).get("public_transport") != "platform", item.get("id", 0)))
            found = next((item for item in matches if "lat" in item or "center" in item), None)
            if found:
                point = found.get("center", found)
                stops.append({"name": name, "provider_name": found.get("tags", {}).get("name", name),
                              "coordinate": [point["lon"], point["lat"]], "role": role,
                              "source": f'https://www.openstreetmap.org/{found["type"]}/{found["id"]}',
                              "notice": "OSM stop-name match; service and boarding platform are not verified. Confirm before travelling.",
                              "candidate_count": len(matches)})
            else:
                missing.append({"name": name, "role": role})
        lines = []
        for element in elements:
            tags = element.get("tags", {})
            if element.get("type") != "relation" or tags.get("route") != leg["mode"] or tags.get("ref", "").lower() != leg.get("line", "").lower():
                continue
            for member in element.get("members", []):
                points = member.get("geometry", [])
                if member.get("type") != "way" or member.get("role", "").startswith("platform"):
                    continue
                if len(points) >= 2 and all("lat" in p and "lon" in p for p in points):
                    lines.append([[p["lon"], p["lat"]] for p in points])
        legs.append({"id": f'{option["id"]}-{index}', "map_stops": stops, "missing_stops": missing,
                     "geometry": {"type": "MultiLineString", "coordinates": lines} if lines else None,
                     "service_alignment": bool(lines)})
    return {"option_id": option["id"], "legs": legs,
            "notice": "Demonstration journey. OSM pins are stop-name matches; confirm the correct platform and service. Lines, when available, show the whole mapped service alignment, not a verified stop-to-stop journey or live timetable."}
