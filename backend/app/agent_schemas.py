"""Schemas for the Royal Hallamshire agent endpoints (/api/v1/agent/*).

Kept separate from app/schemas.py so the original demo routes are unchanged.
"""
from typing import Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field
from app.schemas import MapStop, RouteGeometry


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


MobilityAid = Literal["manual_wheelchair", "powered_wheelchair", "mobility_scooter", "walking_aid", "none"]

# Default maximum comfortable gradient (%) by mobility aid. 1:20 = 5%, 1:12 ≈ 8.3%.
DEFAULT_MAX_GRADIENT = {
    "manual_wheelchair": 5.0,
    "powered_wheelchair": 8.3,
    "mobility_scooter": 8.3,
    "walking_aid": 8.3,
    "none": 12.5,
}


class AccessNeeds(StrictModel):
    mobility_aid: MobilityAid = "powered_wheelchair"
    max_gradient_pct: float | None = Field(default=None, ge=0, le=30, description="Defaults by mobility aid if omitted.")
    max_continuous_roll_m: int = Field(default=300, ge=0, le=5000)
    max_total_roll_m: int = Field(default=800, ge=0, le=10000)
    step_free_required: bool = True
    needs_accessible_toilet: bool = False
    needs_changing_places: bool = False
    avoid_crowds: bool = False
    extra_minutes: int = Field(default=15, ge=0, le=120, description="Extra time for ramps, boarding and rests.")
    can_use_taxi: bool = True
    condition_notes: str | None = Field(default=None, max_length=300, description="Optional, e.g. 'fatigue after 10 minutes'. Only sent to the local model.")

    @property
    def gradient_limit(self) -> float:
        return self.max_gradient_pct if self.max_gradient_pct is not None else DEFAULT_MAX_GRADIENT[self.mobility_aid]

    @property
    def uses_wheels(self) -> bool:
        return self.mobility_aid in {"manual_wheelchair", "powered_wheelchair", "mobility_scooter"}


class AgentAppointment(StrictModel):
    hospital_id: Literal["royal-hallamshire"] = "royal-hallamshire"
    department: str = Field(min_length=1, max_length=150)
    arrive_by: AwareDatetime = Field(description="Time to be at the entrance, including check-in buffer, e.g. 2026-11-16T10:15:00+00:00")
    confirmed_by_user: Literal[True]


DisruptionType = Literal[
    "tram_cancelled", "tram_delayed", "bus_cancelled", "bus_delayed",
    "pavement_blocked", "lift_out_of_order", "event_crowding", "severe_weather",
]


class AgentDisruption(StrictModel):
    type: DisruptionType
    target: str = Field(min_length=1, max_length=80, description="Line ('95', 'Blue'), street id ('beech-hill-road'), stop id, or 'ice'/'rain'.")
    delay_minutes: int = Field(default=0, ge=0, le=240)
    description: str = Field(default="", max_length=300)


class AgentPlanRequest(StrictModel):
    origin_id: str = "walkley"
    appointment: AgentAppointment
    needs: AccessNeeds = Field(default_factory=AccessNeeds)
    disruptions: list[AgentDisruption] = Field(default_factory=list, max_length=20)
    earliest_departure: AwareDatetime | None = None
    use_model: bool = Field(default=True, description="Use the local Nemotron agent. False = fast rules-only pipeline.")


class AgentReassessRequest(StrictModel):
    request: AgentPlanRequest
    disruptions: list[AgentDisruption] = Field(default_factory=list, max_length=20)
    earliest_departure: AwareDatetime | None = None


class Barrier(StrictModel):
    severity: Literal["info", "warning", "blocking"]
    category: str
    message: str
    mitigation: str | None = None


class LegOut(StrictModel):
    mode: Literal["roll", "bus", "tram", "taxi"]
    instruction: str
    minutes: int
    distance_m: int = 0
    max_gradient_pct: float | None = None
    line: str | None = None
    geometry: RouteGeometry | None = None
    map_stops: list[MapStop] = Field(default_factory=list)


class OptionAssessment(StrictModel):
    id: str
    title: str
    kind: Literal["public", "taxi"]
    legs: list[LegOut]
    total_minutes: int
    leave_at: AwareDatetime
    arrive_at: AwareDatetime
    status: Literal["suitable", "caution", "unsuitable"]
    barriers: list[Barrier]
    cost_note: str | None = None
    data_status: Literal["simulated"] = "simulated"


class WeatherOut(StrictModel):
    source: Literal["open-meteo", "scenario", "unavailable"]
    summary: str
    temperature_c: float | None = None
    precipitation_mm: float | None = None
    precipitation_probability: int | None = None
    wind_kph: float | None = None
    rain: bool = False
    ice_risk: bool = False
    strong_wind: bool = False


class AgentStep(StrictModel):
    step: int
    actor: Literal["model", "safety_net", "rules"]
    tool: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    result_summary: str


class Recommendation(StrictModel):
    option_id: str | None
    summary: str
    reasons: list[str]
    tips: list[str]
    generated_by: Literal["model", "rules"]


class ModelStats(StrictModel):
    """What the local model on the DGX Spark actually did for this plan (from Ollama's own counters)."""
    model: str
    calls: int
    prompt_tokens: int
    output_tokens: int
    model_seconds: float
    tokens_per_second: float | None
    load_seconds: float


class AgentPlanResponse(StrictModel):
    data_status: Literal["demo_mixed"] = "demo_mixed"
    notice: str
    hospital: str
    entrance: dict[str, Any]
    arrive_by: AwareDatetime
    weather: WeatherOut
    options: list[OptionAssessment]
    recommendation: Recommendation
    support_needed: bool
    suggested_actions: list[dict[str, str]]
    toilets: list[dict[str, Any]]
    events: list[dict[str, Any]]
    roadworks: list[dict[str, Any]]
    disruptions_applied: list[AgentDisruption]
    agent_mode: Literal["model_directed", "rules_only", "model_unavailable_fallback"]
    model: str | None
    agent_steps: list[AgentStep]
    model_stats: ModelStats | None = None
    elapsed_seconds: float = 0


DraftKind = Literal["blocked_pavement_report", "hospital_transport_request", "operator_feedback"]


class AgentDraftRequest(StrictModel):
    kind: DraftKind
    request: AgentPlanRequest
    location: str | None = Field(default=None, max_length=200, description="For pavement reports, e.g. 'Beech Hill Road footway near Glossop Road'.")
    details: str | None = Field(default=None, max_length=600)
    use_model: bool = True


class AgentDraftResponse(StrictModel):
    kind: DraftKind
    recipient: str
    how_to_send: str
    subject: str
    body: str
    sent: Literal[False] = False
    requires_review: Literal[True] = True
    generated_by: Literal["model", "template"]
