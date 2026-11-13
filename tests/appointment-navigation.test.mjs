import test from "node:test";
import assert from "node:assert/strict";
import { loadAppointmentNavigation } from "../src/appointmentNavigation.js";

const appointment = { hospital_id: "northern-general-demo", origin: "Fictional Sheffield address" };
const hospitals = [{ id: appointment.hospital_id, name: "Northern General Hospital (demo)" }];
const access = { step_free_required: true, max_gradient_percent: 5 };
const origin = { latitude: 53.39, longitude: -1.49, label: "Start" };
const hospital = { latitude: 53.41, longitude: -1.46, label: "Appointment hospital" };
const route = { geometry: { type: "LineString", coordinates: [[-1.49, 53.39], [-1.46, 53.41]] }, steps: [] };

test("appointment hospital and address produce a drawable route without destination re-entry", async () => {
  const calls = [];
  const result = await loadAppointmentNavigation({ appointment, hospitals, access, request: async (path, options) => {
    calls.push({ path, options });
    if (path.includes("Northern%20General%20Hospital")) return [hospital];
    if (path.startsWith("/api/v1/locations/search")) return [origin];
    return route;
  } });
  assert.equal(calls.length, 3);
  assert.ok(decodeURIComponent(calls[0].path).includes("Northern General Hospital, Sheffield"));
  const payload = JSON.parse(calls[2].options.body);
  assert.deepEqual(payload.origin, { latitude: origin.latitude, longitude: origin.longitude });
  assert.deepEqual(payload.destination, { latitude: hospital.latitude, longitude: hospital.longitude });
  assert.deepEqual(payload.access, access);
  assert.equal(result.navigation.geometry.type, "LineString");
});

test("a known starting point avoids asking for or searching the address again", async () => {
  const calls = [];
  await loadAppointmentNavigation({ appointment, hospitals, originPoint: origin, access, request: async path => {
    calls.push(path); return path.includes("locations/search") ? [hospital] : route;
  } });
  assert.equal(calls.length, 2);
});

test("changing hospitals cannot reuse an entrance selected for a different hospital", async () => {
  const result = await loadAppointmentNavigation({ appointment, hospitals, originPoint: origin, access,
    destinationOverride: { ...origin, hospital_id: "different-hospital" },
    request: async path => path.includes("locations/search") ? [hospital] : route,
  });
  assert.equal(result.destination.hospital_id, appointment.hospital_id);
  assert.equal(result.destination.latitude, hospital.latitude);
});

test("explicit entrance correction and current GPS coordinates are preserved", async () => {
  const corrected = { ...hospital, hospital_id: appointment.hospital_id };
  const live = { latitude: 53.4, longitude: -1.48 };
  await loadAppointmentNavigation({ appointment, hospitals, originPoint: origin, liveLocation: live,
    destinationOverride: corrected, access, request: async (path, options) => {
      assert.equal(path, "/api/v1/navigation/route");
      assert.deepEqual(JSON.parse(options.body).origin, live);
      return route;
    },
  });
});

test("lookup failure and missing route geometry are reported instead of drawing invented routes", async () => {
  await assert.rejects(loadAppointmentNavigation({ appointment, hospitals, access, request: async () => [] }), /Could not locate/);
  await assert.rejects(loadAppointmentNavigation({ appointment, hospitals, originPoint: origin,
    destinationOverride: { ...hospital, hospital_id: appointment.hospital_id }, access, request: async () => ({}) }), /no drawable route/);
});
