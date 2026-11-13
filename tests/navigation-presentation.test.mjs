import test from "node:test";
import assert from "node:assert/strict";
import { MODE_STYLE, remainingJourney, shouldUpdateRoute, transitRecommendations } from "../src/navigationPresentation.js";

const geometry = { type: "LineString", coordinates: [[-1.48, 53.38], [-1.48, 53.39]] };
const navigation = { geometry, distance_m: 1100, duration_seconds: 1200 };
const origin = { longitude: -1.48, latitude: 53.38 };
const halfway = { longitude: -1.48, latitude: 53.385, accuracy: 10 };

test("remaining distance and duration follow progress along the route", () => {
  const result = remainingJourney(navigation, halfway);
  assert.ok(Math.abs(result.distance - 550) < 1);
  assert.ok(Math.abs(result.seconds - 600) < 1);
  assert.equal(remainingJourney(navigation, { ...halfway, accuracy: 150 }).distance, 1100);
  assert.equal(remainingJourney(navigation, { ...halfway, longitude: -1.46 }).distance, 1100);
});

test("automatic rerouting responds to deviation but ignores noisy or frequent fixes", () => {
  const input = { navigation, lastOrigin: origin, requestedAt: 100000, now: 140000,
    location: { ...halfway, longitude: -1.478 }, busy: false };
  assert.equal(shouldUpdateRoute(input), true);
  assert.equal(shouldUpdateRoute({ ...input, now: 110000 }), false);
  assert.equal(shouldUpdateRoute({ ...input, busy: true }), false);
  assert.equal(shouldUpdateRoute({ ...input, location: { ...input.location, accuracy: 100 } }), false);
  assert.equal(shouldUpdateRoute({ ...input, location: halfway }), false);
  assert.equal(shouldUpdateRoute({ ...input, location: halfway, now: 220000 }), true);
});

test("transport suggestions preserve real shapes and distinguish bus from tram", () => {
  const plan = { recommended_route_id: "chosen", data_status: "simulated", assessments: [
    { route: { id: "chosen", legs: [
      { mode: "walk", instruction: "Walk to the stop" },
      { mode: "bus", line: "95", instruction: "Board bus 95", geometry },
      { mode: "tram", instruction: "Change to tram" },
    ] } },
    { route: { id: "other", legs: [{ mode: "taxi" }] } },
  ] };
  const legs = transitRecommendations(plan);
  assert.equal(legs.length, 2);
  assert.deepEqual(legs[0].geometry, geometry);
  assert.equal(legs[1].geometry, null);
  assert.equal(legs[0].simulated, true);
  assert.notEqual(MODE_STYLE.bus.color, MODE_STYLE.tram.color);
  assert.notEqual(MODE_STYLE.bus.icon, MODE_STYLE.tram.icon);
});

test("agent transport shapes and stops are accepted without fabricating missing geometry", () => {
  const stops = [{ name: "Example stop", coordinate: [-1.48, 53.38] }];
  const plan = { recommendation: { option_id: "chosen" }, options: [
    { id: "chosen", legs: [{ mode: "bus", map_stops: stops, geometry: { type: "LineString", coordinates: [[999, 53], [0, 53]] } }] },
  ] };
  const [leg] = transitRecommendations(plan);
  assert.deepEqual(leg.map_stops, stops);
  assert.equal(leg.geometry, null);
  assert.deepEqual(transitRecommendations(null), []);
});
