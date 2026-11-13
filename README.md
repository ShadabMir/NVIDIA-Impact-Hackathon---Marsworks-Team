# AccessRoute AI Journey Planner

Accessible journeys to the **Royal Hallamshire Hospital, Sheffield**, planned by a local AI
agent (Nemotron) running on an **NVIDIA DGX Spark**. Built for the NVIDIA Hack for Impact
hackathon (Public Services track).

Margaret, 67, uses a powered wheelchair and lives in Walkley, one of Sheffield's steepest
areas. The app takes her from appointment letter to a safe journey:

1. **Read the letter:** a photo is read by a vision model on the Spark.
2. **Use her saved profile:** mobility aid, slope limit and distances.
3. **Plan the journey with an AI agent:**
   - Nemotron decides what to check: entrance, routes, weather, roadworks, trams and buses,
     events and toilets.
   - Safety rules reject anything too steep, closed or cancelled.
   - Nemotron explains the best option in plain English. It can also be read aloud.
4. **Re-plan on the day** when something goes wrong, and **draft messages** (council pavement
   report, hospital transport request, operator feedback). Nothing is ever sent automatically.
5. **Show the map:** live GPS and wheelchair directions to the hospital entrance.

## Test the app: quick start (Windows PowerShell)

You need **three PowerShell windows**, all left open. Replace `sparkX` and `user11` with your
assigned Spark and login. On Mac/Linux, use `source .venv/bin/activate` and `cp` instead of
`.venv\Scripts\Activate.ps1` and `copy` (or run `bash scripts/dev.sh` for windows 2 and 3).

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

In Notepad, set these values and save:

| Setting | Value | Used for |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11435` | The tunnel to the Spark |
| `OLLAMA_AGENT_MODEL` | `nemotron-3.5-lightning:30b` or `nemotron-3-nano:30b` | The journey agent |
| `OLLAMA_MODEL` | `qwen3.6:35b-a3b` | Reading appointment letters (the only model that reads images) |
| `ORS_API_KEY` | your openrouteservice key (optional) | Wheelchair directions on the map |

Then run the tests and start the API:

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
| **http://localhost:5173/** | **The app**: header "AccessRoute AI Journey Planner" |
| http://localhost:8000/health | `{"status":"ok", ...}` |
| http://localhost:8000/api/v1/agent/health | `"status":"available"` if Nemotron is reachable through the tunnel |
| http://localhost:8000/docs | Interactive API docs for every route |

The header shows **Letter model** and **AI agent** status. If the agent is "Not connected", the
safety rules still plan the journey, and the result says so. Check window 1 and
`OLLAMA_BASE_URL`.

## Demo flow

1. **Appointment:**
   - Upload a synthetic letter, or keep the example (Neuro-Rehabilitation Outpatients, 16
     November, arrive 10:15).
   - Enter or locate the start address. The app picks the nearest area with checked route data
     (Walkley for Margaret). More than 2.5 km from any area, it picks "Somewhere else", and the
     agent replies that it doesn't know.
   - Tick "I have checked…" and continue.
2. **Access needs:**
   - These come from the profile (or a suggested preset).
   - Tick any extras (toilet, crowds, taxi), and keep **Use the local AI agent** on.
   - Click **Plan my journey**.
3. **Plan & map:**
   - Nemotron's recommendation, with **Read aloud** and a green **DGX Spark** panel (model
     calls, tokens, tokens per second).
   - Every route checked, with the reason each was accepted or rejected.
   - **What the agent did**: the tool calls Nemotron chose.
   - The map's destination is set to the recommended entrance.
4. **Something goes wrong:**
   - Select **Pavement blocked on Beech Hill Road**, then **Re-plan with these problems**. The
     agent switches to a wheelchair-accessible taxi and offers drafts.
   - Open a draft. It also appears in **4. Support** and in the **Staff demo**.

**Before presenting**, warm up the model so the first plan is fast. Use **Settings → Warm up the
AI agent**, or:

```powershell
Invoke-RestMethod -Method Post http://localhost:8000/api/v1/agent/warmup
```

## Evaluation

The evaluation has 8 cases with known right answers, including an ambiguous department and two
cases where "I don't know" is the right answer. Run it from `backend`, with the venv active and
the tunnel open (uvicorn doesn't need to be running):

```powershell
python -m eval.run_eval
python -m eval.run_eval --model nemotron-3.5-lightning:30b
python -m eval.run_eval --rules-only
```

It prints PASS/FAIL, time, tool calls and tokens per case, and writes `backend/eval/results.md`
for the submission and demo video. See [AGENT.md](AGENT.md) for how the agent works.

## How it fits together

```
Browser (React, Vite :5173) ──/backend proxy──► FastAPI :8000 ──SSH tunnel :11435──► DGX Spark: Ollama :11434
   letter, profile, plan, map, support             agent, accounts, extraction          Nemotron (agent)
                                                    SQLite, navigation, TTS              Qwen (letter reading)
