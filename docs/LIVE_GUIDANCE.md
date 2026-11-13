# Live guidance and the Help button

After planning, **Plan & map → Guide me** starts real-time guidance. A mock GPS "drives" the
traveller along the agent's recommended route at demo speed (×10, ×30 or ×60). The screen shows
icons and numbers; every instruction is spoken.

## What's on screen

| Element | Meaning |
| --- | --- |
| Map | Route coloured by mode (♿ dotted blue, 🚌 green, 🚊 purple, 🚕 orange); travelled part grey; moving ♿ marker; 🚏 + bus number at stops; 🏥 entrance; 🚧 or ⏱ where a problem is |
| Clock chip (top left) | Expected arrival. Green: 5 or more minutes to spare; amber: 0–4; red: late. `+11` means 11 minutes to spare |
| Big cue | The one thing to do now: ♿ ➜ `120 m`, 🚏 `95` `6 min`, 🚌 `95` `14 min`, 🔔 `Next stop` (press the bell), 🏥 ✓ |
| Step strip | ♿ → 🚌95 → ♿ → 🏥, with ✓ for done steps and a frame around the current one |
| Agent card | After a problem: the new plan's icon (➜ carry on, ↪🏥 another entrance, 🚕 taxi from here), new arrival time, 📞🏥 if the hospital should be told, and who decided: 🤖 Nemotron or 🛡️ safety rules. Press ✓ to continue |
| Controls | ▶/⏸, demo speed, restart; demo problems: 🚧 pavement blocked ahead, 🚌⏱ bus 20 minutes late |
| 🔊 / 🔁 / ✕ | Voice on/off, repeat the instruction, close guidance |

Screen readers get a full sentence for every icon (`aria-label`).

## The mid-journey agent

`POST /api/v1/agent/guide/replan` (`backend/app/services/guidance.py`) is called when:
- a demo problem button is pressed;
- Help → **I'm stuck** is chosen; or
- the clock chip turns red (running late). This is checked automatically, once per route.

**How it decides:**

1. **Turns the problem into a disruption.** For example, it finds the next street being wheeled
   along and marks its pavement blocked, or delays the next bus.
2. **Builds options from the current position.**
   - **Carry on:** the rest of the route.
   - **Another entrance:** from the same stop, e.g. Glossop Road to Entrance 9. If she's already on
     the last stretch, this includes going back to the stop first.
   - **Wheelchair taxi from here:** 12 minutes to arrive, plus the drive.
3. **Checks every option with the same safety rules as journey planning:** slopes, closed or
   narrowed pavements, delays and timing.
4. **Nemotron chooses an option and writes the spoken instruction.** The rules reject its choice
   if the option is unsuitable, or if it arrives late when a suitable on-time option exists. If
   the Spark is unreachable, the rules choose (🛡️).

**Route shapes:** when guidance opens, `POST /api/v1/agent/guide/shapes` returns a map line for
every leg, from the start area to the stops (real stop coordinates in the data) to the entrance.

- **With `ORS_API_KEY`:** lines follow the roads via openrouteservice. Bus, tram and taxi legs use
  the driving profile; wheeling legs use the wheelchair profile, then walking if no wheelchair
  route exists. A "taxi from here" re-plan also follows the roads. Results are cached.
- **Without a key, or if the provider fails:** legs are straight lines between the correct stops,
  and a small **≈** badge on the map marks the route as approximate.

Waiting times come from each leg's `wait_minutes` (half the bus or tram interval, or the taxi
pickup). The route shapes in `backend/app/data/sheffield_rhh.json` are approximate demo
coordinates.

## Help button (Dexi's, from `feature/emergency-button`)

The red **Help** button is on every page:
- Call 999
- Alert the hospital team
- Call my carer
- Call the hospital
- I'm stuck: find another way

**Demo mode is on:** no real numbers are dialled (fictional Ofcom drama numbers are used). Real
calls only happen with `VITE_DEMO_MODE=false`; don't do that for a demo.

**What an alert contains:** the appointment, needs and current guidance step, plus the
**simulated position** while guiding. Alerts appear in the **Staff demo** tab, and in other
browser tabs too.

**"I'm stuck"** sends the problem to the mid-journey agent from the current position. If guidance
isn't running, it opens guidance instead.

## Tests

| Command | Covers |
| --- | --- |
| `cd backend; python -m pytest -q tests/test_guidance.py` | 13 tests: blocked ahead, bus delay, stuck on the last stretch, running late, re-plan after re-plan, bad input; the model's choice is used when allowed, and rejected when unsuitable or late; Spark down |
| `npm run test:navigation` | Includes 8 simulator tests: timeline, positions, cues (🚏, 🔔, 🏥), cue keys, delay padding, routes without shapes, trimming, the clock chip |

Browser checks with simulated GPS and Nemotron:
- the full journey with a blocked pavement and a new entrance;
- Help → alert, and I'm stuck, then the Staff demo;
- bus delay;
- Spark down;
- quick tab switching.

All finish with no page errors.
