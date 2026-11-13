# Hospital Journey Assistant

Mobile-friendly hospital journey planning prototype for the NVIDIA Hack for Impact hackathon.

## Test the app: quick start (Windows PowerShell)

You need **three PowerShell windows**, all left open. Replace `sparkX` and `user11` with your
assigned Spark and login. On Mac/Linux, use `source .venv/bin/activate` and `cp` instead of
`.venv\Scripts\Activate.ps1` and `copy`.

**Window 1: SSH tunnel to the DGX Spark** (no output means it's working):

```powershell
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:11435:127.0.0.1:11434 user11@sparkX.local
```

**Window 2: backend (FastAPI on port 8000).** Run from the repository root, first time only:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
copy .env.example .env
notepad .env
```

In Notepad, set `OLLAMA_BASE_URL=http://127.0.0.1:11435` and save. Then run the tests and start
the API:

```powershell
python -m pytest -q
python -m uvicorn app.main:app --port 8000 --reload
```

If PowerShell refuses to run `Activate.ps1`, run
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, then try again. On later runs, only
`cd backend`, `.venv\Scripts\Activate.ps1` and the `uvicorn` line are needed.

**Window 3: frontend (React + Vite on port 5173).** Run from the repository root:

```powershell
npm install
npm run dev
```

**Check it works:**

| Open in a browser | What you should see |
| --- | --- |
| http://localhost:8000/health | `{"status":"ok", ...}` |
| http://localhost:8000/api/v1/agent/health | `"status":"available"` if Nemotron is reachable through the tunnel |
| http://localhost:8000/docs | Interactive API docs for every route |
| http://localhost:5173/ | **AccessRoute agent**: Margaret's journey to the Royal Hallamshire |

**Demo flow on http://localhost:5173/:**

1. Click **Plan my journey**. Bus 95 should be recommended.
2. Open **What the agent did** to see Nemotron's tool calls.
3. Select **Pavement blocked on Beech Hill Road**, then click **Re-plan with these problems**.
4. Click **Draft a blocked-pavement report**.

The header badge says whether the local AI is in use. If it says "not reachable", the safety rules
still plan the journey. Check window 1 and `OLLAMA_BASE_URL`.

**Optional API check from PowerShell**, with the backend running:

```powershell
$body = @{ origin_id = "walkley"; appointment = @{ department = "Neuro-Rehabilitation Outpatients"; arrive_by = "2026-11-16T10:15:00+00:00"; confirmed_by_user = $true }; needs = @{ mobility_aid = "powered_wheelchair" }; use_model = $true } | ConvertTo-Json -Depth 5
(Invoke-RestMethod -Uri "http://localhost:8000/api/v1/agent/plan" -Method Post -ContentType "application/json" -Body $body).recommendation
```

**Before a demo: warm up the model** so the first plan is fast. Click **Warm up AI** on
the page, or:

```powershell
Invoke-RestMethod -Method Post http://localhost:8000/api/v1/agent/warmup
```

**Run the evaluation** (8 cases with known answers, including an ambiguous input and two
"I don't know" cases). Run from `backend` with the venv active and the tunnel open. You don't
need uvicorn running for this.

```powershell
python -m eval.run_eval
python -m eval.run_eval --model nemotron-3.5-lightning:30b
python -m eval.run_eval --rules-only
```

It prints PASS/FAIL, time, tool calls and tokens per case, and writes `backend/eval/results.md`.
Paste that table into the submission and show it in the demo video. To compare models, run it
once per model.

See [AGENT.md](AGENT.md) for how the agent works, the demo script and data sources.

## What is implemented

- FastAPI backend with interactive API documentation at `/docs`.
- JPEG/PNG appointment-letter extraction through a configurable Ollama vision model.
- User-confirmed appointment and access-requirement schemas.
- Deterministic checks for walking limits, transfers, step-free and wheelchair requirements.
- Disruption reassessment and a template travel-support draft; nothing is sent.
- Three clearly labelled fictional route fixtures for frontend development.

**Current boundary:** transport routes, times, entrances and access flags are simulated. They are not real travel advice. Only `demo-home` and `northern-general-demo` are supported. Live transport, verified hospital access data, model-directed tool calling, a staff dashboard and the React frontend still need implementation. Do not describe the current deterministic route checker as a completed autonomous agent.

## Start the backend

Use Python 3.12 or later; 3.12 is the suggested shared version for today.

```sh
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
cp .env.example .env
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Open `http://localhost:8000/docs` or `http://SPARK_IP:8000/docs` on a reachable device. Use `http://localhost:8000/health` for the basic connection check. Omit `--reload` for the final demo.

Edit `backend/.env`: set `OLLAMA_BASE_URL` to the model server and `OLLAMA_MODEL` to an installed vision-capable model. If the API runs on Spark alongside Ollama, the default model URL is appropriate. `GET /health/model` checks server reachability and model installation, but does not prove vision support. Test with a synthetic letter to confirm vision and structured-output compatibility.

The routing demo runs without Ollama; extraction returns a clear error until the model is configured. There is no fabricated extraction fallback.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | API health and configuration status; no model request |
| GET | `/health/model` | Model server reachability and model availability |
| GET | `/api/v1/hospitals` | Supported demonstration hospital |
| POST | `/api/v1/appointments/extract` | Multipart image upload, field name `file` |
| POST | `/api/v1/journeys/plan` | Confirmed appointment and access requirements |
| POST | `/api/v1/journeys/reassess` | Original request plus disruption and optional earliest departure |
| POST | `/api/v1/support/draft` | Reviewable template explaining barriers; never sends |

All POST schemas and response examples are available in `/docs` and `/openapi.json`. Invalid input returns 422; errors use FastAPI's `detail` field. Model failures return 502/503/504, unsupported images 415, and oversized images 413.

## Test a journey

From `backend/`, while the API is running:

```sh
curl http://localhost:8000/health
curl -X POST http://localhost:8000/api/v1/journeys/plan -H 'Content-Type: application/json' --data-binary @examples/journey.json
```

The supplied patient gets `demo-direct`. `demo-short-transfer` fails walking/transfer checks. `demo-unknown-access` stays unverified for a step-free requirement.

Reassessment body (copy the original journey JSON into `journey`):

```json
{
  "journey": {
    "origin_id": "demo-home",
    "appointment": {
      "hospital_id": "northern-general-demo",
      "department": "Demo outpatient department",
      "arrive_by": "2026-11-20T10:00:00+00:00",
      "confirmed_by_user": true
    },
    "access": { "step_free_required": true }
  },
  "disruption": {
    "unavailable_route_ids": ["demo-direct"],
    "delay_minutes_by_route": {}
  },
  "earliest_departure": "2026-11-20T08:00:00+00:00"
}
```

The same body is accepted by `/api/v1/support/draft`. A cancelled direct route leaves no confirmed option for these requirements, so `support_needed` becomes true. Route IDs are validated. Delays increase total journey time and move departure earlier; supply `earliest_departure` to prevent a plan requiring departure before the patient is available. The demo does not model real service schedules.

Use timezone-aware dates such as `+00:00` for UK winter or `+01:00` for summer. `arrive_by` is the patient's required arrival time, including their chosen check-in buffer. Convert returned timestamps to Europe/London for display.

## React handoff

Create the frontend separately with React + Vite in `frontend/`. Agree ownership before scaffolding it.

Example frontend environment value:

```text
VITE_API_BASE_URL=http://SPARK_IP:8000
```

Example calls:

```javascript
const API = import.meta.env.VITE_API_BASE_URL;
const form = new FormData();
form.append('file', selectedFile);
const extraction = await fetch(`${API}/api/v1/appointments/extract`, {
  method: 'POST', body: form,
}); // Let the browser set the multipart Content-Type.
if (!extraction.ok) throw new Error('Could not extract appointment details');
const result = await extraction.json();
// Show result.details for editing and confirmation before journey planning.
```

For JSON calls, set `Content-Type: application/json` and send `JSON.stringify(payload)`. Check `response.ok` and display API errors. Show the response `notice`, `data_status`, route rejection reasons and accessibility unknowns visibly. A `matches_demo_requirements` status is not real-world accessibility certification. The draft must be reviewed; no send endpoint exists.

For phones, run Vite with `--host 0.0.0.0` and add its actual origin (e.g. `http://LAPTOP_IP:5173`) to `CORS_ORIGINS`. A phone's `localhost` refers to the phone, not Spark. Restart the API after editing environment settings. Venue Wi-Fi may isolate clients; test connectivity early.

## Data and privacy

- Use synthetic appointment letters throughout the hackathon.
- JPEG and PNG uploads only, up to 10 MB by default; PDF conversion is not implemented.
- No application database or durable upload storage is implemented. Upload middleware may spool files temporarily; uploaded files are closed after processing.
- Configure the model endpoint to the local Spark server to keep document inference local. Do not expose Ollama directly to the phone.
- The app does not log letter contents. Deployment operators must separately check model-server logging and retention.
- Future live transport queries should include only the locations/times needed by the provider, not the letter or patient identifiers.
- This prototype has no authentication; use a trusted demo network with synthetic data. It is not ready for patient deployment.

Dexi can collect sourced route/entrance information in `backend/data-template.csv`; the developer should validate it before connecting it to routing. Keep unknowns explicit and retain source/retrieval timestamps. Do not relabel fixture values as verified data.

## Development checks

```sh
cd backend
source .venv/bin/activate
python -m pytest -q
```

Tests cover access constraints, missing access evidence, disruption fallback, departure feasibility, required confirmation/timezones, invalid uploads and the extraction HTTP contract using a stub. They do not exercise a real model, real transport service or GPU.
