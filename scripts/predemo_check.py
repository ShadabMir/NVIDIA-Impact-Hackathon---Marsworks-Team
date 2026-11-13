"""Pre-demo check: tests every service the demo depends on and prints a pass/fail list.

Run from the repository root (no extra packages needed):

    python scripts/predemo_check.py

Settings are read from backend/.env and .env.local (the same files the app uses), and can be
overridden with environment variables. Keys are never printed.

Exit code is 1 if any required check fails, so it can be used in a script.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TIMEOUT = 10

PASS, WARN, FAIL = "PASS", "WARN", "FAIL"
SYMBOL = {PASS: "[ OK ]", WARN: "[WARN]", FAIL: "[FAIL]"}
results: list[tuple[str, str, str]] = []


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


config = {**read_env_file(ROOT / "backend" / ".env"), **read_env_file(ROOT / ".env.local")}


def setting(name: str, default: str = "") -> str:
    return os.environ.get(name) or config.get(name) or default


API = setting("VITE_API_BASE_URL", "http://localhost:8000").rstrip("/")
OLLAMA = setting("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
TTS = setting("TTS_BASE_URL").rstrip("/")
LIVEROADS_KEY = setting("VITE_LIVEROADS_KEY")
FRONTEND = setting("FRONTEND_URL", "http://localhost:5173").rstrip("/")


def record(status: str, name: str, detail: str) -> None:
    results.append((status, name, detail))
    print(f"{SYMBOL[status]} {name}: {detail}", flush=True)


def http(method: str, url: str, data: bytes | None = None, headers: dict | None = None):
    request = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.status, response.read(), response.headers.get("Content-Type", "")


def get_json(url: str):
    status, body, _ = http("GET", url)
    return status, json.loads(body or b"{}")


def explain(exc: Exception) -> str:
    if isinstance(exc, urllib.error.HTTPError):
        try:
            detail = json.loads(exc.read() or b"{}").get("detail", "")
        except ValueError:
            detail = ""
        return f"HTTP {exc.code}" + (f" - {detail}" if detail else "")
    if isinstance(exc, urllib.error.URLError):
        return f"cannot connect ({exc.reason})"
    return f"{type(exc).__name__}: {exc}"


def multipart(fields: dict[str, str]) -> tuple[bytes, str]:
    boundary = "----predemocheck"
    parts = []
    for key, value in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'
        )
    parts.append(f"--{boundary}--\r\n")
    return "".join(parts).encode("utf-8"), f"multipart/form-data; boundary={boundary}"


# ---------------------------------------------------------------- checks
def check_backend() -> None:
    try:
        _, body = get_json(f"{API}/health")
        record(PASS, "Backend API", f"{API} is running")
    except Exception as exc:
        record(FAIL, "Backend API", f"{API}: {explain(exc)}. Start it with uvicorn.")


def check_vision_model() -> None:
    try:
        _, body = get_json(f"{API}/health/model")
        record(PASS, "Letter-reading model", f"{body.get('model')} installed")
    except Exception as exc:
        record(WARN, "Letter-reading model", f"{explain(exc)} (letter upload will not work)")


def check_agent() -> None:
    try:
        _, body = get_json(f"{API}/api/v1/agent/health")
        record(PASS, "Nemotron agent", json.dumps(body)[:120])
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            record(WARN, "Nemotron agent", "not on this branch (merge the agent branch)")
        else:
            record(FAIL, "Nemotron agent", explain(exc))
    except Exception as exc:
        record(WARN, "Nemotron agent", explain(exc))


def check_ollama() -> None:
    try:
        _, body = get_json(f"{OLLAMA}/api/tags")
        names = [m.get("name", "") for m in body.get("models", [])]
        nemotron = [n for n in names if "nemotron" in n.lower()]
        if nemotron:
            record(PASS, "Ollama on the Spark", f"{len(names)} models; Nemotron: {', '.join(nemotron)}")
        else:
            record(WARN, "Ollama on the Spark", f"{len(names)} models, but no Nemotron model installed")
    except Exception as exc:
        record(WARN, "Ollama on the Spark", f"{OLLAMA}: {explain(exc)}")


def check_tts_service() -> None:
    if not TTS:
        record(WARN, "Chatterbox speech (Spark)", "TTS_BASE_URL not set; the browser voice will be used")
        return
    try:
        http("GET", f"{TTS}/v1/health/ready")
    except Exception as exc:
        record(FAIL, "Chatterbox speech (Spark)", f"{TTS}: {explain(exc)}")
        return
    try:
        body, content_type = multipart({
            "text": "Pre-demo check.",
            "language": setting("TTS_LANGUAGE", "en-US"),
            "voice": setting("TTS_VOICE", "Chatterbox-Multilingual.en-US.Male"),
        })
        _, audio, _ = http("POST", f"{TTS}/v1/audio/synthesize", body, {"Content-Type": content_type})
        if audio[:4] == b"RIFF":
            record(PASS, "Chatterbox speech (Spark)", f"ready and produced {len(audio) // 1024} KB of audio")
        else:
            record(FAIL, "Chatterbox speech (Spark)", "ready, but did not return WAV audio")
    except Exception as exc:
        record(FAIL, "Chatterbox speech (Spark)", f"synthesis failed: {explain(exc)}")


def check_tts_endpoint() -> None:
    try:
        _, body = get_json(f"{API}/api/v1/tts/health")
        record(PASS, "App speech endpoint", f"/api/v1/tts reaches the model ({body.get('voice')})")
    except urllib.error.HTTPError as exc:
        hint = " (start the API with app.main_tts:app)" if exc.code == 404 else ""
        record(WARN, "App speech endpoint", explain(exc) + hint)
    except Exception as exc:
        record(WARN, "App speech endpoint", explain(exc))


def check_liveroads() -> None:
    if not LIVEROADS_KEY:
        record(WARN, "Live Roads", "VITE_LIVEROADS_KEY not set in .env.local; the map shows cached incidents")
        return
    query = urllib.parse.urlencode({"status": "active", "key": LIVEROADS_KEY})
    try:
        status, body, _ = http("GET", f"https://liveroads.co.uk/api/v1/incidents?{query}")
        record(PASS, "Live Roads", f"key accepted (HTTP {status})")
    except urllib.error.HTTPError as exc:
        reason = "key rejected" if exc.code in (401, 403) else "service error"
        record(FAIL, "Live Roads", f"{reason}: HTTP {exc.code}")
    except Exception as exc:
        record(WARN, "Live Roads", explain(exc))


def check_weather() -> None:
    url = ("https://api.open-meteo.com/v1/forecast?latitude=53.3782&longitude=-1.4934"
           "&current=temperature_2m,weather_code,is_day")
    try:
        _, body = get_json(url)
        current = body.get("current", {})
        record(PASS, "Open-Meteo weather", f"{current.get('temperature_2m')} C, code {current.get('weather_code')}")
    except Exception as exc:
        record(WARN, "Open-Meteo weather", f"{explain(exc)} (weather card will not load)")


def check_frontend() -> None:
    try:
        http("GET", FRONTEND)
        record(PASS, "Frontend", f"{FRONTEND} is running")
    except Exception as exc:
        record(WARN, "Frontend", f"{FRONTEND}: {explain(exc)}. Start it with npm run dev.")


def main() -> int:
    print("AccessRoute pre-demo check\n")
    for check in (check_backend, check_vision_model, check_agent, check_ollama, check_tts_service,
                  check_tts_endpoint, check_liveroads, check_weather, check_frontend):
        try:
            check()
        except Exception as exc:  # never let one check stop the others
            record(FAIL, check.__name__, explain(exc))
    failed = sum(1 for status, *_ in results if status == FAIL)
    warned = sum(1 for status, *_ in results if status == WARN)
    print(f"\n{len(results) - failed - warned} passed, {warned} warnings, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
