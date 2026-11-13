import { useEffect, useMemo, useRef, useState } from "react";
import { IconBus, IconClock, IconPlayerPause, IconPlayerPlay, IconRefresh, IconRepeat, IconRoadOff, IconVolume, IconVolumeOff, IconX } from "@tabler/icons-react";
import { api } from "../api";
import { speak, stopSpeaking } from "../tts/speak.js";
import GuidanceMap from "./GuidanceMap.jsx";
import { buildTimeline, cueFor, MODE_ICON, stateAt, timeStatus } from "./simulator.js";
import "./guidance.css";

// Live guidance with mock GPS: Margaret "travels" the agent's recommended route at demo speed.
// Visual cues on screen, instructions spoken. Problems during the journey are sent to the
// mid-journey agent (POST /api/v1/agent/guide/replan), which decides what to do from here.
const SPEEDS = [10, 30, 60];
const ACTION_ICON = { continue: "➜", alternative_entrance: "↪", taxi_from_here: "🚕" };
const clock = ms => new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

export default function LiveGuidance({ plan, request, origin, goal, onClose, onProgress, stuckRef }) {
  const best = plan.options.find(option => option.id === plan.recommendation.option_id) || plan.options[0];
  const arriveBy = Date.parse(plan.arrive_by);
  const entranceName = plan.entrance?.name ? `the ${plan.entrance.name}` : "the hospital entrance";
  // Road-following shapes for the planned legs (openrouteservice via the backend; straight lines between stops if unavailable).
  const [shaped, setShaped] = useState(null);
  const baseLegs = shaped?.legs || best.legs;
  const firstPoint = baseLegs.find(leg => leg.geometry)?.geometry.coordinates[0] || origin;
  const initial = useMemo(() => buildTimeline(baseLegs, { start: Date.parse(best.leave_at), origin: firstPoint, goal }), [baseLegs, best.leave_at, firstPoint, goal]);

  const [run, setRun] = useState(0);
  const [route, setRoute] = useState({ id: best.id, legs: best.legs, timeline: initial, custom: false, entrance: entranceName });

  useEffect(() => {
    let active = true;
    api("/api/v1/agent/guide/shapes", { method: "POST", body: JSON.stringify({ origin_id: request.origin_id, option_id: best.id, entrance_id: plan.entrance?.id || null }) })
      .then(result => {
        if (!active) return;
        const legs = best.legs.map((leg, index) => ({ ...leg, ...(result.legs[index] || {}) }));
        const start = legs.find(leg => leg.geometry)?.geometry.coordinates[0] || origin;
        setShaped({ legs, source: result.source });
        // Swap in the road shapes unless the route has already been re-planned.
        setRoute(previous => previous.custom ? previous
          : { ...previous, legs, timeline: buildTimeline(legs, { start: Date.parse(best.leave_at), origin: start, goal }) });
      })
      .catch(() => { if (active) setShaped(previous => previous || { legs: best.legs, source: "straight" }); });
    return () => { active = false; };
  }, [best, request.origin_id, plan.entrance?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [simNow, setSimNow] = useState(initial.start);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(30);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState(null);
  const [problems, setProblems] = useState([]);
  const [disruptions, setDisruptions] = useState([]);
  const [error, setError] = useState("");
  const spoken = useRef("");
  const lateChecked = useRef("");
  const replanRef = useRef(null);

  const state = stateAt(route.timeline, simNow);
  const cue = cueFor(state, route.timeline, route.entrance);
  const status = timeStatus(route.timeline.end, arriveBy);

  // Simulation clock.
  const running = playing && !state.arrived;
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setSimNow(now => now + 200 * speed), 200);
    return () => clearInterval(timer);
  }, [running, speed]);

  // Speak each new cue once; report progress (for the Help button's staff alert).
  useEffect(() => {
    if (cue.key === spoken.current) return;
    spoken.current = cue.key;
    if (!muted) speak(cue.speech).catch(() => {});
    onProgress?.({ step: `${MODE_ICON[state.mode] || "🏥"} ${cue.speech}`, location: { lat: +state.point[1].toFixed(5), lon: +state.point[0].toFixed(5), accuracy_m: 5 } });
  }, [cue.key, cue.speech, muted, onProgress, state.mode, state.point]);

  // Monitoring: if the journey will now be late, ask the agent once per route.
  useEffect(() => {
    if (running && !busy && status.level === "late" && lateChecked.current !== route.id && !state.arrived) {
      lateChecked.current = route.id;
      replanRef.current?.("running_late");
    }
  }, [running, busy, status.level, route.id, state.arrived]);

  async function replan(problem) {
    if (busy || state.arrived) return;
    setPlaying(false); setBusy(true); setError(""); setDecision(null);
    stopSpeaking();
    try {
      const body = {
        request, option_id: route.custom ? best.id : route.id, legs: route.custom ? route.legs : null,
        // Moving on a leg counts as started (e.g. already on the bus), even a moment after boarding.
        leg_index: Math.max(0, state.legIndex), leg_progress: state.kind === "move" ? Math.min(1, Math.max(0.01, +(state.legProgress || 0).toFixed(3))) : 0,
        position: { lat: state.point[1], lon: state.point[0] }, now: new Date(simNow).toISOString(),
        problem, delay_minutes: 20, disruptions, use_model: request.use_model !== false,
      };
      const result = await api("/api/v1/agent/guide/replan", { method: "POST", body: JSON.stringify(body) });
      const blocked = result.disruptions_applied.filter(d => d.type === "pavement_blocked");
      const blockedPoints = blocked.flatMap(d => route.legs.filter(leg => leg.mode === "roll" && leg.geometry
        && (leg.instruction || "").toLowerCase().includes(d.target.split("-")[0])).map(leg => leg.geometry.coordinates.at(-2) || leg.geometry.coordinates[0]));
      setProblems(previous => [...previous, ...blockedPoints.map(point => ({ icon: "🚧", point })),
        ...(problem === "bus_delayed" ? [{ icon: "⏱", point: state.point }] : [])]);
      setDisruptions(result.disruptions_applied);
      const goalPoint = result.entrance?.coordinate || goal;
      const timeline = buildTimeline(result.legs, { start: simNow, origin: state.point, goal: goalPoint,
        padUntil: Date.parse(result.eta), trimFirst: result.action_kind !== "taxi_from_here" });
      setRoute({ id: result.action_id, legs: result.legs, timeline, custom: true,
        entrance: result.entrance?.name ? `the ${result.entrance.name}` : route.entrance });
      setDecision(result);
      lateChecked.current = result.action_id; // the agent already weighed lateness for this route
      spoken.current = "";
      if (!muted) speak(result.say).catch(() => {});
    } catch (failure) {
      setError(failure.message || "Could not re-plan");
      if (!muted) speak("I couldn't make a new plan. If you need help, press the Help button.").catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    replanRef.current = replan;
    if (stuckRef) stuckRef.current = () => replan("stuck");
    return () => { if (stuckRef) stuckRef.current = null; };
  });

  function restart() {
    stopSpeaking(); spoken.current = ""; lateChecked.current = "";
    setRoute({ id: best.id, legs: baseLegs, timeline: initial, custom: false, entrance: entranceName });
    setSimNow(initial.start); setDecision(null); setProblems([]); setDisruptions([]); setError(""); setPlaying(false);
    setRun(n => n + 1);
  }

  const strip = route.legs.map((leg, index) => ({
    icon: MODE_ICON[leg.mode] || "♿", line: leg.line,
    state: state.arrived || index < state.legIndex ? "done" : index === state.legIndex ? "now" : "next",
  }));

  return (
    <section className="lg" aria-label="Live guidance">
      <div className="lg-map">
        <GuidanceMap key={run} timeline={route.timeline} position={state.point} problems={problems} />
        <div className={`lg-chip lg-${status.level}`} aria-label={`Arriving ${clock(route.timeline.end)}, ${status.spare >= 0 ? `${status.spare} minutes early` : `${-status.spare} minutes late`}`}>
          <IconClock size={22} aria-hidden="true" /><b>{clock(route.timeline.end)}</b>
          <span>{status.spare >= 0 ? `+${status.spare}` : status.spare}</span>
        </div>
        <div className="lg-now" aria-label={`Time now ${clock(simNow)}`}>{clock(simNow)}</div>
        {shaped?.source === "straight" && <div className="lg-approx" role="img" aria-label="Approximate route: straight lines between stops, no road data" title="Approximate route (no road data)">≈</div>}
        <div className="lg-tools">
          <button type="button" onClick={() => { setMuted(m => !m); stopSpeaking(); }} aria-label={muted ? "Turn voice on" : "Turn voice off"} title={muted ? "Voice on" : "Voice off"}>
            {muted ? <IconVolumeOff size={26} /> : <IconVolume size={26} />}
          </button>
          <button type="button" onClick={() => speak(decision && !playing ? decision.say : cue.speech).catch(() => {})} aria-label="Repeat the instruction" title="Repeat"><IconRepeat size={26} /></button>
          <button type="button" onClick={() => { stopSpeaking(); onClose(); }} aria-label="Close live guidance" title="Close"><IconX size={26} /></button>
        </div>
      </div>

      <div className={`lg-cue lg-tone-${cue.tone}`} aria-live="polite" aria-label={cue.speech}>
        <span className="lg-cue-icon" aria-hidden="true">{cue.icon}{cue.badge && <b>{cue.badge}</b>}</span>
        <span className="lg-cue-value" aria-hidden="true">{cue.value}</span>
      </div>

      <ol className="lg-strip" aria-label="Journey steps">
        {strip.map((item, index) => <li key={index} className={`is-${item.state}`} aria-label={`${item.icon} ${item.line || ""} ${item.state}`}>
          <span aria-hidden="true">{item.state === "done" ? "✓" : item.icon}{item.line && item.state !== "done" ? <b>{item.line}</b> : null}</span>
        </li>)}
        <li className={state.arrived ? "is-now" : "is-next"} aria-label="Hospital"><span aria-hidden="true">🏥</span></li>
      </ol>

      {busy && <div className="lg-agent" role="status" aria-label="The agent is making a new plan"><span className="lg-spin" aria-hidden="true">🤖</span><span aria-hidden="true">…</span></div>}
      {error && <div className="lg-agent lg-agent-error" role="alert" aria-label={error}><span aria-hidden="true">⚠️</span><button type="button" className="lg-round" onClick={() => { setError(""); setPlaying(true); }} aria-label="Carry on">▶</button></div>}
      {decision && !busy && <div className="lg-agent" role="status" aria-label={decision.say}>
        <span className="lg-agent-icon" aria-hidden="true">{ACTION_ICON[decision.action_kind]}{decision.action_kind === "alternative_entrance" ? "🏥" : ""}</span>
        <span className="lg-agent-time" aria-hidden="true"><IconClock size={20} /> {clock(Date.parse(decision.eta))}</span>
        {decision.notify_hospital && <span className="lg-agent-flag" aria-hidden="true" title="Tell the hospital">📞🏥</span>}
        <span className="lg-agent-by" aria-hidden="true" title={decision.decided_by === "model" ? "Decided by Nemotron on the DGX Spark" : "Decided by safety rules"}>{decision.decided_by === "model" ? "🤖" : "🛡️"}</span>
        <button type="button" className="lg-round lg-ok" onClick={() => { setDecision(null); setPlaying(true); }} aria-label="OK, continue">✓</button>
      </div>}

      <div className="lg-controls">
        <button type="button" className="lg-play" onClick={() => setPlaying(p => !p)} disabled={busy || state.arrived} aria-label={running ? "Pause" : "Start"}>
          {running ? <IconPlayerPause size={34} /> : <IconPlayerPlay size={34} />}
        </button>
        <div className="lg-speed" role="group" aria-label="Demo speed">
          {SPEEDS.map(value => <button type="button" key={value} aria-pressed={speed === value} onClick={() => setSpeed(value)}>×{value}</button>)}
        </div>
        <button type="button" className="lg-round" onClick={restart} aria-label="Restart the journey" title="Restart"><IconRefresh size={24} /></button>
        <span className="lg-sep" aria-hidden="true" />
        <button type="button" className="lg-problem" onClick={() => replan("pavement_blocked_ahead")} disabled={busy || state.arrived} aria-label="Demo: pavement blocked ahead" title="Demo: pavement blocked ahead">
          <IconRoadOff size={28} />
        </button>
        <button type="button" className="lg-problem" onClick={() => replan("bus_delayed")} disabled={busy || state.arrived || !route.legs.some((leg, i) => i >= state.legIndex && (leg.mode === "bus" || leg.mode === "tram"))} aria-label="Demo: bus running 20 minutes late" title="Demo: bus 20 min late">
          <IconBus size={24} /><IconClock size={18} />
        </button>
      </div>
    </section>
  );
}
