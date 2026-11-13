"""Local model requests must not accidentally use a machine-wide SOCKS proxy."""
import asyncio

from app.config import Settings
from app.services.llm import make_client


def test_local_model_client_does_not_load_proxy_environment(monkeypatch):
    monkeypatch.setenv("ALL_PROXY", "socks5://127.0.0.1:9999")
    monkeypatch.setenv("HTTP_PROXY", "socks5://127.0.0.1:9999")
    monkeypatch.setenv("HTTPS_PROXY", "socks5://127.0.0.1:9999")

    async def check():
        async with make_client(Settings()) as client:
            assert client.trust_env is False

    asyncio.run(check())
