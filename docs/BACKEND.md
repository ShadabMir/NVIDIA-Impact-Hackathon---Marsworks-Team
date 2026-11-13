# How the backend works: logic, data and the DGX Spark

This covers the `combined-accessroute` branch (AccessRoute AI Journey Planner). File paths are
relative to the repository root.

## 1. The system in one picture

```
 LAPTOP                                                          DGX SPARK (spark11)
 ┌──────────────────────────┐  /backend proxy  ┌─────────────────┐  SSH tunnel  ┌───────────────────────┐
 │ Browser: React (Vite)    │ ───────────────► │ FastAPI backend │ ═══════════► │ Ollama :11434         │
 │ http://localhost:5173    │                  │ :8000           │ laptop:11435 │  Nemotron (agent)     │
 └──────────────────────────┘                  │                 │              │  Qwen (letter images) │
                                               │ SQLite (.data/) │ ═══════════► │ Speech NIM :9000      │
                                               └───────┬─────────┘  (optional)  │  (optional)           │
                                                       │ HTTPS                  └───────────────────────┘
                                   Open-Meteo, Nominatim (OpenStreetMap), openrouteservice
```

- **The browser** only ever talks to the backend, through Vite's `/backend` proxy. The one
  exception is the live conditions panel, which calls Open-Meteo and Live Roads directly.
- **The backend** does all the logic: accounts, the agent loop, safety rules, external lookups.
- **The Spark** only runs models. It holds no app data, and it is reached only through the SSH
  tunnel, because Ollama accepts connections from the Spark itself only.

## 2. What happens when a user clicks "Plan my journey"

1. **Frontend:** `src/AccessRouteApp.jsx` builds an `AgentPlanRequest`:
   - `appointment`: department, plus `arrive_by` in UK time.
   - `origin_id`: the start area nearest the user's GPS position or searched address, within
     2.5 km. Otherwise `elsewhere`.
   - `needs`: from the profile, via `src/agent/profileNeeds.js`, plus the journey extras.
2. **Backend:** `POST /api/v1/agent/plan` (`backend/app/agent_routes.py`) validates the request,
   then calls `agent.plan()` in `backend/app/services/agent.py`.
3. **Agent loop:** Nemotron, on the Spark, is given the goal and 8 tools. It chooses which tools
   to call. The backend runs each call and returns the result, for up to 8 rounds (§4.2).
4. **Safety net:** any required check the model skipped is run anyway (§4.3).
5. **Rules:** every candidate route is scored against the user's needs. This is deterministic
   Python, not the model (§4.4).
6. **Recommendation:** Nemotron picks the best acceptable route and explains it in plain English.
   If it picks a rejected route, or the Spark is unreachable, the rules' choice is used (§4.5).
7. **Response:**
   - The recommendation and every route with its barriers.
   - Weather, toilets, entrance and suggested drafts.
   - The tool-call trace and model statistics.
8. **Display:** the frontend renders it with `src/agent/AgentResults.jsx`, and sets the map's
   destination to the hospital entrance.

## 3. Backend modules

| File | Responsibility | Routes |
| --- | --- | --- |
| `app/main.py` | App setup, CORS, health checks, hospital list, letter upload | `/health`, `/health/model`, `/api/v1/hospitals`, `/api/v1/appointments/extract` |
| `app/agent_routes.py` | HTTP layer for the agent | `/api/v1/agent/{health,warmup,context,plan,reassess,draft}` |
| `app/agent_schemas.py` | Request/response models for the agent (validated with Pydantic) | none |
| `app/services/agent.py` | **The agent**: tools, model loop, safety net, recommendation, statistics | none |
| `app/services/sheffield.py` | Loads the Sheffield data; **the safety rules** and route ranking | none |
| `app/services/weather.py` | Open-Meteo forecast, or a weather scenario | none |
| `app/services/drafts.py` | Message drafts (template, optionally reworded by the model) | none |
| `app/services/llm.py` | The only client for Ollama: chat, tools, structured output, statistics, warm-up | none |
| `app/services/extraction.py` | Letter photo to appointment fields (vision model) | none |
| `app/profiles.py` | Accounts, sessions, profile, access presets (SQLite) | `/api/v1/auth/*`, `/api/v1/profile`, `/api/v1/access/defaults` |
| `app/workspace.py` | Saved appointment form per user | `/api/v1/workspace` |
| `app/navigation.py` | Address search and wheelchair directions | `/api/v1/locations/*`, `/api/v1/navigation/route` |
| `app/tts.py` | Text to speech through a speech model on the Spark | `/api/v1/tts`, `/api/v1/tts/health` |
| `app/config.py` | All settings, read from `backend/.env` | none |

