"""AccessRoute AI Journey Planner: API.

Royal Hallamshire journeys are planned by the Nemotron agent (/api/v1/agent/*). This module adds
health checks, letter extraction (vision model on the Spark), accounts/profiles, saved forms,
location/navigation and text-to-speech.
"""
import httpx
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.agent_routes import router as agent_router
from app.config import get_settings
from app.schemas import ExtractionResponse, Hospital
from app.services.extraction import extract_appointment
from app.profiles import router as profile_router
from app.navigation import router as navigation_router
from app.workspace import router as workspace_router
from app.tts import router as tts_router
from app.voice import router as voice_router
from app.services.sheffield import NOTICE as SHEFFIELD_NOTICE

settings = get_settings()

app = FastAPI(title=settings.app_name, version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH"],
    allow_headers=["Content-Type"],
)
app.include_router(profile_router)
app.include_router(navigation_router)
app.include_router(agent_router)
app.include_router(workspace_router)
app.include_router(voice_router)  # voice input for the appointment form (/api/v1/appointments/voice)
app.include_router(tts_router)  # text-to-speech (/api/v1/tts); the UI falls back to the browser voice


@app.get("/health", tags=["System"])
def health():
    return {"status": "ok", "routing_mode": "agent", "model_configured": bool(settings.ollama_model),
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
    # Journeys are planned by the Nemotron agent (/api/v1/agent/*), which has Royal Hallamshire data.
    return [Hospital(id="royal-hallamshire", name="Royal Hallamshire Hospital", notice=SHEFFIELD_NOTICE)]


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
