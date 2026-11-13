# The journey agent: AccessRoute AI Journey Planner

The agent plans every journey in the app (`/`). Its endpoints are under `/api/v1/agent/*`.

## How the app uses it

**Plan my journey** sends `/api/v1/agent/plan`:

- **Needs:** taken from the saved profile (`src/agent/profileNeeds.js`), plus the journey extras
  (toilets, crowds, taxi).
- **Start area:** the nearest area with checked route data to the GPS or searched address,
  within 2.5 km. Otherwise "Somewhere else", and the agent replies "I don't know".
- **Results:** shown by `src/agent/AgentResults.jsx`: recommendation with read-aloud
  (`src/tts/speak.js`), DGX Spark stats, routes, trace, disruption scenarios and drafts.
- **Map:** the destination is set to the recommended entrance.
- **Drafts:** appear in Support and in the Staff demo.

## What the agent does

1. **Nemotron on the DGX Spark decides what to check** using tools: hospital entrance, route options,
   live weather (Open-Meteo), roadworks, tram/bus disruptions, events and crowds, and accessible
   toilets.
2. **A safety net** runs any required check the model skipped. The trace shows "Nemotron chose",
   "Safety net" or "Rules" for each step.
3. **Deterministic rules assess every route**: gradient limit, step-free access, dropped kerbs,
   distance without a rest, closed pavements, cancellations, delays, ice and the earliest
   departure time. The model can never pick a route the rules mark unsuitable.
4. **Nemotron picks and explains** the best acceptable route in plain English. If the Spark is
   unreachable, the rules choose and the UI says so.
5. **Re-plan on the day** with disruptions (blocked pavement, Bus 95 cancelled, trams suspended or
   delayed, event crowds, ice), then **draft** a pavement report to the council, a transport
   request to the hospital, or feedback to Travel South Yorkshire. Nothing is ever sent.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/agent/health` | Is Nemotron reachable and installed? |
| GET | `/api/v1/agent/context` | Origins, hospital entrances, disruption scenarios |
| POST | `/api/v1/agent/plan` | Agentic plan for an appointment and access needs |
| POST | `/api/v1/agent/reassess` | Same request plus disruptions / earliest departure |
| POST | `/api/v1/agent/draft` | Reviewable draft message; never sends |

Schemas and examples are at `http://localhost:8000/docs`.

## Run it on a Windows laptop (PowerShell)

Keep the SSH tunnel to the Spark open in one window:

```powershell
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:11435:127.0.0.1:11434 user11@sparkX.local
```

Backend, in a second window, from the repository root:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
copy .env.example .env
notepad .env   # set OLLAMA_BASE_URL=http://127.0.0.1:11435
python -m uvicorn app.main:app --port 8000 --reload
```

Frontend, in a third window, from the repository root:

```powershell
npm install
npm run dev
```

Open **http://localhost:5173/**.

If the API runs on the Spark itself, keep `OLLAMA_BASE_URL=http://127.0.0.1:11434`.

## Demo script (about 3 minutes)

1. **Appointment:** upload a synthetic letter (Qwen reads it on the Spark), or keep the example.
   Use Walkley as the start, confirm, and continue.
2. **Access needs:** these load from Margaret's profile (powered wheelchair). Click **Plan my
   journey**. Bus 95 is recommended; the tram route is rejected (12.5% Howard Road and the closed
   Western Bank pavement). Click **Read aloud**, and point out the DGX Spark stats panel.
3. Open **What the agent did** to show Nemotron's tool calls on the Spark.
4. Select **Pavement blocked on Beech Hill Road** and click **Re-plan**. No public route is safe,
   so the agent switches to an accessible taxi and offers drafts.
5. Click **Draft a transport-support request**, then show it in **4. Support** and the **Staff
   demo**. Nothing is sent.
6. Show the map (destination already set to the entrance) and the evaluation table.

## Data status

`backend/app/data/sheffield_rhh.json` is **demo data**. Route numbers, gradients, roadworks,
events, toilets and fares are illustrative. Entrance names come from the Sheffield Teaching
Hospitals list. Only the weather is live.

Next real sources (see the datasets doc):

- Street Manager for roadworks
- Travel South Yorkshire / BODS for buses and trams
- Environment Agency LIDAR for gradients
- Wheelmap / accessibility.cloud and AccessAble for entrances and toilets
- ONS Census 2021 TS038 for the problem-size slide

## Spark optimisations

- **Model:** set `OLLAMA_AGENT_MODEL` in `backend/.env`. Use `nemotron-3.5-lightning:30b` for
  agent steps or `nemotron-3-nano:30b` for reasoning, and compare them with the evaluation.
  Only one model is loaded at a time. Letter reading uses Qwen (`OLLAMA_MODEL=qwen3.6:35b-a3b`),
  so the first plan after an upload includes a model swap.
- **Keep alive:** every call sends `keep_alive` (default `30m`, `OLLAMA_KEEP_ALIVE`), so the
  model stays in GPU memory between the agent's calls. `POST /api/v1/agent/warmup` loads it
  before a demo.
- **Context:** the largest agent prompt is about 2,000 tokens, within the 8,192-token limit.
- **Local compute shown:** each plan returns `model_stats` (model calls, tokens in/out, tokens
  per second, model time and load time, from Ollama's own counters). The app shows it in
  the green panel.

## Evaluation

`python -m eval.run_eval` (from `backend`) runs 8 cases against the real model:

- 5 known-answer cases: normal day, blocked pavement, trams suspended, ice, manual wheelchair
- 1 ambiguous input: department unclear, so the entrance is flagged, not guessed
- 2 "I don't know" cases: no route data for Rotherham; no forecast 7 weeks ahead, so the advice
  must not mention a temperature

Results go to `backend/eval/results.md`. The same cases also run in `pytest` (rules only), so
data changes cannot silently break them.

## Tests

```powershell
cd backend
python -m pytest -q
```

The combined suite covers profiles, sessions, navigation adapters, rule enforcement, re-planning, drafts, the model-directed loop against a fake
Ollama server, the model trying to choose an unsafe route, the model being offline, and parsing
of Open-Meteo responses.
