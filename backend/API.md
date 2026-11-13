# Frontend API reference

Base URL: `http://SPARK_IP:8000` (use `http://localhost:8000` only on the API machine).

All successful responses below return HTTP 200. POST/PUT requests use `application/json`, except the image upload. Unknown JSON fields are rejected. Registration/login and saved profiles are implemented; saved journeys, background monitoring and automatic message sending are not. Keep journey state in React and resend it for reassessment/support. The Vite frontend defaults to `/backend` as a same-origin proxy; use `credentials: 'include'` for account calls.

Interactive schema: `/docs`. Machine-readable schema: `/openapi.json`.

## 1. Connection indicator — GET /health

Call on app startup or from a connection-check button. No body.

```json
{"status":"ok","routing_mode":"demo","model_configured":false}
```

`model_configured` only means a model name was set, not that inference works. Routing remains usable if extraction is unavailable.

## 2. Model status — GET /health/model

Call from a developer/setup status panel. No body. Checks Ollama reachability and whether the configured model is installed.

```json
{"status":"available","model":"your-configured-model","vision_support":"not_checked"}
```

Returns 503 if unconfigured, unavailable or missing. Test a letter separately to confirm vision support.

## 3. Hospital selector — GET /api/v1/hospitals

Call when loading the appointment confirmation screen. No body. Returns an array; each item has `id`, `name`, `data_status` and `notice`.

Currently only `northern-general-demo` is supported. Display the name but send the ID. Do not use extracted free-text hospital names directly as IDs; let the user select/confirm a supported hospital.

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
    "hospital": "Northern General Hospital",
    "department": "Demo outpatient department",
    "appointment_date": "2026-11-20",
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

## 5. Access form / journey results — POST /api/v1/journeys/plan

Call after appointment confirmation and completion of access requirements. Example body, referred to below as `journeyPayload`:

```json
{
  "origin_id": "demo-home",
  "appointment": {
    "hospital_id": "northern-general-demo",
    "department": "Demo outpatient department",
    "arrive_by": "2026-11-20T10:00:00+00:00",
    "confirmed_by_user": true
  },
  "access": {
    "wheelchair_user": false,
    "step_free_required": true,
    "max_continuous_walking_m": 150,
    "max_total_walking_m": 300,
    "min_transfer_minutes": 10
  }
}
```

Only the demo origin ID is supported; arbitrary addresses and GPS routing are not connected. The appointment fields are required. `origin_id` and `access` have defaults, but the frontend should submit the patient's explicit choices. Walking limits accept zero. Wheelchair use also enforces a step-free check. Department length: 1–150 characters. Distance limits: continuous 0–10,000 m; total 0–20,000 m; transfer time 0–120 minutes.

Response fields:

| Field | Frontend behaviour |
| --- | --- |
| `data_status` | Currently `simulated`; show a demo badge. |
| `notice` | Display the fixture-data limitation. |
| `recommended_route_id` | Highlight the matching item in `assessments`; may be null. |
| `support_needed` | If true, offer a travel-support draft. This is not an eligibility decision. |
| `assessments` | Render one card per assessed route, including rejected options if useful. |

Each assessment contains:

- `route`: `id`, `title`, `entrance`, `duration_minutes`, `total_walking_m`, `max_continuous_walking_m`, `transfer_minutes`, nullable `step_free` and `wheelchair_accessible`, `legs`, `data_status`, and `sources`.
- Each leg: `mode` (`walk`, `bus`, `transfer`), `instruction`, `duration_minutes`, `walking_distance_m`.
- `status`: use the display mapping below.
- `reasons`: failed checks; `unknowns`: unresolved access information.
- `leave_at`, `arrive_at`: timezone-aware timestamps.

| API status | Suggested label |
| --- | --- |
| `matches_demo_requirements` | Matches your requirements — demo data |
| `needs_verification` | Accessibility information needs checking |
| `rejected` | Does not meet your requirements / unavailable |

`null` accessibility is unknown, never equivalent to true. The direct fixture normally matches the example; the shorter-transfer fixture fails it; the alternative has unknown access. A simulated match does not certify a real route as accessible.

