#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

# Prefer a normal Node/npm install; this Mac also has Node bundled with ChatGPT.
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  bundled_runtime="/Applications/ChatGPT.app/Contents/Resources/cua_node"
  if [ -x "$bundled_runtime/bin/node" ] && [ -f "$bundled_runtime/lib/node_modules/corepack/shims/npm" ]; then
    export PATH="$bundled_runtime/bin:$bundled_runtime/lib/node_modules/corepack/shims:$PATH"
  else
    echo "Install Node.js (22.12+ or 24+) with npm, then rerun this script."
    exit 1
  fi
fi

export npm_config_cache="$project_dir/.cache/npm"
export COREPACK_HOME="$project_dir/.cache/corepack"
export COREPACK_ENABLE_AUTO_PIN=0

if [ ! -x backend/.venv/bin/python ]; then
  if command -v python3.12 >/dev/null 2>&1; then
    python3.12 -m venv backend/.venv
  else
    python3 -m venv backend/.venv
  fi
fi

if ! backend/.venv/bin/python -c 'import fastapi, uvicorn, httpx, pydantic_settings, multipart' >/dev/null 2>&1; then
  backend/.venv/bin/python -m pip install -r backend/requirements-dev.txt
fi

if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
fi

if [ ! -d node_modules/vite ] || [ ! -d node_modules/react ]; then
  npm ci
fi

backend_pid=""
frontend_pid=""
cleanup() {
  trap - EXIT INT TERM
  for pid in "$frontend_pid" "$backend_pid"; do
    if [ -n "$pid" ]; then
      # npm may launch Vite as a child; stop it along with its parent.
      pkill -TERM -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

(
  cd backend
  exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
) &
backend_pid=$!

npm run dev -- --host 127.0.0.1 --port 5173 --strictPort &
frontend_pid=$!

echo "Starting app: http://localhost:5173"
echo "API documentation: http://localhost:8000/docs"
echo "Use Ctrl+C to stop both servers."

while kill -0 "$backend_pid" 2>/dev/null && kill -0 "$frontend_pid" 2>/dev/null; do
  sleep 1
done

echo "A server stopped. Review the output above for the error."
exit 1
