from datetime import date, time
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AppointmentExtraction(StrictModel):
    hospital: str | None = None
    department: str | None = None
    appointment_date: date | None = None
    appointment_time: time | None = None
    arrival_time: time | None = None
    warnings: list[str] = Field(default_factory=list)


class ExtractionResponse(StrictModel):
    details: AppointmentExtraction
    requires_confirmation: Literal[True] = True
    processing_location: Literal["configured_local_model_server"] = "configured_local_model_server"
    model: str


class AccessRequirements(StrictModel):
    wheelchair_user: bool = False
    step_free_required: bool = False
    max_continuous_walking_m: int = Field(default=150, ge=0, le=10000)
    max_total_walking_m: int = Field(default=300, ge=0, le=20000)
    min_transfer_minutes: int = Field(default=10, ge=0, le=120)
    max_gradient_percent: float | None = Field(default=None, ge=0, le=15)
    boarding_buffer_minutes: int = Field(default=0, ge=0, le=30)


class Appointment(StrictModel):
    hospital_id: Literal["northern-general-demo"]
    department: str = Field(min_length=1, max_length=150)
    # Include a timezone offset, e.g. 2026-11-20T10:00:00+00:00.
    arrive_by: AwareDatetime
    confirmed_by_user: Literal[True]


class JourneyRequest(StrictModel):
    # Only this fixture origin is supported until a live provider is connected.
    origin_id: Literal["demo-home"] = "demo-home"
    appointment: Appointment
    access: AccessRequirements = Field(default_factory=AccessRequirements)


class RouteGeometry(StrictModel):
    type: Literal["LineString"]
    coordinates: list[tuple[float, float]] = Field(min_length=2)

    @model_validator(mode="after")
    def valid_coordinates(self):
        if any(not (-180 <= lon <= 180 and -90 <= lat <= 90) for lon, lat in self.coordinates):
            raise ValueError("Route coordinates must be longitude/latitude in WGS84")
        return self


class MapStop(StrictModel):
    name: str = Field(max_length=200)
    coordinate: tuple[float, float]

    @model_validator(mode="after")
    def valid_coordinate(self):
        lon, lat = self.coordinate
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise ValueError("Stop coordinates must be longitude/latitude in WGS84")
        return self


class JourneyLeg(StrictModel):
    mode: Literal["walk", "roll", "bus", "tram", "taxi", "transfer"]
    instruction: str
    duration_minutes: int = Field(ge=0)
    walking_distance_m: int = Field(default=0, ge=0)
    line: str | None = None
    geometry: RouteGeometry | None = None
    map_stops: list[MapStop] = Field(default_factory=list)


class RouteOption(StrictModel):
    id: str
    title: str
    entrance: str
    duration_minutes: int
    total_walking_m: int
    max_continuous_walking_m: int
    transfer_minutes: list[int]
    step_free: bool | None
    wheelchair_accessible: bool | None
    legs: list[JourneyLeg]
    data_status: Literal["simulated"] = "simulated"
    sources: list[str] = Field(default_factory=list)
    max_gradient_percent: float | None = None


class RouteAssessment(StrictModel):
    route: RouteOption
    status: Literal["matches_demo_requirements", "needs_verification", "rejected"]
    reasons: list[str]
    unknowns: list[str]
    leave_at: AwareDatetime
    arrive_at: AwareDatetime


class JourneyResponse(StrictModel):
    data_status: Literal["simulated"] = "simulated"
    notice: str
    recommended_route_id: str | None
    support_needed: bool
    assessments: list[RouteAssessment]


class Disruption(StrictModel):
    unavailable_route_ids: list[str] = Field(default_factory=list, max_length=20)
    delay_minutes_by_route: dict[str, int] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_delays(self):
        if len(self.delay_minutes_by_route) > 20:
            raise ValueError("At most 20 delayed routes are supported")
        if any(delay < 0 or delay > 240 for delay in self.delay_minutes_by_route.values()):
            raise ValueError("Delay must be between 0 and 240 minutes")
        return self


class ReassessmentRequest(StrictModel):
    journey: JourneyRequest
    disruption: Disruption
    # Optional earliest departure; prevents a delayed route being proposed in the past.
    earliest_departure: AwareDatetime | None = None


class SupportDraftRequest(StrictModel):
    journey: JourneyRequest
    disruption: Disruption = Field(default_factory=Disruption)
    earliest_departure: AwareDatetime | None = None


class SupportDraftResponse(StrictModel):
    subject: str
    body: str
    sent: Literal[False] = False
    generation_method: Literal["template"] = "template"
    requires_review: Literal[True] = True
    data_status: Literal["simulated"] = "simulated"


class Hospital(StrictModel):
    id: str
    name: str
    data_status: Literal["simulated"] = "simulated"
    notice: str
