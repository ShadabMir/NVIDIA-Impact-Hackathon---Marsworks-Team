"""Royal Hallamshire agent endpoints, mounted under /api/v1/agent.

These sit alongside the original demo routes in main.py and do not change them.
"""
import httpx
from fastapi import APIRouter, HTTPException

from app.agent_schemas import (
    AgentDraftRequest,
    AgentDraftResponse,
    AgentPlanRequest,
    AgentPlanResponse,
    AgentReassessRequest,
)
from app.config import get_settings
from app.services import agent, drafts
from app.services.llm import ModelUnavailable, warmup
from app.services import sheffield as sh

router = APIRouter(prefix="/api/v1/agent", tags=["Agent (Royal Hallamshire)"])


def check_origin(req: AgentPlanRequest) -> None:
    if req.origin_id not in sh.origin_ids():
        raise HTTPException(422, f"Unknown origin_id. Use one of: {', '.join(sorted(sh.origin_ids()))}.")


@router.get("/health")
async def agent_health():
    """Is the agent's text model (Nemotron) reachable and installed?"""
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=5, trust_env=False) as client:
            r = await client.get(f"{settings.ollama_base_url.rstrip('/')}/api/tags")
            r.raise_for_status()
        names = {m["name"] for m in r.json()["models"]}
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(503, f"Model server not reachable at {settings.ollama_base_url}.") from exc
    model = settings.ollama_agent_model
    if model not in names and f"{model}:latest" not in names:
        raise HTTPException(503, f"{model} is not installed. Installed: {', '.join(sorted(names))}")
    return {"status": "available", "model": model, "ollama_base_url": settings.ollama_base_url}


@router.post("/warmup")
async def agent_warmup():
    """Load the agent model on the Spark and keep it loaded (OLLAMA_KEEP_ALIVE). Run before a demo."""
    settings = get_settings()
    try:
        stats = await warmup(settings)
    except ModelUnavailable as exc:
        raise HTTPException(503, f"Could not reach {settings.ollama_agent_model} at {settings.ollama_base_url}.") from exc
    return {"model": settings.ollama_agent_model, "keep_alive": settings.ollama_keep_alive,
            "load_seconds": round(stats["load_seconds"], 2), "total_seconds": round(stats["wall_seconds"], 2)}


@router.get("/context")
def context():
    """Origins, the hospital and its entrances, and preset disruption scenarios for the UI."""
    h = sh.hospital()
    return {
        "notice": sh.NOTICE,
        "hospital": {k: h[k] for k in ("id", "name", "address", "access_guide_url", "entrances")},
        "origins": sh.origins(),
        "scenarios": sh.scenarios(),
    }


@router.post("/plan", response_model=AgentPlanResponse)
async def plan(req: AgentPlanRequest):
    check_origin(req)
    return await agent.plan(req, get_settings())


@router.post("/reassess", response_model=AgentPlanResponse)
async def reassess(body: AgentReassessRequest):
    check_origin(body.request)
    req = body.request
    if body.earliest_departure:
        req = req.model_copy(update={"earliest_departure": body.earliest_departure})
    return await agent.plan(req, get_settings(), extra=body.disruptions)


@router.post("/draft", response_model=AgentDraftResponse)
async def draft(body: AgentDraftRequest):
    check_origin(body.request)
    settings = get_settings()
    # Re-run the rules-only plan to collect barriers quickly; the draft model call is separate.
    plan_result = await agent.plan(body.request.model_copy(update={"use_model": False}), settings)
    return await drafts.draft(body, plan_result, settings)
