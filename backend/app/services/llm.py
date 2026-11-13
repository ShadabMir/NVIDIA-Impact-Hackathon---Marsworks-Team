"""Minimal client for the local Ollama server on the DGX Spark (text + tool calling).

Every call records Ollama's own timing and token counts so the UI can show what the
local model actually did (calls, tokens, tokens/second, load time).
"""
import time
from typing import Any

import httpx

from app.config import Settings

NS = 1_000_000_000


class ModelUnavailable(Exception):
    pass


def make_client(settings: Settings) -> httpx.AsyncClient:
    # Tests monkeypatch this to inject a fake model server.
    return httpx.AsyncClient(timeout=settings.ollama_timeout_seconds)


def call_stats(body: dict[str, Any], wall_seconds: float) -> dict[str, float]:
    return {
        "prompt_tokens": body.get("prompt_eval_count") or 0,
        "output_tokens": body.get("eval_count") or 0,
        "generation_seconds": (body.get("eval_duration") or 0) / NS,
        "prompt_seconds": (body.get("prompt_eval_duration") or 0) / NS,
        "load_seconds": (body.get("load_duration") or 0) / NS,
        "wall_seconds": wall_seconds,
    }


async def chat(
    settings: Settings,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    fmt: dict[str, Any] | str | None = None,
    num_predict: int = 700,
    stats: list[dict[str, float]] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": settings.ollama_agent_model,
        "messages": messages,
        "stream": False,
        "think": False,
        "keep_alive": settings.ollama_keep_alive,
        "options": {"temperature": 0, "num_ctx": 8192, "num_predict": num_predict},
    }
    if tools:
        payload["tools"] = tools
    if fmt:
        payload["format"] = fmt
    started = time.perf_counter()
    try:
        async with make_client(settings) as client:
            r = await client.post(f"{settings.ollama_base_url.rstrip('/')}/api/chat", json=payload)
            r.raise_for_status()
            body = r.json()
            message = body["message"]
    except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
        raise ModelUnavailable(str(exc) or exc.__class__.__name__) from exc
    if stats is not None:
        stats.append(call_stats(body, time.perf_counter() - started))
    return message


async def warmup(settings: Settings) -> dict[str, float]:
    """Load the agent model into GPU memory and keep it there, so the demo's first plan is fast."""
    stats: list[dict[str, float]] = []
    await chat(settings, [{"role": "user", "content": "Reply OK."}], num_predict=2, stats=stats)
    return stats[0]