```

| Part | What it does | Where |
| --- | --- | --- |
| Journey agent | Nemotron chooses tools; safety rules check every route; Nemotron explains; re-plan; drafts | `backend/app/services/agent.py`, `/api/v1/agent/*` |
| Sheffield data | Routes, gradients, roadworks, events, toilets for the Royal Hallamshire (**demo data**) | `backend/app/data/sheffield_rhh.json` |
| Letter reading | Photo to hospital, department, date and time (user confirms) | `/api/v1/appointments/extract`, vision model |
| Accounts and profile | Register/sign in, mobility aid, access presets, saved appointment | `profiles.py`, `workspace.py` (SQLite) |
| Map and location | GPS, address search (OpenStreetMap), wheelchair directions (openrouteservice), QGIS demo layers | `navigation.py`, `src/LiveJourneyMap.jsx`, `src/App.jsx` |
| Live conditions | Current weather (Open-Meteo), road incidents (Live Roads) | `src/LiveConditions.jsx` |
| Read aloud | Speech model on the Spark if configured, else the browser's voice | `/api/v1/tts`, `src/tts/speak.js`, [TTS.md](backend/TTS.md) |

The API reference is in [backend/API.md](backend/API.md). Accessibility presets and their sources
are in [docs/accessibility-defaults.md](docs/accessibility-defaults.md).

## Data and privacy

- **Demo data:** routes, times, gradients, roadworks, events and toilets are illustrative demo
  data for the Royal Hallamshire scenario, not real travel advice. Entrance names come from the
  Sheffield Teaching Hospitals accessibility list. Weather is live from Open-Meteo when reachable.
- **Letters:** use synthetic appointment letters. JPEG and PNG only, up to 10 MB. Letters are
  read by the model on the Spark and are not stored. The app does not log letter contents.
- **Profiles:** profiles, access preferences and the saved appointment form are stored in a local
  SQLite database (`backend/.data/`, ignored by git). Raw letter images, GPS traces, calculated
  routes and road incidents are not saved.
- **Accounts:** salted PBKDF2 password hashes and revocable HttpOnly cookie sessions. Use
  synthetic accounts on a trusted network. Email verification, password recovery and production
  abuse controls are not implemented. Use HTTPS and `COOKIE_SECURE=true` for real deployments.
- **External services:** address lookup (Nominatim), wheelchair directions (openrouteservice),
  weather and road feeds receive only the locations they need, never the letter or the profile.
- **Keys:** keep API keys in `backend/.env` (ignored by git), never in `.env.example`.

`backend/data-template.csv` is a template for collecting sourced route and entrance information.
Validate it before connecting it to the agent's data, keep unknowns explicit, and never relabel
demo values as verified.

## Phones and other devices

Run Vite with `--host 0.0.0.0`, and add its actual origin (e.g. `http://LAPTOP_IP:5173`) to
`CORS_ORIGINS` in `backend/.env`. A phone's `localhost` is the phone, not your laptop. Venue Wi-Fi
may isolate devices, so test early. Live GPS needs HTTPS or `localhost`.

## Development checks

```powershell
cd backend
python -m pytest -q
cd ..
npm run lint
npm run build
```

The backend tests cover:

- The agent: tool calls against a fake Ollama server, the model trying to pick an unsafe route,
  the model being offline, re-planning, drafts and the evaluation cases.
- Accounts, profiles and saved forms.
- Navigation adapters, letter-upload validation and text-to-speech.

They do not exercise a real model, a real transport service or the GPU. Run the evaluation for
that.
