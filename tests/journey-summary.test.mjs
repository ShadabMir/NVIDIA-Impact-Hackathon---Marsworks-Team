import test from "node:test";
import assert from "node:assert/strict";
import { journeySummary } from "../src/navigationPresentation.js";

const plan = {
  arrive_by: "2026-11-16T10:15:00+00:00",
  recommendation: { option_id: "bus" },
  options: [
    { id: "taxi", leave_at: "2026-11-16T09:45:00+00:00", arrive_at: "2026-11-16T10:15:00+00:00", total_minutes: 30 },
    { id: "bus", leave_at: "2026-11-16T09:32:00+00:00", arrive_at: "2026-11-16T10:15:00+00:00", total_minutes: 43 },
  ],
};
const remaining = { distance: 390, seconds: 360 };
const at = iso => new Date(iso).getTime();

test("shows the appointment schedule from the plan, not the current time", () => {
  const s = journeySummary({ plan, remaining, tracking: false, now: at("2026-11-13T16:24:00+00:00") });
  assert.equal(s.leaveAt, "09:32");
  assert.equal(s.arriveBy, "10:15");
  assert.match(s.day, /Mon,? 16 Nov/);
  assert.equal(s.journeyMinutes, 43);
  assert.equal(s.live, null);
});

test("no live estimate days before the appointment, even while tracking", () => {
  assert.equal(journeySummary({ plan, remaining, tracking: true, now: at("2026-11-13T16:24:00+00:00") }).live, null);
});

test("live estimate during the journey compares with arrive-by", () => {
  const early = journeySummary({ plan, remaining, tracking: true, now: at("2026-11-16T09:55:00+00:00") }).live;
  assert.deepEqual(early, { eta: "10:01", status: "14 min to spare", late: false });
  const late = journeySummary({ plan, remaining, tracking: true, now: at("2026-11-16T10:14:00+00:00") }).live;
  assert.deepEqual(late, { eta: "10:20", status: "about 5 min late", late: true });
});

test("no live estimate when not tracking or without a route", () => {
  const during = at("2026-11-16T09:55:00+00:00");
  assert.equal(journeySummary({ plan, remaining, tracking: false, now: during }).live, null);
  assert.equal(journeySummary({ plan, remaining: null, tracking: true, now: during }).live, null);
});

test("falls back to the appointment's arrive-by when there is no plan yet", () => {
  const s = journeySummary({ arriveBy: "2026-11-16T10:15:00+00:00", remaining, now: at("2026-11-13T16:24:00+00:00") });
  assert.equal(s.arriveBy, "10:15"); assert.equal(s.leaveAt, null); assert.equal(s.journeyMinutes, null);
});

test("summer time and bad input are handled", () => {
  const s = journeySummary({ arriveBy: "2027-06-14T10:15:00+01:00" });
  assert.equal(s.arriveBy, "10:15");
  const empty = journeySummary({ plan: { options: [] }, arriveBy: "not a date" });
  assert.deepEqual(empty, { leaveAt: null, arriveBy: null, day: null, journeyMinutes: null, live: null });
  assert.equal(journeySummary({}).arriveBy, null);
});
