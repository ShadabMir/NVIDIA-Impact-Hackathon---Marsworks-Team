"""The existing API plus the text-to-speech endpoints.

Run with ``python -m uvicorn app.main_tts:app --port 8000`` instead of ``app.main:app``.
Every existing route is unchanged; this file only adds /api/v1/tts.
"""

from app.main import app
from app.tts import router as tts_router

app.include_router(tts_router)
