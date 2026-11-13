from datetime import date, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


class Hospital(StrictModel):
    id: str
    name: str
    data_status: Literal["simulated"] = "simulated"
    notice: str
