# Frontend API reference

Base URL: `http://SPARK_IP:8000` (use `http://localhost:8000` only on the API machine).

All successful responses below return HTTP 200. POST/PUT requests use `application/json`, except the image upload. Unknown JSON fields are rejected. Registration/login and saved profiles are implemented; saved journeys, background monitoring and automatic message sending are not. Keep the agent request in React and resend it for re-planning and drafts. The Vite frontend defaults to `/backend` as a same-origin proxy; use `credentials: 'include'` for account calls.

Interactive schema: `/docs`. Machine-readable schema: `/openapi.json`.

## Journey agent: /api/v1/agent/*

The app plans every journey with the Nemotron agent. See [AGENT.md](../AGENT.md) for how it
works, and `/docs` for the full schemas.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/agent/health` | Is the agent model (`OLLAMA_AGENT_MODEL`) reachable and installed? |
| POST | `/api/v1/agent/warmup` | Load the model on the Spark and keep it loaded (before a demo) |
| GET | `/api/v1/agent/context` | Start areas (with coordinates), hospital and entrances, disruption scenarios |
| POST | `/api/v1/agent/plan` | Plan: `{origin_id, appointment, needs, disruptions, earliest_departure, use_model}` |
| POST | `/api/v1/agent/reassess` | `{request, disruptions, earliest_departure}`: re-plan with problems added |
| POST | `/api/v1/agent/draft` | `{kind, request, location, details, use_model}`: reviewable message; never sends |

Example plan request (the app builds `needs` from the saved profile):

```json
{
  "origin_id": "walkley",
  "appointment": {
    "hospital_id": "royal-hallamshire",
    "department": "Neuro-Rehabilitation Outpatients",
    "arrive_by": "2026-11-16T10:15:00+00:00",
    "confirmed_by_user": true
  },
  "needs": {"mobility_aid": "powered_wheelchair", "max_gradient_pct": 5, "needs_accessible_toilet": true},
  "use_model": true
}
```

The response includes:

- `recommendation`: `option_id`, `summary`, `reasons`, `tips` and `generated_by`.
- `options`: each route's status (`suitable`, `caution` or `unsuitable`), leave time, legs and
  barriers.
- `support_needed` and `suggested_actions` (which drafts to offer).
- `weather`, `toilets`, `entrance` and `agent_steps` (the tool-call trace).
- `model_stats` (calls, tokens, tokens per second) and `agent_mode`.

`origin_id: "elsewhere"` (no route data) returns `option_id: null` with an "I don't know" summary.
Draft kinds are `blocked_pavement_report`, `hospital_transport_request` and `operator_feedback`.

## 1. Connection indicator — GET /health

Call on app startup or from a connection-check button. No body.

```json
{"status":"ok","routing_mode":"agent","model_configured":false,"live_navigation_configured":false}
```

`model_configured` only means a letter-reading model name was set, not that inference works. Journey planning remains usable if extraction is unavailable.

## 2. Model status — GET /health/model

Call from a developer/setup status panel. No body. Checks Ollama reachability and whether the configured model is installed.

```json
{"status":"available","model":"your-configured-model","vision_support":"not_checked"}
```

Returns 503 if unconfigured, unavailable or missing. Test a letter separately to confirm vision support.

## 3. Hospital selector — GET /api/v1/hospitals

Call when loading the appointment confirmation screen. No body. Returns an array; each item has `id`, `name`, `data_status` and `notice`.

Only `royal-hallamshire` is supported (the agent has route data for it). Display the name but send the ID. Do not use extracted free-text hospital names directly as IDs; let the user select/confirm a supported hospital.

## 4. Upload screen — POST /api/v1/appointments/extract

Send `multipart/form-data` with file field `file`. JPEG/PNG only, default maximum 10 MB; PDF is unsupported. Let the browser set the multipart Content-Type.

```javascript
const form = new FormData();
form.append('file', selectedFile);
const response = await fetch(`${API}/api/v1/appointments/extract`, {
  method: 'POST', body: form,
});
```

Example response (illustrative extracted values):

```json
{
  "details": {
    "hospital": "Royal Hallamshire Hospital",
    "department": "Neuro-Rehabilitation Outpatients",
    "appointment_date": "2026-11-16",
    "appointment_time": "10:15:00",
    "arrival_time": "10:00:00",
    "warnings": []
  },
  "requires_confirmation": true,
  "processing_location": "configured_local_model_server",
  "model": "your-configured-model"
}
```

All extracted fields except `warnings` may be null. Populate editable fields, show warnings and request confirmation. Offer manual entry if extraction fails. Combine the confirmed date and arrival time into timezone-aware `arrive_by` for planning; if no arrival time is present, ask the user rather than inventing one. Configure the model server on Spark to keep inference local.

## 5. Journey planning, re-planning and support drafts

Use the agent routes above (`/plan`, `/reassess`, `/draft`). The earlier rule-based
`/api/v1/journeys/*` and `/api/v1/support/draft` routes have been removed from this app.

## Errors and display rules

Errors use `{"detail":"message"}`; validation errors may contain a list under `detail`. Always check `response.ok` before treating a response as results.

| HTTP code | Meaning / UI action |
| --- | --- |
| 413 | Image too large; ask for a smaller file. |
| 415 | Unsupported or invalid image; request JPEG/PNG. |
| 422 | Invalid/missing fields, timezone or route ID; show the relevant form error. |
| 502 | Model request/output failed; offer retry and manual entry. |
| 503 | Model not configured/available; allow manual appointment entry. |
| 504 | Model timed out; offer retry and manual entry. |

Use a loading state during extraction/planning. Preserve user-entered details on failure. Render model text and drafts as plain text. Format timestamps for `Europe/London`; do not append `Z` to a local time without conversion. All JSON POST calls need `Content-Type: application/json`.

For a phone demo, use HTTPS (geolocation is unavailable over ordinary LAN HTTP) and add the actual frontend origin to backend `CORS_ORIGINS`. Keep the same-origin proxy where possible. Use synthetic documents and account details.

## Profiles and settings

| Method | Path | Body / response |
| --- | --- | --- |
| GET | `/api/v1/access/defaults` | `presets` keyed by mobility-aid ID, plus source notes and assumptions. |
| POST | `/api/v1/auth/register` | Full profile plus `password` (10–256 characters); returns profile and sets HttpOnly session cookie. |
| POST | `/api/v1/auth/login` | `{email, password}`; returns saved profile and sets session cookie. |
| POST | `/api/v1/auth/logout` | No body; revokes session and clears cookie. |
| GET | `/api/v1/profile` | Current user's profile; 401 if not signed in. |
| PUT | `/api/v1/profile` | Replace own profile; requires cookie. Returns saved profile. |

Profile fields: `first_name`, `last_name`, `email`, `default_hospital_id` (currently `royal-hallamshire`), `mobility_aid`, and `access`. Mobility aid: `manual_wheelchair`, `powered_wheelchair`, `walking_aid`, `limited_mobility`, or `no_aid`. Access fields are the existing journey fields plus nullable `max_gradient_percent` (0–15) and `boarding_buffer_minutes` (0–30). The preset uses 5% and 3 minutes respectively for wheelchairs, with assumptions disclosed in Settings. Changing the mobility aid resets suggested values in the UI; users can override them.

The app turns these into the agent's `needs` (`src/agent/profileNeeds.js`): slope becomes `max_gradient_pct`, the two distances become roll limits, and transfer plus boarding time becomes `extra_minutes`.

Profile also accepts `default_starting_address` (optional string, up to 500 characters). Existing profiles load with an empty value until edited. No password/session reset is needed.

## Saved UI forms

- `GET /api/v1/workspace`: signed-in user's `{appointment, agent_request, updated_at}`. Missing forms are null.
- `PATCH /api/v1/workspace`: update either form without replacing the other. Send a field as null to delete it. Requires the account cookie and a trusted Origin.
- `appointment` matches the main frontend form: `{hospital_id, department, date, arrival, origin}`. `date` is YYYY-MM-DD; `arrival` is HH:MM in hospital UK time. Only the current demo hospital ID is accepted.
- `agent_request` uses the existing `AgentPlanRequest` schema: appointment, needs, origin ID, optional earliest departure and model toggle. Save does not call the model or run route planning.
- Raw uploaded letters, GPS traces, route results and transient road incidents are not accepted as saved workspace fields.
- Both reads and writes return `Cache-Control: no-store`. Guests can plan but cannot save forms. Saved appointments must be reconfirmed after loading.

The main appointment screen and agent form have explicit save/remove controls. The agent can load the signed-in profile's distance, slope and step-free settings. It combines transfer and boarding buffers into its own single extra-time field; users should review that translation. The hospital-specific appointment forms remain separate, and neither is silently converted into an appointment at another hospital.

Account errors: 401 invalid/expired session or invalid credentials; 403 untrusted Origin for account mutations; 409 duplicate email; 422 invalid profile/password. No password is included in a successful response. Password recovery and verification emails are not implemented.

## Location and live outdoor navigation

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/locations/reverse?latitude=...&longitude=...` | Explicit one-time lookup. Returns nearby `address`, coordinates, `source`, and confirmation notice. |
| GET | `/api/v1/locations/search?q=...` | Explicit UK address/place search, 3–250 characters. Returns up to 3 `{label, latitude, longitude, source}` items. No autocomplete. |
| POST | `/api/v1/navigation/route` | `{origin: {latitude,longitude}, destination: {latitude,longitude}, access: {...}}`; requests ORS wheelchair geometry and instructions. |

Navigation returns `geometry` (GeoJSON LineString), `steps` (`instruction`, `distance_m`, `duration_seconds`, `coordinate` as `[longitude,latitude]`), total `distance_m`, total `duration_seconds`, `provider`, `data_status`, `applied_max_gradient_percent`, `exceeds_total_distance`, `warnings`, `provider_warnings` and `notice`. It returns 503 until `ORS_API_KEY` is configured; 502/504 indicate provider failure/timeout. It never substitutes a car route. ORS's discrete incline limits are rounded down; preferences below its 3% minimum return 422 rather than being silently relaxed.

Live location uses browser `watchPosition`, not a polling API. GPS movement does not automatically request a new route, send repeated reverse lookups or prove route accessibility. Render provider warnings and distance/rest limitations. Keep provider directions visually separate from simulated bus-journey assessments. Confirm the exact destination entrance; geocoding may return the centre of a building.
