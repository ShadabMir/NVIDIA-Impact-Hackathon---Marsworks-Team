from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.schemas import (
    ExtractionResponse,
    Hospital,
    JourneyRequest,
    JourneyResponse,
    ReassessmentRequest,
    SupportDraftRequest,
    SupportDraftResponse,
)
from app.services.extraction import extract_appointment
from app.services.journeys import NOTICE, load_routes, plan_journey
from app.profiles import router as profile_router
from app.navigation import router as navigation_router
from app.workspace import router as workspace_router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_routes()  # Fail at startup if shared fixtures are invalid.
    yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH"],
    allow_headers=["Content-Type"],
)
app.include_router(profile_router)
app.include_router(navigation_router)
app.include_router(workspace_router)


@app.get("/health", tags=["System"])
def health():
    return {"status": "ok", "routing_mode": "demo", "model_configured": bool(settings.ollama_model),
            "live_navigation_configured": bool(settings.ors_api_key)}


@app.get("/health/model", tags=["System"])
async def model_health():
    if not settings.ollama_model:
        raise HTTPException(503, "OLLAMA_MODEL is not configured.")
    try:
        async with httpx.AsyncClient(timeout=5, trust_env=False) as client:
            response = await client.get(f"{settings.ollama_base_url.rstrip('/')}/api/tags")
            response.raise_for_status()
        names = {model["name"] for model in response.json()["models"]}
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(503, "The configured model server is unavailable.") from exc
    requested = settings.ollama_model
    if requested not in names and f"{requested}:latest" not in names:
        raise HTTPException(503, "The configured model is not installed on the model server.")
    return {"status": "available", "model": requested, "vision_support": "not_checked"}


@app.get("/api/v1/hospitals", response_model=list[Hospital], tags=["Hospitals"])
def hospitals():
    return [Hospital(id="northern-general-demo", name="Northern General Hospital (demo)", notice=NOTICE)]


@app.post("/api/v1/appointments/extract", response_model=ExtractionResponse, tags=["Appointments"])
async def extract(file: UploadFile):
    try:
        if file.content_type not in {"image/jpeg", "image/png"}:
            raise HTTPException(415, "Upload a JPEG or PNG photograph. PDF support is not implemented yet.")
        data = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
        if len(data) > settings.max_upload_mb * 1024 * 1024:
            raise HTTPException(413, f"Image exceeds {settings.max_upload_mb} MB.")
        if not (data.startswith(b"\x89PNG\r\n\x1a\n") or data.startswith(b"\xff\xd8\xff")):
            raise HTTPException(415, "File does not have a JPEG or PNG signature.")
        return await extract_appointment(data, settings)
    finally:
        await file.close()


@app.post("/api/v1/journeys/plan", response_model=JourneyResponse, tags=["Journeys"])
def plan(request: JourneyRequest):
    return plan_journey(request)


def validate_disruption(disruption):
    known = {route.id for route in load_routes()}
    supplied = set(disruption.unavailable_route_ids) | set(disruption.delay_minutes_by_route)
    if supplied - known:
        raise HTTPException(422, "Unknown route ID in disruption.")


@app.post("/api/v1/journeys/reassess", response_model=JourneyResponse, tags=["Journeys"])
def reassess(request: ReassessmentRequest):
    validate_disruption(request.disruption)
    return plan_journey(request.journey, request.disruption, request.earliest_departure)


@app.post("/api/v1/support/draft", response_model=SupportDraftResponse, tags=["Support"])
def support_draft(request: SupportDraftRequest):
    validate_disruption(request.disruption)
    result = plan_journey(request.journey, request.disruption, request.earliest_departure)
    barriers = sorted({
        issue
        for assessment in result.assessments
        for issue in assessment.reasons + assessment.unknowns
    })
    access = request.journey.access
    appointment = request.journey.appointment
    outcome = (
        "No route could be confirmed against the supplied requirements in the demo scenario."
        if result.support_needed else
        "A route matches the simulated requirements, but real-world accessibility still needs confirmation."
    )
    body = (
        "DRAFT — DEMONSTRATION DATA — please review before use.\n\n"
        "Hello,\n\nI would like advice about travel support for my appointment.\n"
        f"Hospital: Northern General Hospital\nDepartment: {appointment.department}\n"
        f"Required arrival: {appointment.arrive_by.isoformat()}\n"
        f"Wheelchair user: {access.wheelchair_user}; step-free required: "
        f"{access.step_free_required or access.wheelchair_user}\n"
        f"Maximum continuous walking: {access.max_continuous_walking_m} m; "
        f"total walking: {access.max_total_walking_m} m; "
        f"minimum transfer time: {access.min_transfer_minutes} minutes.\n\n"
        f"{outcome}\n"
        + ("Issues identified across the assessed routes:\n" + "\n".join(f"- {b}" for b in barriers) if barriers else "")
        + "\n\nCould you advise what assistance or alternative travel options may be available? "
        "I understand that eligibility and availability must be assessed by the relevant service.\n\n"
        "[Add preferred contact details before sending.]"
    )
    return SupportDraftResponse(subject="Draft request for appointment travel support", body=body)
