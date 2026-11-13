// Live guidance engine (pure functions, unit-tested in tests/guidance-simulator.test.mjs).
// A journey is a timeline of segments: "wait" (at a stop / for a taxi) and "move" (along a leg's path).
// The mock GPS position at any time comes from the timeline; real GPS can be fed in the same way later.

const MINUTE = 60000;
export const MODE_ICON = { roll: "♿", bus: "🚌", tram: "🚊", taxi: "🚕" };

export function metres(a, b) {
  const rad = d => (d * Math.PI) / 180;
  const h = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}

const pathLength = coords => coords.slice(1).reduce((sum, point, i) => sum + metres(coords[i], point), 0);
const lerp = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];

export function pointAlong(coords, distance) {
  if (coords.length < 2 || distance <= 0) return coords[0];
  let left = distance;
  for (let i = 1; i < coords.length; i += 1) {
    const step = metres(coords[i - 1], coords[i]);
    if (left <= step) return lerp(coords[i - 1], coords[i], step ? left / step : 0);
    left -= step;
  }
  return coords[coords.length - 1];
}

// Start a path at the traveller's current position (used after a mid-journey re-plan).
export function trimPathFrom(coords, position) {
  if (!coords?.length) return [position];
  let best = 0;
  coords.forEach((point, i) => { if (metres(point, position) < metres(coords[best], position)) best = i; });
  const rest = coords.slice(best + 1);
  return [position, ...(rest.length ? rest : [coords[coords.length - 1]])];
}

const validCoords = leg => Array.isArray(leg?.geometry?.coordinates) && leg.geometry.coordinates.length >= 2
  ? leg.geometry.coordinates : null;

// legs: agent LegOut objects. origin/goal: [lon, lat]. start: ms. padUntil (optional ms): if the agent's
// ETA is later than the legs add up to (e.g. a bus delay), wait at the start for the difference.
export function buildTimeline(legs, { start, origin, goal, padUntil = null, trimFirst = false }) {
  const total = legs.reduce((sum, leg) => sum + leg.minutes, 0) || 1;
  const segments = [];
  let t = start;
  let done = 0;
  let previousEnd = origin;
  legs.forEach((leg, legIndex) => {
    let coords = validCoords(leg);
    if (!coords) {
      done += leg.minutes;
      coords = [previousEnd, lerp(origin, goal, Math.min(1, done / total))];
    } else {
      done += leg.minutes;
      if (legIndex === 0 && trimFirst) coords = trimPathFrom(coords, origin);
    }
    const wait = (leg.wait_minutes || 0) * MINUTE;
    if (wait > 0) {
      segments.push({ kind: "wait", legIndex, mode: leg.mode, line: leg.line, coords: [coords[0]], length: 0, start: t, end: t + wait });
      t += wait;
    }
    const duration = Math.max(0.5, leg.minutes) * MINUTE;
    segments.push({ kind: "move", legIndex, mode: leg.mode, line: leg.line, coords, length: pathLength(coords), start: t, end: t + duration });
    t += duration;
    previousEnd = coords[coords.length - 1];
  });
  if (padUntil && padUntil > t && segments.length) {
    const pad = padUntil - t;
    segments.forEach(segment => { segment.start += pad; segment.end += pad; });
    segments.unshift({ kind: "wait", legIndex: 0, mode: legs[0].mode, line: legs[0].line, delay: true,
      coords: [segments[0].coords[0]], length: 0, start, end: start + pad });
    t += pad;
  }
  return { legs, segments, start, end: t, goal };
}

export function stateAt(timeline, now) {
  const { segments } = timeline;
  if (!segments.length || now >= timeline.end) {
    const last = segments[segments.length - 1];
    return { arrived: true, point: last ? last.coords[last.coords.length - 1] : timeline.goal, legIndex: timeline.legs.length - 1, segmentIndex: segments.length - 1 };
  }
  const segmentIndex = Math.max(0, segments.findIndex(segment => now < segment.end));
  const segment = segments[segmentIndex];
  const fraction = Math.min(1, Math.max(0, (now - segment.start) / (segment.end - segment.start)));
  const point = segment.kind === "move" ? pointAlong(segment.coords, segment.length * fraction) : segment.coords[0];
  return {
    arrived: false, segmentIndex, segment, legIndex: segment.legIndex, kind: segment.kind, mode: segment.mode, line: segment.line,
    fraction, point, metresLeft: Math.round(segment.length * (1 - fraction)),
    minutesLeft: Math.max(0, Math.ceil((segment.end - now) / MINUTE)), legProgress: segment.kind === "move" ? fraction : 0,
  };
}

// The one big visual cue on screen, plus what to say aloud. key changes when a new cue starts.
export function cueFor(state, timeline, entranceName = "the hospital entrance") {
  if (state.arrived) {
    return { key: "arrived", icon: "🏥", badge: "✓", value: "", tone: "good", speech: `You have arrived at ${entranceName}.` };
  }
  const leg = timeline.legs[state.legIndex] || {};
  const icon = MODE_ICON[state.mode] || "♿";
  const line = state.line ? ` ${state.line}` : "";
  if (state.kind === "wait") {
    const what = state.mode === "taxi" ? "your wheelchair-accessible taxi" : `${state.mode}${line}`;
    return { key: `${state.segmentIndex}:wait`, icon: state.mode === "taxi" ? "🚕" : "🚏", badge: state.line || "", value: `${state.minutesLeft} min`,
      tone: state.segment.delay ? "warn" : "neutral",
      speech: state.segment.delay ? `Delay. Wait here. About ${state.minutesLeft} minutes.`
        : state.mode === "taxi" ? `Wait here for ${what}. About ${state.minutesLeft} minutes.`
        : `Wait for ${what}. Ask the driver for the ramp.` };
  }
  if (state.mode === "bus" || state.mode === "tram") {
    if (state.minutesLeft <= 1 || state.fraction > 0.85) {
      return { key: `${state.segmentIndex}:alight`, icon: "🔔", badge: state.line || "", value: "Next stop", tone: "warn",
        speech: "Your stop is next. Press the bell and get ready to get off." };
    }
    return { key: `${state.segmentIndex}:ride`, icon, badge: state.line || "", value: `${state.minutesLeft} min`, tone: "neutral",
      speech: `On the ${state.mode}${line}. I will tell you when to get off.` };
  }
  if (state.mode === "taxi") {
    return { key: `${state.segmentIndex}:ride`, icon, badge: "", value: `${state.minutesLeft} min`, tone: "neutral",
      speech: "In the taxi to the hospital entrance." };
  }
  return { key: `${state.segmentIndex}:roll`, icon: "♿", badge: "➜", value: `${state.metresLeft} m`, tone: "neutral",
    speech: leg.instruction || "Continue along the route." };
}

// On-time status against the required arrival. level: good (5+ min spare), tight (0–4), late.
export function timeStatus(etaMs, arriveByMs) {
  const spare = Math.round((arriveByMs - etaMs) / MINUTE);
  return { spare, level: spare >= 5 ? "good" : spare >= 0 ? "tight" : "late" };
}
