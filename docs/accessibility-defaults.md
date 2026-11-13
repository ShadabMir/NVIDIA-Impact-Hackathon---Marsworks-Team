# Accessibility presets and source notes

Checked 13 November 2026. These presets initialise editable planning preferences. They do not calculate, diagnose or certify a person's abilities from age, wheelchair type or diagnosis.

## Published guidance used

Department for Transport, **Inclusive Mobility: A Guide to Best Practice on Access to Pedestrian and Transport Infrastructure**, December 2021, published January 2022:

- [Publication and accessible-format information](https://www.gov.uk/government/publications/inclusive-mobility-making-transport-accessible-for-passengers-and-pedestrians)
- [Full guide PDF](https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/1044542/inclusive-mobility-a-guide-to-best-practice-on-access-to-pedestrian-and-transport-infrastructure.pdf)
- §3.4, printed page 26: recommended average distances without a rest: wheelchair users 150 m; stick/cane users 50 m; mobility impairment without a stick 100 m. The guide explicitly notes individual variation and effects of terrain, weather and other conditions.
- §4.3, gradients: prefer level pedestrian environments; where that is infeasible, gradients should not exceed 1:20 (5%). Duration, landings and crossfall matter too. This is infrastructure design guidance, not a universal safe operating slope for a wheelchair or a person.

The default for manual and powered wheelchairs is 150 m continuously, with a preferred slope cap of 5%. The app does not infer a powered chair's battery range or manufacturer slope rating. Walking-frame users provisionally share the 50 m stick/cane preset; that extension is an app assumption, not a separate DfT finding. Personal preferences and equipment guidance take precedence.

## Explicit app assumptions

| Setting | Initial value | Rationale / boundary |
| --- | --- | --- |
| Additional wheelchair boarding allowance | 3 minutes per bus boarding | Engineering buffer; not a sourced average or guarantee. |
| Minimum transfer margin | 10 minutes | Editable planning assumption. |
| Total walking/wheeling cap | Twice the continuous-distance preference | Prototype assumption, not endurance evidence. |
| No-aid distance preset | 300 m continuous | Prototype preference, not evidence about an individual's capacity. |
| Extra-help checkbox | 5-minute boarding allowance | User-requested planning buffer. |

[DfT bus accessibility information](https://www.gov.uk/government/publications/buses-and-coaches-features-and-help-for-disabled-people/buses-and-coaches-features-and-help-for-disabled-people) explains boarding assistance and ramps/lifts, but is not evidence for a universal boarding duration. The app therefore labels its time buffers as assumptions.

The prototype route checker enforces distances, step-free/wheelchair flags, transfer time and available simulated gradient values. Added boarding time increases total journey duration. Missing gradient/access information remains unknown. Fixture flags are fictional, never survey results.

## Live map and directions

- [Browser Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API/Using_the_Geolocation_API): permission plus a secure context (HTTPS or localhost). The app uses watchPosition and clears the watch on stop/unmount. GPS tracking does not continuously send coordinates to the server.
- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/): explicit searches/reverse lookups, identifying User-Agent, in-memory cache, and at most one request per second in the single-worker backend. No autocomplete and no reverse lookup for every GPS update. Multiple backend workers require a shared limiter or another provider.
- [openrouteservice wheelchair options](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/routing-options): server-side provider key, wheelchair profile, avoid steps/ferries and apply incline/kerb restrictions. Supported incline values are discrete (3, 6, 10, 15%). A 5% preference is rounded down to 3%, not up to 6%. A preference below 3% is not silently relaxed: the app returns an error.
- [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/): browser requests tiles with attribution; no bulk downloading or offline prefetching.

These directions are outdoor wheelchair-profile routes, not live bus routing or certified accessible routes. Total-distance exceedances and unverified resting opportunities are flagged. The routing provider depends on map data, which can be incomplete. Users select and confirm the destination entrance; a geocoded building centre is not a verified entrance. Geometry, instructions and GPS are separate from the labelled simulated appointment-journey fixture and advanced GeoJSON examples.

## Remaining external setup

1. Configure the reachable Spark Ollama endpoint and exact installed vision model:

   ```sh
   python3 scripts/configure_spark.py --url http://SPARK_IP:11434 --model INSTALLED_VISION_MODEL
   ```

   Restart the backend. Check `/health/model`, then upload a synthetic image to verify actual vision inference. A configured name or installed model alone does not prove image support or GPU use. If the backend runs on Spark, use its loopback Ollama URL; do not expose the model server publicly.

2. For live outdoor directions, set `ORS_API_KEY` in `backend/.env`, then restart. The key stays on the backend. No key means a clear 503; no route is fabricated.
3. Phone GPS requires an HTTPS deployment reachable from the phone; ordinary HTTP over a LAN IP is not sufficient. The Vite proxy keeps browser API calls on the same origin.
4. Accounts are stored locally in `backend/.data/accessroute.sqlite3` by default (ignored by git). Passwords use salted PBKDF2-SHA256 and sessions use hashed, revocable random tokens with HttpOnly cookies. Enable `COOKIE_SECURE=true` under HTTPS. This is a hackathon account implementation without email verification, password recovery or production abuse controls; use synthetic account details.
