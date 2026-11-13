import test from "node:test";
import assert from "node:assert/strict";
import { buildTimeline, cueFor, metres, pointAlong, stateAt, timeStatus, trimPathFrom } from "../src/guidance/simulator.js";

const HOME = [-1.4979, 53.3953], STOP_A = [-1.4984, 53.39545], STOP_B = [-1.4883, 53.38005], ENT = [-1.4893, 53.3788];
const legs = [
  { mode: "roll", minutes: 3, wait_minutes: 0, instruction: "Roll 45 m to the stop.", geometry: { type: "LineString", coordinates: [HOME, STOP_A] } },
  { mode: "bus", line: "95", minutes: 18, wait_minutes: 6, instruction: "Bus 95.", geometry: { type: "LineString", coordinates: [STOP_A, [-1.4921, 53.3874], STOP_B] } },
  { mode: "roll", minutes: 3, wait_minutes: 0, instruction: "Roll 50 m down Beech Hill Road.", geometry: { type: "LineString", coordinates: [STOP_B, ENT] } },
];
const start = Date.parse("2026-11-16T09:30:00Z");
const at = minutes => start + minutes * 60000;
const timeline = buildTimeline(legs, { start, origin: HOME, goal: ENT });

test("timeline: roll, wait for the bus, ride, roll; ends 30 minutes later", () => {
  assert.deepEqual(timeline.segments.map(s => `${s.kind}:${s.mode}`), ["move:roll", "wait:bus", "move:bus", "move:roll"]);
  assert.equal((timeline.end - start) / 60000, 30);
});

test("position moves along the route and stays put while waiting", () => {
  assert.deepEqual(stateAt(timeline, start).point, HOME);
  const waiting = stateAt(timeline, at(5));
  assert.equal(waiting.kind, "wait"); assert.deepEqual(waiting.point, STOP_A);
  const riding = stateAt(timeline, at(18));
  assert.equal(riding.mode, "bus"); assert.ok(riding.fraction > 0.4 && riding.fraction < 0.6);
  const done = stateAt(timeline, at(31));
  assert.equal(done.arrived, true); assert.deepEqual(done.point, ENT);
});

test("cues: roll with metres, bus stop with line, ride, press-bell before the stop, arrival", () => {
  assert.equal(cueFor(stateAt(timeline, at(1)), timeline).icon, "♿");
  assert.match(cueFor(stateAt(timeline, at(1)), timeline).value, /^\d+ m$/);
  const wait = cueFor(stateAt(timeline, at(5)), timeline);
  assert.equal(wait.icon, "🚏"); assert.equal(wait.badge, "95"); assert.match(wait.speech, /ramp/);
  assert.equal(cueFor(stateAt(timeline, at(15)), timeline).icon, "🚌");
  const bell = cueFor(stateAt(timeline, at(26.5)), timeline);
  assert.equal(bell.icon, "🔔"); assert.match(bell.speech, /bell/);
  const arrived = cueFor(stateAt(timeline, at(40)), timeline, "the A Floor Outpatients Entrance");
  assert.equal(arrived.icon, "🏥"); assert.match(arrived.speech, /A Floor/);
});

test("each cue has a stable key so it is spoken once", () => {
  assert.equal(cueFor(stateAt(timeline, at(9)), timeline).key, cueFor(stateAt(timeline, at(12)), timeline).key);
  assert.notEqual(cueFor(stateAt(timeline, at(12)), timeline).key, cueFor(stateAt(timeline, at(26.5)), timeline).key);
});

test("agent ETA later than the legs (e.g. bus delay) adds a delay wait at the start", () => {
  const delayed = buildTimeline(legs.slice(1), { start, origin: STOP_A, goal: ENT, padUntil: at(45) });
  assert.equal(delayed.segments[0].delay, true);
  assert.equal(delayed.end, at(45));
  assert.equal(cueFor(stateAt(delayed, at(1)), delayed).tone, "warn");
});

test("legs without geometry fall back to a straight line towards the goal", () => {
  const plain = buildTimeline([{ mode: "taxi", minutes: 10, wait_minutes: 12 }], { start, origin: HOME, goal: ENT });
  assert.deepEqual(plain.segments.map(s => s.kind), ["wait", "move"]);
  assert.equal(cueFor(stateAt(plain, at(2)), plain).icon, "🚕");
  assert.deepEqual(stateAt(plain, at(30)).point, ENT);
});

test("trimPathFrom starts the path at the current position", () => {
  const trimmed = trimPathFrom([STOP_A, [-1.4921, 53.3874], STOP_B], [-1.4925, 53.3878]);
  assert.deepEqual(trimmed[0], [-1.4925, 53.3878]); assert.deepEqual(trimmed[trimmed.length - 1], STOP_B);
});

test("timeStatus levels and helpers", () => {
  assert.deepEqual(timeStatus(at(30), at(45)), { spare: 15, level: "good" });
  assert.equal(timeStatus(at(43), at(45)).level, "tight");
  assert.equal(timeStatus(at(50), at(45)).level, "late");
  assert.ok(Math.abs(metres(HOME, STOP_A) - 39) < 10);
  assert.deepEqual(pointAlong([HOME], 10), HOME);
});
