"""Per-account editable forms. Raw letters, routes and GPS traces are not retained."""
import json
from datetime import date as CalendarDate, datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import AwareDatetime, Field

from app.agent_schemas import AgentPlanRequest
from app.profiles import check_origin, current_user, database
from app.schemas import StrictModel

router = APIRouter(prefix="/api/v1/workspace", tags=["Saved forms"])


class AppointmentForm(StrictModel):
    hospital_id: Literal["northern-general-demo"]
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
        appointment=json.loads(row["appointment"]) if row["appointment"] else None,
        agent_request=json.loads(row["agent_request"]) if row["agent_request"] else None,
        updated_at=row["updated_at"],
    )


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
