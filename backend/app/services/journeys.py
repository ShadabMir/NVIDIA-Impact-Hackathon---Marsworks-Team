import json
from datetime import datetime, timedelta
from pathlib import Path

from app.schemas import (
    Disruption,
    JourneyRequest,
    JourneyResponse,
    RouteAssessment,
    RouteOption,
)

NOTICE = (
    "Demonstration only: routes, times, stops and entrances are fictional. "
    "Accessibility flags are simulated, not verified. Do not use for real travel. "
    "A live transport provider and sourced hospital access data are not yet connected."
)


def load_routes() -> list[RouteOption]:
    path = Path(__file__).resolve().parents[1] / "data" / "demo_routes.json"
    return [RouteOption.model_validate(item) for item in json.loads(path.read_text())]


def plan_journey(
    request: JourneyRequest,
    disruption: Disruption | None = None,
    earliest_departure: datetime | None = None,
) -> JourneyResponse:
    disruption = disruption or Disruption()
    assessments = []
    for route in load_routes():
        access = request.access
        reasons: list[str] = []
        unknowns: list[str] = []
        if route.id in disruption.unavailable_route_ids:
            reasons.append("Route is unavailable in the supplied disruption scenario.")
        if route.max_continuous_walking_m > access.max_continuous_walking_m:
            reasons.append("A walking leg exceeds the continuous walking limit.")
        if route.total_walking_m > access.max_total_walking_m:
            reasons.append("Total walking distance exceeds the specified limit.")
        if any(t < access.min_transfer_minutes for t in route.transfer_minutes):
            reasons.append("A transfer is shorter than the required minimum.")
        if access.max_gradient_percent is not None:
            if route.max_gradient_percent is None:
                unknowns.append("Route gradient has not been verified.")
            elif route.max_gradient_percent > access.max_gradient_percent:
                reasons.append("Route gradient exceeds your slope preference.")
        for required, available, label in [
            (access.step_free_required or access.wheelchair_user, route.step_free, "Step-free access"),
            (access.wheelchair_user, route.wheelchair_accessible, "Wheelchair access"),
        ]:
            if required and available is False:
                reasons.append(f"{label} requirement is not met.")
            elif required and available is None:
                unknowns.append(f"{label} has not been verified.")
        boardings = sum(leg.mode == "bus" for leg in route.legs)
        buffer = access.boarding_buffer_minutes * boardings
        duration = route.duration_minutes + disruption.delay_minutes_by_route.get(route.id, 0) + buffer
        leave_at = request.appointment.arrive_by - timedelta(minutes=duration)
        if earliest_departure and leave_at < earliest_departure:
            reasons.append("Cannot arrive by the required time when leaving at or after the earliest departure.")
        status = "rejected" if reasons else "needs_verification" if unknowns else "matches_demo_requirements"
        assessments.append(RouteAssessment(
            route=route,
            status=status,
            reasons=reasons,
            unknowns=unknowns,
            leave_at=leave_at,
            arrive_at=request.appointment.arrive_by,
        ))
    eligible = sorted(
        [a for a in assessments if a.status == "matches_demo_requirements"],
        key=lambda a: (a.arrive_at - a.leave_at).total_seconds(),
    )
    return JourneyResponse(
        notice=NOTICE,
        recommended_route_id=eligible[0].route.id if eligible else None,
        support_needed=not bool(eligible),
        assessments=assessments,
    )
