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
| http://localhost:8000/docs | Interactive API docs for every route |
| http://localhost:5173/ | Appointment upload, saved profiles, settings and live GPS map |

## What is implemented

- FastAPI backend with interactive API documentation at `/docs`.
- JPEG/PNG appointment-letter extraction through a configurable Ollama vision model.
- User-confirmed appointment and access-requirement schemas.
- Deterministic checks for walking limits, transfers, step-free/wheelchair requirements, available simulated gradients and boarding-time allowances.
- Local registration/login, saved profiles and editable access presets with SQLite and HttpOnly sessions.
- Browser GPS tracking plus explicit address lookup and optional openrouteservice wheelchair directions.
- Mobile React screens for appointment, simple access needs, map/steps, profile and settings.
- Disruption reassessment and a template travel-support draft; nothing is sent.
- Three clearly labelled fictional route fixtures for frontend development.

**Merged application:** `/` provides appointment upload, profiles, settings, live GPS and optional outdoor directions. It is built by `npm run build` and uses the `/backend` Vite proxy. The appointment form can be explicitly saved or removed.

**Current boundary:** appointment-journey routes, times, gradients and access flags are simulated, not real travel advice. The original journey routes support `demo-home` / `northern-general-demo`. Live weather is optional, live outdoor wheelchair directions require an ORS key, and no live bus feed is connected. The browser-only staff preview does not send requests or dispatch transport. Real Spark inference still needs deployment verification.

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

## New profile, settings and location features

See [accessibility defaults and source notes](docs/accessibility-defaults.md) for evidence, assumptions, provider setup and Spark connection commands. [Frontend API reference](backend/API.md) covers payloads. Restart the API after pulling these changes; Vite reload alone does not add new backend routes.

- Current address: explicit browser location permission and a one-time Nominatim lookup.
- Profile: register/sign in, first name, surname, email, usual hospital, mobility aid and saved access needs.
- Settings: optional numeric preferences with an editable source-informed preset. Individual ability is never inferred from age.
- Map: live GPS marker and accuracy circle; manual destination selection, provider geometry and written instructions when ORS is configured. No live bus feed or automatic rerouting yet.
- Keep fixture journeys and hand-authored GeoJSON clearly labelled as demo data.

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

The React + Vite frontend is now in the repository root (`src/`). Run `bash scripts/dev.sh` from the root to start both servers. It uses a same-origin `/backend` proxy by default; legacy `VITE_API_BASE_URL` overrides should be removed unless intentionally pointing at another API.

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
- Profiles and access preferences are saved in a local SQLite database (`backend/.data/` by default, ignored by git). Appointment uploads are not durably stored; upload middleware may spool files temporarily and uploaded files are closed after processing.
- Configure the model endpoint to the local Spark server to keep document inference local. Do not expose Ollama directly to the phone.
- The app does not log letter contents. Deployment operators must separately check model-server logging and retention.
- Future live transport queries should include only the locations/times needed by the provider, not the letter or patient identifiers.
- Account routes use salted PBKDF2 password hashes and revocable HttpOnly cookie sessions. Use synthetic accounts on a trusted demo network. Email verification, password recovery, production abuse controls and patient-deployment review are not implemented. Use HTTPS and `COOKIE_SECURE=true` for secure deployments.

Dexi can collect sourced route/entrance information in `backend/data-template.csv`; the developer should validate it before connecting it to routing. Keep unknowns explicit and retain source/retrieval timestamps. Do not relabel fixture values as verified data.

## Development checks

```sh
cd backend
source .venv/bin/activate
python -m pytest -q
```

Tests cover access constraints, missing access evidence, disruption fallback, departure feasibility, required confirmation/timezones, invalid uploads and the extraction HTTP contract using a stub. They do not exercise a real model, real transport service or GPU.
# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## Saved UI data

Sign in to use database-backed forms. On the appointment page, use **Save appointment to my account**. The form restores after refresh/sign-in, and can be removed. Profile settings include an optional usual starting address.

The additive SQLite migration creates `user_workspace` without deleting users, sessions or password hashes. Existing profiles receive an empty optional starting address until edited. Tables are initialized automatically; no database reset is required. Raw appointment images, live GPS traces, calculated routes and transient road incidents are not saved. Restart the backend to load the new endpoints.

The incoming weather/Live Roads panel is available on the map page, with its provider proxy preserved. It shows request failures rather than substituting fictional incidents. These external feeds still require live network/provider validation and do not automatically change route assessments.
