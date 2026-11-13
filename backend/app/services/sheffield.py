"""Sheffield / Royal Hallamshire data access and deterministic route assessment.

The agent decides *what to look up*; this module decides *what is safe*. Every
hard access constraint (gradient, step-free, closed pavements, cancellations)
is enforced here by rules, never left to the language model.
"""
import json
from datetime import date, datetime, time, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from app.agent_schemas import (
    AccessNeeds,
    AgentDisruption,
    Barrier,
    LegOut,
    OptionAssessment,
    WeatherOut,
)

LONDON = ZoneInfo("Europe/London")
TRANSIT = {"bus", "tram"}

NOTICE = (
    "Demonstration data: routes, gradients, roadworks, events and toilets for the Royal Hallamshire "
    "scenario are illustrative, not verified travel advice. Weather is live from Open-Meteo when "
    "reachable. Entrance names come from the Sheffield Teaching Hospitals accessibility list; "
    "confirm details with AccessAble and the hospital before travelling."
)


@lru_cache
def data() -> dict[str, Any]:
    path = Path(__file__).resolve().parents[1] / "data" / "sheffield_rhh.json"
    return json.loads(path.read_text(encoding="utf-8"))


def hospital() -> dict[str, Any]:
    return data()["hospital"]


def origins() -> list[dict[str, Any]]:
    return data()["origins"]


def origin_ids() -> set[str]:
    return {o["id"] for o in origins()}


def scenarios() -> list[dict[str, Any]]:
    return data()["scenarios"]


def options_for(origin_id: str) -> list[dict[str, Any]]:
    return [o for o in data()["options"] if o["origin_id"] == origin_id]


def choose_entrance(department: str) -> dict[str, Any]:
    """Pick the entrance for a department. `matched` is False when the department is unclear."""
    dept = department.lower()
    entrances = hospital()["entrances"]
    for entrance in entrances:
        if any(word in dept for word in entrance["use_for"]):
            return {**entrance, "matched": True}
    main = next(e for e in entrances if e["id"] == "rhh-entrance-9")
    return {**main, "matched": False,
            "notes": f"Department '{department}' not recognised, so the main entrance is suggested. "
                     "Check the entrance or floor on your letter, or ask at main reception."}


def option_streets(options: list[dict[str, Any]]) -> set[str]:
    return {s for o in options for leg in o["legs"] for s in leg.get("streets", [])}


def option_stops(options: list[dict[str, Any]]) -> set[str]:
    return {s for o in options for leg in o["legs"] for s in leg.get("stops", [])}


def option_lines(options: list[dict[str, Any]]) -> set[str]:
    return {leg["line"] for o in options for leg in o["legs"] if leg.get("line")}


def active_roadworks(streets: set[str], day: date) -> list[dict[str, Any]]:
    return [
        rw for rw in data()["roadworks"]
        if rw["street"] in streets and date.fromisoformat(rw["start"]) <= day <= date.fromisoformat(rw["end"])
    ]


def events_near(arrive_by: datetime, window_hours: int = 3) -> list[dict[str, Any]]:
    """Events whose crowd window (1 h before start to 1 h after end) overlaps the journey window."""
    local = arrive_by.astimezone(LONDON)
    journey_start, journey_end = local - timedelta(hours=window_hours), local
    found = []
    for ev in data()["events"]:
        day = date.fromisoformat(ev["date"])
        start = datetime.combine(day, time.fromisoformat(ev["start"]), LONDON) - timedelta(hours=1)
        end = datetime.combine(day, time.fromisoformat(ev["end"]), LONDON) + timedelta(hours=1)
        if start < journey_end and end > journey_start:
            found.append(ev)
    return found


def published_disruptions() -> list[dict[str, Any]]:
    """Placeholder for a live Travel South Yorkshire / BODS feed. Demo: empty unless the data file lists some."""
    return list(data()["transport_status"])


def toilets_near(stops: set[str], changing_places: bool = False) -> list[dict[str, Any]]:
    stops = set(stops) | {"hospital"}
    return [
        t for t in data()["toilets"]
        if set(t["near_stops"]) & stops and (not changing_places or t["type"] == "changing_places")
    ]


# --------------------------------------------------------------------------- assessment

def _barrier(severity, category, message, mitigation=None) -> Barrier:
    return Barrier(severity=severity, category=category, message=message, mitigation=mitigation)


