"""Per-account editable forms. Raw letters, routes and GPS traces are not retained."""
import json
from datetime import date as CalendarDate, datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import ValidationError, AwareDatetime, Field

from app.agent_schemas import AgentPlanRequest
from app.profiles import check_origin, current_user, database
from app.schemas import StrictModel

router = APIRouter(prefix="/api/v1/workspace", tags=["Saved forms"])


class AppointmentForm(StrictModel):
    hospital_id: Literal["royal-hallamshire"]
    department: str = Field(min_length=1, max_length=150)
    date: CalendarDate
    arrival: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    origin: str = Field(default="", max_length=500)


class WorkspaceUpdate(StrictModel):
    appointment: AppointmentForm | None = None
    agent_request: AgentPlanRequest | None = None


class WorkspaceResponse(WorkspaceUpdate):
    updated_at: AwareDatetime | None = None


def read_workspace(connection, user_id):
    row = connection.execute("SELECT * FROM user_workspace WHERE user_id=?", (user_id,)).fetchone()
    if row is None:
        return WorkspaceResponse()
    return WorkspaceResponse(
        appointment=stored_form(row["appointment"], AppointmentForm),
        agent_request=stored_form(row["agent_request"], AgentPlanRequest),
        updated_at=row["updated_at"],
    )


def stored_form(text, model):
    """Saved forms written by other versions of the app (another branch sharing this database,
    e.g. a Northern General appointment) may not fit this version: ignore them instead of failing."""
    if not text:
        return None
    try:
        return model.model_validate_json(text)
    except ValidationError:
        return None


@router.get("", response_model=WorkspaceResponse)
def get_workspace(response: Response, user=Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    connection = database()
    try:
        return read_workspace(connection, user["id"])
    finally:
        connection.close()


@router.patch("", response_model=WorkspaceResponse, dependencies=[Depends(check_origin)])
def save_workspace(payload: WorkspaceUpdate, response: Response, user=Depends(current_user)):
    response.headers["Cache-Control"] = "no-store"
    connection = database()
    try:
        # Serialize partial updates from the two pages so one cannot erase the other's form.
        with connection:
            connection.execute("BEGIN IMMEDIATE")
            current = read_workspace(connection, user["id"])
            updated = WorkspaceResponse.model_validate({
                **current.model_dump(), **payload.model_dump(exclude_unset=True),
                "updated_at": datetime.now(timezone.utc),
            })
            connection.execute(
                "INSERT INTO user_workspace (user_id,appointment,agent_request,updated_at) VALUES (?,?,?,?) "
                "ON CONFLICT(user_id) DO UPDATE SET appointment=excluded.appointment, "
                "agent_request=excluded.agent_request, updated_at=excluded.updated_at",
                (user["id"], updated.appointment.model_dump_json() if updated.appointment else None,
                 updated.agent_request.model_dump_json() if updated.agent_request else None,
                 updated.updated_at.isoformat()),
            )
        return updated
    finally:
        connection.close()