## 6. Disruption / replan button — POST /api/v1/journeys/reassess

Send the original request inside `journey`, not the previous response. JavaScript payload construction:

```javascript
const reassessmentPayload = {
  journey: journeyPayload,
  disruption: {
    unavailable_route_ids: ['demo-direct'],
    delay_minutes_by_route: {},
  },
  earliest_departure: '2026-11-20T09:00:00+00:00',
};
```

Use route IDs returned in assessments. Delays are maps such as `{"demo-direct":15}`; each delay must be 0–240 minutes. Unknown IDs return 422. `earliest_departure` is optional but should be supplied when checking feasibility from now or from a user-selected departure time. The response has the same shape as journey planning, so reuse the result component.

There is no live disruption subscription or polling source yet; this endpoint evaluates a supplied scenario. Delays adjust whole-route duration, not individual leg instructions; display updated elapsed duration from `arrive_at - leave_at`. Per-leg times remain the baseline fixture values.

## 7. Support screen — POST /api/v1/support/draft

Accepts the same body as reassessment; `disruption` is optional here. The backend recalculates barriers from the supplied journey/scenario.

Returns `subject` and `body` strings plus:

```json
{"sent":false,"generation_method":"template","requires_review":true,"data_status":"simulated"}
```

Display an editable subject/message with a copy button. This is a template draft, not an LLM-generated message. No recipient is resolved, no eligibility is promised and no message is sent. If a route matches, the draft says so rather than claiming no option exists.

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

Profile fields: `first_name`, `last_name`, `email`, `default_hospital_id` (currently `northern-general-demo`), `mobility_aid`, and `access`. Mobility aid: `manual_wheelchair`, `powered_wheelchair`, `walking_aid`, `limited_mobility`, or `no_aid`. Access fields are the existing journey fields plus nullable `max_gradient_percent` (0–15) and `boarding_buffer_minutes` (0–30). The preset uses 5% and 3 minutes respectively for wheelchairs, with assumptions disclosed in Settings. Changing the mobility aid resets suggested values in the UI; users can override them.

These access fields are accepted by journey planning and reassessment. Known simulated slopes are compared against the preference; missing gradients stay unknown. Boarding buffer is added once per bus leg to overall journey duration. Use `arrive_at - leave_at` for total planned elapsed time; fixture leg times remain baseline.

Account errors: 401 invalid/expired session or invalid credentials; 403 untrusted Origin for account mutations; 409 duplicate email; 422 invalid profile/password. No password is included in a successful response. Password recovery and verification emails are not implemented.

## Location and live outdoor navigation

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/locations/reverse?latitude=...&longitude=...` | Explicit one-time lookup. Returns nearby `address`, coordinates, `source`, and confirmation notice. |
| GET | `/api/v1/locations/search?q=...` | Explicit UK address/place search, 3–250 characters. Returns up to 3 `{label, latitude, longitude, source}` items. No autocomplete. |
| POST | `/api/v1/navigation/route` | `{origin: {latitude,longitude}, destination: {latitude,longitude}, access: {...}}`; requests ORS wheelchair geometry and instructions. |

Navigation returns `geometry` (GeoJSON LineString), `steps` (`instruction`, `distance_m`, `duration_seconds`, `coordinate` as `[longitude,latitude]`), total `distance_m`, total `duration_seconds`, `provider`, `data_status`, `applied_max_gradient_percent`, `exceeds_total_distance`, `warnings`, `provider_warnings` and `notice`. It returns 503 until `ORS_API_KEY` is configured; 502/504 indicate provider failure/timeout. It never substitutes a car route. ORS's discrete incline limits are rounded down; preferences below its 3% minimum return 422 rather than being silently relaxed.

Live location uses browser `watchPosition`, not a polling API. GPS movement does not automatically request a new route, send repeated reverse lookups or prove route accessibility. Render provider warnings and distance/rest limitations. Keep provider directions visually separate from simulated bus-journey assessments. Confirm the exact destination entrance; geocoding may return the centre of a building.