def assess_option(
    option: dict[str, Any],
    needs: AccessNeeds,
    arrive_by: datetime,
    weather: WeatherOut,
    roadworks: list[dict[str, Any]],
    events: list[dict[str, Any]],
    disruptions: list[AgentDisruption],
    earliest_departure: datetime | None,
) -> OptionAssessment:
    barriers: list[Barrier] = []
    limit = needs.gradient_limit
    total_roll = 0
    total = 0
    first_transit = True
    blocked_streets = {d.target for d in disruptions if d.type == "pavement_blocked"}
    broken_lifts = {d.target for d in disruptions if d.type == "lift_out_of_order"}

    for leg in option["legs"]:
        mode = leg["mode"]
        minutes = leg["minutes"]

        if mode == "roll":
            dist = leg.get("distance_m", 0)
            total_roll += dist
            grad = leg.get("max_gradient_pct") or 0
            streets = set(leg.get("streets", []))
            if grad > limit:
                severity = "blocking" if grad > limit + 2 else "warning"
                barriers.append(_barrier(severity, "gradient",
                    f"Slope of {grad:g}% on this route is steeper than your limit of {limit:g}%.",
                    "Choose a route that avoids this hill."))
            if weather.ice_risk and grad >= 4:
                barriers.append(_barrier("blocking" if needs.uses_wheels and grad >= 6 else "warning", "weather",
                    f"Ice risk on a {grad:g}% slope.", "Avoid hills while icy, or travel door to door."))
            if needs.step_free_required and leg.get("step_free") is False:
                barriers.append(_barrier("blocking", "step_free", "This section has steps."))
            if needs.uses_wheels and leg.get("dropped_kerbs") is False:
                barriers.append(_barrier("warning", "kerbs", "Missing dropped kerbs on this section.",
                    "Travel with a companion or choose another route."))
            if leg.get("surface") in {"uneven", "cobbles"} and needs.mobility_aid in {"manual_wheelchair", "walking_aid"}:
                barriers.append(_barrier("warning", "surface", f"Surface is {leg['surface']}."))
            if dist > needs.max_continuous_roll_m:
                barriers.append(_barrier("warning", "distance",
                    f"{dist} m without a stop is more than your limit of {needs.max_continuous_roll_m} m."))
            for street in streets & blocked_streets:
                d = next(d for d in disruptions if d.type == "pavement_blocked" and d.target == street)
                barriers.append(_barrier("blocking", "pavement_blocked",
                    d.description or f"Pavement blocked on {street}.", "Re-route, or report the obstruction."))
            for rw in roadworks:
                if rw["street"] not in streets:
                    continue
                if rw["pavement_closed"]:
                    sev = "warning" if rw["diversion_step_free"] else "blocking"
                    barriers.append(_barrier(sev, "roadworks", f"{rw['street_name']}: {rw['description']}",
                        "Use the signed step-free diversion." if rw["diversion_step_free"] else "Avoid this street until the works end."))
                elif rw.get("min_footway_width_mm") and rw["min_footway_width_mm"] < 1000 and needs.uses_wheels:
                    barriers.append(_barrier("warning", "roadworks",
                        f"{rw['street_name']}: footway narrowed to {rw['min_footway_width_mm']} mm. {rw['description']}",
                        "Check your chair/scooter width; a companion may help."))
                else:
                    barriers.append(_barrier("info", "roadworks", f"{rw['street_name']}: {rw['description']}"))
            if weather.rain and leg.get("exposed") and dist >= 100:
                barriers.append(_barrier("info", "weather", f"{dist} m outdoors in the rain.", "Take a waterproof cape or cover."))
            if weather.rain or weather.ice_risk:
                minutes = round(minutes * 1.25)

        elif mode in TRANSIT:
            line = leg.get("line")
            wait = round(leg.get("frequency_minutes", 0) / 2)
            if not first_transit:
                barriers.append(_barrier("info", "transfer", f"Change vehicles; allow up to {wait} minutes."))
            first_transit = False
            minutes += wait
            lines = set(leg.get("lines") or [line])  # e.g. "Blue or Yellow" legs list both
            cancelled = {d.target for d in disruptions
                         if d.type in {"tram_cancelled", "bus_cancelled"} and d.type.startswith(mode)}
            if lines & cancelled:
                if lines <= cancelled:
                    barriers.append(_barrier("blocking", "cancellation",
                        "; ".join(d.description or f"{d.target} cancelled" for d in disruptions if d.target in lines and d.type.endswith("cancelled"))))
                else:
                    barriers.append(_barrier("warning", "cancellation",
                        f"{', '.join(sorted(lines & cancelled))} cancelled; {', '.join(sorted(lines - cancelled))} still running, so expect longer waits and busier vehicles.",
                        "Allow an extra 10 minutes."))
                    minutes += 10
            for d in disruptions:
                if d.target not in lines:
                    continue
                if d.type in {"tram_cancelled", "bus_cancelled"}:
                    continue
                elif d.type in {"tram_delayed", "bus_delayed"} and d.type.startswith(mode):
                    minutes += d.delay_minutes
                    barriers.append(_barrier("warning", "delay",
                        d.description or f"{mode.title()} {d.target} delayed by {d.delay_minutes} min.",
                        f"Leave {d.delay_minutes} minutes earlier."))
                elif d.type == "event_crowding":
                    barriers.append(_barrier("warning", "crowding", d.description or "Very busy service.",
                        "Wheelchair space may be taken: allow time for the next service, or go door to door."))
            for stop in set(leg.get("stops", [])) & broken_lifts:
                barriers.append(_barrier("blocking", "lift", f"Lift out of order at {stop}."))
            for ev in events:
                if set(ev["lines"]) & lines or set(ev["stops"]) & set(leg.get("stops", [])):
                    sev = "warning"
                    barriers.append(_barrier(sev, "event",
                        f"{ev['name']} ({ev['start']}–{ev['end']}): about {ev['expected_crowd']:,} people expected.",
                        "Services will be crowded; wheelchair spaces may be taken." + (" You asked to avoid crowds." if needs.avoid_crowds else "")))
            spaces = leg.get("wheelchair_spaces")
            if needs.uses_wheels and spaces == 1:
                barriers.append(_barrier("info", "wheelchair_space",
                    f"{mode.title()} {line} has one wheelchair space; if it is taken, the next is about {leg.get('frequency_minutes')} min later."))

        elif mode == "taxi":
            if not needs.can_use_taxi:
                barriers.append(_barrier("warning", "cost", "You said a taxi is not an option for you.",
                    "Ask the hospital about NHS Patient Transport or travel cost help."))
            barriers.append(_barrier("info", "booking", "Book a wheelchair-accessible vehicle in advance and give the entrance name."))

        total += minutes

    if total_roll > needs.max_total_roll_m:
        barriers.append(_barrier("warning", "distance",
            f"{total_roll} m of wheeling/walking in total is more than your limit of {needs.max_total_roll_m} m."))

    if weather.strong_wind and total_roll >= 200:
        barriers.append(_barrier("info", "weather", "Strong wind on exposed sections."))

    total += needs.extra_minutes
    leave_at = arrive_by - timedelta(minutes=total)
    if earliest_departure and leave_at < earliest_departure:
        barriers.append(_barrier("blocking", "timing",
            f"You would need to leave at {leave_at.astimezone(LONDON):%H:%M}, before you are able to set off."))

    severities = {b.severity for b in barriers}
    status = "unsuitable" if "blocking" in severities else "caution" if "warning" in severities else "suitable"
    legs = [LegOut(mode=leg["mode"], instruction=leg["instruction"], minutes=leg["minutes"],
                   distance_m=leg.get("distance_m", 0), max_gradient_pct=leg.get("max_gradient_pct"),
                   line=leg.get("line")) for leg in option["legs"]]
    return OptionAssessment(
        id=option["id"], title=option["title"], kind=option["kind"], legs=legs,
        total_minutes=total, leave_at=leave_at, arrive_at=arrive_by, status=status,
        barriers=barriers, cost_note=option.get("cost_note"),
    )


STATUS_RANK = {"suitable": 0, "caution": 1, "unsuitable": 2}


def rank(assessments: list[OptionAssessment]) -> list[OptionAssessment]:
    return sorted(assessments, key=lambda a: (
        STATUS_RANK[a.status],
        a.kind == "taxi",
        sum(b.severity == "warning" for b in a.barriers),
        a.total_minutes,
    ))


def summarise(a: OptionAssessment) -> dict[str, Any]:
    """Compact view for the language model."""
    return {
        "id": a.id, "title": a.title, "kind": a.kind, "status": a.status,
        "leave_at": a.leave_at.astimezone(LONDON).strftime("%H:%M"),
        "total_minutes": a.total_minutes,
        "problems": [f"[{b.severity}] {b.message}" for b in a.barriers if b.severity != "info"],
        "notes": [b.message for b in a.barriers if b.severity == "info"][:3],
    }