## 4. The agent in detail

### 4.1 Inputs (`AgentPlanRequest`)

| Field | Meaning |
| --- | --- |
| `origin_id` | Start area: `walkley`, `hillsborough`, `city-centre`, `sheffield-station`, `meadowhall`, or the no-data areas `rotherham` and `elsewhere` |
| `appointment` | `hospital_id` (`royal-hallamshire`), `department`, `arrive_by` (with time zone), `confirmed_by_user: true` |
| `needs` | `mobility_aid`; `max_gradient_pct` (if blank: manual wheelchair 5%, powered wheelchair, scooter or walking aid 8.3%, none 12.5%); `max_continuous_roll_m`; `max_total_roll_m`; `step_free_required`; `extra_minutes`; toilet, Changing Places, crowds and taxi flags; optional `condition_notes` |
| `disruptions` | A list of `{type, target, delay_minutes, description}`. Types: tram or bus cancelled or delayed, `pavement_blocked`, `lift_out_of_order`, `event_crowding`, `severe_weather` |
| `earliest_departure` | Optional. Routes that need an earlier departure are rejected |
| `use_model` | `false` skips the model: rules only, which is fast |

### 4.2 The tools Nemotron can call

The tools are defined in `TOOLS` in `agent.py`. Each is a Python function. The model sees only
its name, description and parameters, and receives its JSON result.

| Tool | What it does | Data used |
| --- | --- | --- |
| `find_hospital_entrance` | Matches the department to an entrance by keyword, and flags it if unrecognised | Entrance list in `sheffield_rhh.json` |
| `list_route_options` | Candidate journeys from the start area | `options` in `sheffield_rhh.json` |
| `get_weather_forecast` | Forecast at the hospital for the arrival hour | Open-Meteo (live), or a `severe_weather` scenario |
| `check_roadworks` | Roadworks active on that date, on the streets the routes use, plus reported blocked pavements | `roadworks` in the JSON, plus disruptions |
| `check_transport_disruptions` | Published disruptions (demo feed, currently empty) and those reported by the user | `transport_status` in the JSON, plus disruptions |
| `check_events` | Events whose crowd window overlaps the journey | `events` in the JSON |
| `find_accessible_toilets` | Accessible or Changing Places toilets near the routes' stops | `toilets` in the JSON |
| `assess_routes` | Runs the safety rules (§4.4) and returns a summary | All of the above |

The loop (`model_loop`):

- The backend sends the system prompt, the user's goal and needs, and the tool list to
  `/api/chat`.
- If the reply contains `tool_calls`, each one is executed. Its result is truncated to 4,000
  characters and sent back with `role: "tool"`. Then the model is asked again.
- The loop stops when the model answers without calling a tool, when it has called
  `assess_routes` and every required check, or after **8 rounds**.
- Unknown tool names return an error message instead of crashing. Tool results are labelled as
  data, not instructions, in the system prompt.

### 4.3 The safety net

After the loop, `gather_missing` runs every **required** check the model didn't call:

- entrance, routes, weather, roadworks, disruptions and events
- toilets, if the user needs one

Then `assess_routes` is always run once more, so the final assessment uses all the evidence. In
the trace, each step is labelled `model` ("Nemotron chose"), `safety_net` or `rules`.

### 4.4 The safety rules (`assess_option` in `sheffield.py`)

Every leg of every route is checked. Each problem found is a **barrier**: `info`, `warning` or
`blocking`.

**Wheeling or walking legs:**

| Check | Result |
| --- | --- |
| Slope above the user's limit | `blocking` if more than 2 points over the limit, otherwise `warning` |
| Ice risk on a slope of 4% or more | `blocking` for wheels on a slope of 6% or more, otherwise `warning` |
| Steps, when step-free is required | `blocking` |
| No dropped kerbs (wheelchair or scooter) | `warning` |
| Uneven surface or cobbles (manual wheelchair, walking aid) | `warning` |
| A stretch longer than the user's limit without a rest | `warning` |
| Pavement reported blocked on this street | `blocking` |
| Roadworks with the pavement closed | `blocking`, or `warning` if the diversion is step-free |
| Roadworks narrowing the footway below 1,000 mm (wheels) | `warning` |
| Rain, on an exposed stretch of 100 m or more | `info`; the leg also takes 25% longer in rain or ice |

