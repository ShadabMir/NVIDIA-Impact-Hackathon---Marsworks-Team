"""Kept for compatibility: app.main now includes the text-to-speech routes itself.

``python -m uvicorn app.main_tts:app`` and ``app.main:app`` serve the same API.
"""

from app.main import app  # noqa: F401
