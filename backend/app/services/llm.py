"""Minimal client for the local Ollama server on the DGX Spark (text + tool calling)."""
from typing import Any

import httpx

from app.config import Settings


class ModelUnavailable(Exception):
    pass


def make_client(settings: Settings) -> httpx.AsyncClient:
    # Tests monkeypatch this to inject a fake model server.
    # Model traffic is local/private and must not inherit a system HTTP/SOCKS proxy.
    return httpx.AsyncClient(timeout=settings.ollama_timeout_seconds, trust_env=False)


async def chat(
    settings: Settings,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    fmt: dict[str, Any] | str | None = None,
    num_predict: int = 700,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": settings.ollama_agent_model,
        "messages": messages,
        "stream": False,
        "think": False,
        "options": {"temperature": 0, "num_ctx": 8192, "num_predict": num_predict},
    }
    if tools:
        payload["tools"] = tools
    if fmt:
        payload["format"] = fmt
    try:
        async with make_client(settings) as client:
            r = await client.post(f"{settings.ollama_base_url.rstrip('/')}/api/chat", json=payload)
            r.raise_for_status()
            return r.json()["message"]
    except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
        raise ModelUnavailable(str(exc) or exc.__class__.__name__) from exc