**Bus and tram legs:**

| Check | Result |
| --- | --- |
| Waiting time | Half the service interval is added. A second vehicle adds an `info` about changing |
| Every line serving the leg cancelled (e.g. both Blue and Yellow trams) | `blocking` |
| Only some of those lines cancelled | `warning`, plus 10 minutes |
| Delay | `warning`, plus the delay |
| Event crowding, or an event on that line or stop | `warning` |
| Lift out of order at a stop | `blocking` |
| Only one wheelchair space | `info` |

**Taxi:** a `warning` if the user can't use a taxi; an `info` reminding them to book a
wheelchair-accessible vehicle.

**Whole route:** a `warning` if the total wheeling distance exceeds the limit. A `blocking`
barrier if the user would have to leave before `earliest_departure`.

**Timing:**

```
total minutes = sum of leg minutes (+ waits, delays, +25% wheeling in rain or ice) + extra_minutes
leave_at      = arrive_by − total minutes
```

**Status:**
- **unsuitable**: any `blocking` barrier
- **caution**: any `warning`
- **suitable**: otherwise

**Map data per leg:** legs may also carry `geometry` (a GeoJSON LineString) and `map_stops`, which
are passed through unchanged so the map can draw bus and tram legs. None are in the demo data yet.
See [navigation-map.md](navigation-map.md).

**Ranking:** status first; then public transport before a taxi; then fewer warnings; then
shorter time.

**Support needed:** `support_needed = true` when no public transport route is `suitable`.

### 4.5 The recommendation

- **The model chooses.** Nemotron receives the ranked summaries and returns JSON matching a
  schema: `option_id`, `summary`, `reasons`, `tips`. It may only choose a route that is
  `suitable` or `caution`.
- **The backend validates.** If the JSON doesn't fit the schema, or the chosen route is
  `unsuitable` or unknown, the model's answer is discarded and `rules_recommendation` is used.
  `generated_by` says which one was used.
- **Honest unknowns:**
  - **No route data** for the start area (`rotherham`, `elsewhere`): "I don't know a safe route
    from … yet", plus a hospital transport draft.
  - **Department not recognised:** the main entrance, with a first tip "Not sure which
    entrance…".
  - **No forecast available** (more than about 16 days ahead, or offline): weather is reported
    as unavailable, never guessed.
- **Agent mode:**
  - `model_directed`: Nemotron ran the loop.
  - `rules_only`: the user turned the AI off.
  - `model_unavailable_fallback`: the Spark couldn't be reached, so the rules did everything.

### 4.6 Re-planning and drafts

- **Re-plan:** `POST /api/v1/agent/reassess` runs the same pipeline with extra disruptions
  added. The frontend sends its preset scenarios (from `/context`), such as "Pavement blocked on
  Beech Hill Road", "Trams suspended" or "Icy pavements".
- **Suggested actions:**
  - Blocked or closed pavement: **council pavement report**.
  - `support_needed`: **hospital transport request**.
  - Bus or tram cancelled or delayed: **Travel South Yorkshire feedback**.
- **Drafts:** `POST /api/v1/agent/draft` re-runs a rules-only plan to collect the barriers, then
  builds a template message with `[placeholders]` for personal details. If AI is on, Nemotron
  rewords it, using a schema of `{subject, body}`. The reworded version is accepted only if it
  still contains the placeholders. Every draft starts with "DRAFT … Nothing has been sent". There
  is no send endpoint.

## 5. The data

| Data | Real or demo | Where | Used for |
| --- | --- | --- | --- |
| Hospital entrances (A Floor Outpatients 2, B Floor Main 9, Minor Injuries 12) | **Real names**, from the Sheffield Teaching Hospitals accessibility list. Details not verified | `backend/app/data/sheffield_rhh.json` | Choosing the entrance |
| Start areas, routes, legs, gradients, kerbs, surfaces, bus and tram lines, frequencies | **Demo**: plausible but illustrative | same file | Candidate journeys |
| Roadworks (Western Bank, Glossop Road, Sheaf Street) | **Demo** | same file | Barriers |
| Events (football, lights switch-on, concert) | **Demo** | same file | Crowding |
| Accessible toilets | **Demo** (marked `verified: false`) | same file | Toilet check |
| Disruption scenarios | **Demo presets** | same file (`scenarios`) | "Something goes wrong" buttons |
| Weather forecast | **Live**: Open-Meteo, no key | `services/weather.py` | Rain, ice and wind barriers |
| Address search and reverse lookup | **Live**: Nominatim (OpenStreetMap), at most 1 request a second, cached | `navigation.py` | Start address |
| Wheelchair directions | **Live**: openrouteservice `wheelchair` profile. Slope rounded **down** to 3, 6, 10 or 15%; steps avoided; sloped kerbs at most 3%. Needs `ORS_API_KEY`. No route found: 422. Bad key or rate limit: 503 | `navigation.py` | Map route; GPS rerouting is in the frontend ([navigation-map.md](navigation-map.md)) |
| Current weather and road incidents (map panel) | **Live**: Open-Meteo and Live Roads, called from the browser | `src/LiveConditions.jsx` | Display only (doesn't change the plan) |
| Access presets (150 m for wheelchairs, 50 m with a stick, 5% slope) | DfT Inclusive Mobility guidance, plus app assumptions | `profiles.py`, `docs/accessibility-defaults.md` | Default needs |
| Users, sessions, saved appointment | **User data**, stored locally | SQLite: `backend/.data/accessroute.sqlite3` | Accounts |

**To replace demo data with real data,** keep the same JSON shape, or change the loader
functions in `sheffield.py`. The rules don't need to change:

| Real source | Replaces | Loader to change |
| --- | --- | --- |
| Street Manager | `roadworks` | `active_roadworks` |
| Bus Open Data Service (BODS) / Travel South Yorkshire | `transport_status` | `published_disruptions` |
| Environment Agency LIDAR | `max_gradient_pct` per leg | the route data |
| AccessAble / Wheelmap | `entrances`, `toilets` | the entrance and toilet data |

**What is stored, and where:**

| Data | Stored? |
| --- | --- |
| Accounts | SQLite on the laptop. Passwords are PBKDF2-SHA256, 600,000 iterations, salted. Session tokens are stored only as SHA-256 hashes; the cookie `accessroute_session` is HttpOnly and SameSite=Lax, and lasts 24 hours |
| Saved appointment form | SQLite on the laptop |
| Letter images, GPS traces, plans and road incidents | Not stored |
| Anything on the Spark | Nothing from the app is stored there (§7) |

Account changes from other websites are rejected by an origin check (`check_origin`).

## 6. How the backend reaches the Spark

**The connection:**

- Ollama on the Spark listens on `127.0.0.1:11434` and accepts connections from the Spark
  itself only.
- `ssh -N -L 127.0.0.1:11435:127.0.0.1:11434 user11@sparkX.local` makes laptop port `11435`
  forward to Spark port `11434`, encrypted.
- The backend calls `OLLAMA_BASE_URL=http://127.0.0.1:11435`.
- Calls are made with `trust_env=False`, so they never go through a system proxy.
- If the backend runs on the Spark itself, use `http://127.0.0.1:11434` and no tunnel.

**The calls made to the Spark:**

| Call | When | Model (`.env`) | Key fields in the request |
| --- | --- | --- | --- |
| Agent loop | Every plan with AI on (up to 8 calls) | `OLLAMA_AGENT_MODEL` (Nemotron) | `tools`, `think: false`, `temperature: 0`, `num_ctx: 8192`, `num_predict: 400`, `keep_alive: 30m` |
| Recommendation | After the rules | same | `format` = JSON schema `ModelChoice`, `num_predict: 500` |
| Draft rewording | When a draft is requested with AI on | same | `format` = JSON schema `{subject, body}`, `num_predict: 600` |
| Warm-up | Settings → Warm up, or `POST /agent/warmup` | same | Tiny prompt, `num_predict: 2`; loads the model into memory |
| Letter extraction | Letter upload | `OLLAMA_MODEL` (Qwen; only it reads images) | `images` = base64 photo, `format` = JSON schema `AppointmentExtraction`, `temperature: 0` |
| Health checks | On page load | none | `GET /api/tags`, which lists the installed models |
| Text to speech (optional) | Read aloud | Speech NIM on port 9000 (`TTS_BASE_URL`) | Text split into chunks of at most 450 characters; the WAV files are joined. Without it, the browser's own voice is used |

Every call is a normal HTTP POST to `/api/chat`, with `stream: false`. A plan with AI on makes at
most 9 calls: up to 8 loop rounds, plus 1 recommendation. The largest prompt is about 2,000 tokens, within the organisers' limit of 8,192
per request.

## 7. What happens on the Spark

- **The hardware:** the DGX Spark is a desktop Grace Blackwell system (ARM64 CPU plus Blackwell
  GPU) with unified memory, so the model weights sit in memory that the GPU reads directly.
- **The server:** Ollama runs as a server and holds **one model in memory at a time** (an
  organiser rule).
  - A request for a model that isn't loaded makes Ollama unload the current one and load the
    requested one. That is the `load_duration` you see as "Model load". It takes seconds, so
    letter reading (Qwen) followed by planning (Nemotron) costs a swap.
  - `keep_alive: 30m` keeps the model loaded for 30 minutes after the last call, so the agent's
    consecutive calls don't reload it. The organisers' test command used `keep_alive: 0`, which
    unloads it after every call.
- **Each request is processed in two phases:**
  1. **Prompt processing** (`prompt_eval_count` and `prompt_eval_duration`). The whole
     conversation is read: system prompt, tool definitions, earlier tool results. It's fast,
     because the tokens are processed in parallel.
  2. **Generation** (`eval_count` and `eval_duration`). The answer is produced one token at a
     time. This is the "tokens/s" in the green panel: `eval_count ÷ eval_duration`, summed over
     all calls in a plan.
- **Tool calling:** the model is trained to emit a structured `tool_calls` block instead of
  text. Ollama turns that into JSON for the backend. **The model never runs code or reaches the
  internet.** It only asks, and the backend decides whether to run the tool.
- **Structured output** (`format` = a JSON schema): Ollama restricts the model's output so it
  must match the schema. The backend still validates it, and falls back to the rules if it fails.
- **`think: false`:** turns off the model's hidden "reasoning" tokens, which keeps answers fast
  and within the token budget.
- **The models supplied:**

  | Model | Used for | Notes |
  | --- | --- | --- |
  | `nemotron-3.5-lightning:30b` | Agent (recommended) | The organisers' choice for agent steps: classifying, extracting, routing |
  | `nemotron-3-nano:30b` | Agent (alternative) | Reasoning. Both Nemotron models earn the judging bonus |
  | `qwen3.6:35b-a3b` | Reading letters | The only model that reads images. "a3b" means about 3 billion active parameters per token (mixture of experts) |

- **Nothing is trained or fine-tuned.** The app sends context in each request, and the models are
  used as supplied. No app data is stored on the Spark. If you need to be certain, check
  Ollama's own log settings there.

## 8. Configuration (`backend/.env`)

| Setting | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Use `…:11435` from a laptop through the tunnel |
| `OLLAMA_AGENT_MODEL` | `nemotron-3-nano:30b` | The agent model |
| `OLLAMA_MODEL` | blank | Letter-reading model (`qwen3.6:35b-a3b`). Blank turns the upload off |
| `OLLAMA_KEEP_ALIVE` | `30m` | How long the model stays loaded |
| `OLLAMA_TIMEOUT_SECONDS` | `90` | Per model call |
| `LIVE_WEATHER` | `true` | `false` if the network blocks Open-Meteo |
| `ORS_API_KEY` | blank | Wheelchair directions. **Keep the real key only in `.env`** |
| `TTS_BASE_URL` | blank | Speech NIM on the Spark (optional) |
| `DATABASE_PATH` | `.data/accessroute.sqlite3` | The SQLite file |
| `CORS_ORIGINS` | `http://localhost:5173,…` | Add a phone's origin for testing on a phone |
| `COOKIE_SECURE` | `false` | `true` behind HTTPS |

## 9. Checking it works

| What | How | Covers |
| --- | --- | --- |
| Unit tests | `cd backend` then `python -m pytest -q` (50 tests) | Rules; agent loop against a **fake** Ollama; model choosing an unsafe route; model offline; drafts; accounts; navigation; TTS; data from other branches |
| Evaluation | `python -m eval.run_eval` (tunnel open) | 8 cases with known answers against the **real** model on the Spark: 5 known, 1 ambiguous, 2 "I don't know". Writes `backend/eval/results.md` |
| Live check | `GET /api/v1/agent/health`, then a plan in the app | Shows "Agent: … on DGX Spark" and the green statistics panel |

## 10. Known limits

- **Route data is demo data.** The rules are only as good as the data they're given.
- **No live bus or tram feed is connected.** Disruptions come from the scenario buttons.
- **The map panel's live road incidents don't affect the plan.**
- **The start area is chosen from a fixed list**, by distance. There's no routing from an exact
  address yet.
- **Speech on the Spark needs a model the organisers didn't supply**, so the browser voice is the
  normal path.
- **Accounts are for a trusted demo network only.** There's no email verification or password
  reset.
