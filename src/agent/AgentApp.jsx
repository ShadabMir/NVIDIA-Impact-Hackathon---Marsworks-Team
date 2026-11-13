import { useEffect, useState } from "react";
import {
  draftMessage,
  getContext,
  getModelHealth,
  getProfile,
  getWorkspace,
  saveWorkspace,
  planJourney,
  reassessJourney,
  toIso,
  warmUpModel,
} from "./api.js";
import { Results } from "./AgentResults.jsx";
import { profileNeeds } from "./profileNeeds.js";

const AIDS = [
  ["powered_wheelchair", "Powered wheelchair"],
  ["manual_wheelchair", "Manual wheelchair"],
  ["mobility_scooter", "Mobility scooter"],
  ["walking_aid", "Walking aid / rollator"],
  ["none", "No mobility aid"],
];


const MARGARET = {
  origin_id: "walkley",
  department: "Neuro-Rehabilitation Outpatients",
  date: "2026-11-16",
  time: "10:15",
  earliest: "",
  mobility_aid: "powered_wheelchair",
  max_gradient_pct: "",
  max_continuous_roll_m: 300,
  max_total_roll_m: 800,
  extra_minutes: 15,
  needs_accessible_toilet: true,
  needs_changing_places: false,
  avoid_crowds: false,
  can_use_taxi: true,
  condition_notes: "Post-stroke; tires after about 10 minutes",
  use_model: true,
  step_free_required: true,
};

function londonFields(value) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const get = key => parts.find(part => part.type === key)?.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

function formFromRequest(request) {
  return { ...MARGARET, ...request.needs, ...londonFields(request.appointment.arrive_by),
    origin_id: request.origin_id, department: request.appointment.department,
    max_gradient_pct: request.needs.max_gradient_pct ?? "",
    condition_notes: request.needs.condition_notes || "",
    earliest: request.earliest_departure ? londonFields(request.earliest_departure).time : "",
    use_model: request.use_model,
  };
}


function buildRequest(f, disruptions) {
  return {
    origin_id: f.origin_id,
    appointment: {
      hospital_id: "royal-hallamshire",
      department: f.department,
      arrive_by: toIso(f.date, f.time),
      confirmed_by_user: true,
    },
    needs: {
      mobility_aid: f.mobility_aid,
      max_gradient_pct: f.max_gradient_pct === "" ? null : Number(f.max_gradient_pct),
      max_continuous_roll_m: Number(f.max_continuous_roll_m),
      max_total_roll_m: Number(f.max_total_roll_m),
      extra_minutes: Number(f.extra_minutes),
      step_free_required: f.step_free_required,
      needs_accessible_toilet: f.needs_accessible_toilet,
      needs_changing_places: f.needs_changing_places,
      avoid_crowds: f.avoid_crowds,
      can_use_taxi: f.can_use_taxi,
      condition_notes: f.condition_notes || null,
    },
    disruptions,
    earliest_departure: f.earliest ? toIso(f.date, f.earliest) : null,
    use_model: f.use_model,
  };
}

export default function AgentApp() {
  const [ctx, setCtx] = useState(null);
  const [apiError, setApiError] = useState("");
  const [modelOk, setModelOk] = useState(null);
  const [form, setForm] = useState(MARGARET);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [activeScenarios, setActiveScenarios] = useState([]);
  const [draft, setDraft] = useState(null);
  const [accountProfile, setAccountProfile] = useState(null);
  const [savedMessage, setSavedMessage] = useState("");
  const [restoring, setRestoring] = useState(true);
  const [warm, setWarm] = useState("");

  const onWarmUp = async () => {
    setWarm("Loading model on the Spark…");
    try {
      const w = await warmUpModel();
      setWarm(`${w.model} loaded (${w.load_seconds}s), kept for ${w.keep_alive}`);
      setModelOk(true);
    } catch (e) {
      setWarm(e.message);
    }
  };

  useEffect(() => {
    let active = true;
    getContext().then(setCtx).catch((e) => setApiError(e.message));
    getModelHealth().then(() => setModelOk(true)).catch(() => setModelOk(false));
    (async () => {
      try {
        const profile = await getProfile();
        if (!active) return;
        setAccountProfile(profile);
        const saved = await getWorkspace();
        if (!active) return;
        if (saved.agent_request) {
          setForm(formFromRequest(saved.agent_request));
          setSavedMessage("Loaded your saved agent form. Check the appointment and needs before planning.");
        } else {
          setForm(previous => ({ ...previous, ...profileNeeds(profile) }));
          setSavedMessage("Loaded your profile's distance, slope and step-free preferences. The Royal Hallamshire appointment is still a separate demo example.");
        }
      } catch (failure) {
        if (active && failure.status !== 401) setSavedMessage(`Could not load saved details: ${failure.message}`);
      } finally { if (active) setRestoring(false); }
    })();
    return () => { active = false; };
  }, []);

  const set = (key) => (e) =>
    setForm({ ...form, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const selectedDisruptions = () =>
    (ctx?.scenarios || [])
      .filter((s) => activeScenarios.includes(s.id))
      .flatMap((s) => s.disruptions);

  async function run(fn, label) {
    setBusy(label);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  const onPlan = async (e) => {
    e.preventDefault();
    setDraft(null);
    const result = await run(() => planJourney(buildRequest(form, [])), "plan");
    if (result) {
      setActiveScenarios([]);
      setPlan(result);
    }
  };

  const onReassess = async () => {
    setDraft(null);
    const result = await run(
      () => reassessJourney(buildRequest(form, []), selectedDisruptions()),
      "reassess",
    );
    if (result) setPlan(result);
  };

  const onDraft = async (kind) => {
    const location = selectedDisruptions().find((d) => d.type === "pavement_blocked")?.description;
    const result = await run(
      () =>
        draftMessage({
          kind,
          request: buildRequest(form, selectedDisruptions()),
          location: location || null,
          use_model: form.use_model,
        }),
      "draft",
    );
    if (result) setDraft(result);
  };

  const toggleScenario = (id) =>
    setActiveScenarios((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const saveForm = () => run(async () => {
    await saveWorkspace({ agent_request: buildRequest(form, []) });
    setSavedMessage("Agent form saved to your account, including access needs. Live results and disruption scenarios are not stored.");
  }, "save");

  const removeSavedForm = () => run(async () => {
    await saveWorkspace({ agent_request: null });
    setForm(accountProfile ? { ...MARGARET, ...profileNeeds(accountProfile) } : MARGARET);
    setPlan(null); setDraft(null); setActiveScenarios([]);
    setSavedMessage("Saved agent form removed.");
  }, "save");

  return (
    <div className="agent-app">
      <a className="visually-hidden-focusable" href="#main">Skip to main content</a>
      <header className="agent-header px-3 py-3 mb-3">
        <div className="agent-wrap d-flex flex-wrap justify-content-between align-items-center gap-2">
          <div>
            <h1 className="h4 fw-bold mb-0">AccessRoute Sheffield</h1>
            <div className="small">Accessible journeys to the Royal Hallamshire Hospital</div>
          </div>
          <div className="d-flex gap-2 flex-wrap" aria-live="polite">
            <span className={`badge ${apiError ? "text-bg-danger" : ctx ? "text-bg-success" : "text-bg-secondary"}`}>
              API: {apiError ? "offline" : ctx ? "online" : "checking"}
            </span>
            <span className={`badge ${modelOk ? "text-bg-success" : modelOk === false ? "text-bg-warning" : "text-bg-secondary"}`}>
              Local AI (DGX Spark): {modelOk ? "ready" : modelOk === false ? "not reachable – rules only" : "checking"}
            </span>
            <button type="button" className="btn btn-sm btn-light" onClick={onWarmUp}>Warm up AI</button>
            {warm && <span className="small">{warm}</span>}
          </div>
        </div>
      </header>

      <main id="main" className="agent-wrap px-3 pb-5">
        <p className="small"><a href="/">← Appointment upload, profile, settings and live map</a> · Sign in there to save and restore your forms here.</p>
        {savedMessage && <p className="alert alert-info" role="status">{savedMessage}</p>}
        {apiError && (
          <div className="alert alert-danger" role="alert">
            Cannot reach the backend: {apiError}. Is <code>uvicorn</code> running on port 8000?
          </div>
        )}
        {ctx && <p className="alert alert-secondary small">{ctx.notice}</p>}

        <div className="row g-3">
          <section className="col-lg-4" aria-labelledby="form-title">
            <form className="card shadow-sm" onSubmit={onPlan}>
              <div className="card-body">
                <h2 id="form-title" className="h5 fw-bold">Your appointment and needs</h2>
                <p className="small text-muted">{accountProfile ? `Signed in as ${accountProfile.first_name}. You can save these details to your account.` : "Guest demo for Margaret, a fictional wheelchair user in Walkley. Sign in on the main page to save details."}</p>
                {restoring && <p role="status">Checking for saved details…</p>}

                <Field label="Starting from" id="origin">
                  <select id="origin" className="form-select" value={form.origin_id} onChange={set("origin_id")}>
                    {(ctx?.origins || [{ id: "walkley", name: "Walkley" }]).map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Clinic / department" id="dept">
                  <input id="dept" className="form-control" value={form.department} onChange={set("department")} required />
                </Field>
                <div className="row g-2">
                  <div className="col-6">
                    <Field label="Date" id="date">
                      <input id="date" type="date" className="form-control" value={form.date} onChange={set("date")} required />
                    </Field>
                  </div>
                  <div className="col-6">
                    <Field label="Be at entrance by" id="time">
                      <input id="time" type="time" className="form-control" value={form.time} onChange={set("time")} required />
                    </Field>
                  </div>
                </div>
                <Field label="Earliest I can leave (optional)" id="earliest">
                  <input id="earliest" type="time" className="form-control" value={form.earliest} onChange={set("earliest")} />
                </Field>
                <Field label="Mobility aid" id="aid">
                  <select id="aid" className="form-select" value={form.mobility_aid} onChange={set("mobility_aid")}>
                    {AIDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Steepest slope I can manage, % (blank = typical for my aid)" id="grad">
                  <input id="grad" type="number" min="0" max="30" step="0.5" className="form-control"
                    value={form.max_gradient_pct} onChange={set("max_gradient_pct")} placeholder="e.g. 8 (about 1 in 12)" />
                </Field>
                <div className="row g-2">
                  <div className="col-6">
                    <Field label="Max metres without a rest" id="cont">
                      <input id="cont" type="number" min="0" className="form-control" value={form.max_continuous_roll_m} onChange={set("max_continuous_roll_m")} />
                    </Field>
                  </div>
                  <div className="col-6">
                    <Field label="Extra minutes (ramps, rests)" id="extra">
                      <input id="extra" type="number" min="0" max="120" className="form-control" value={form.extra_minutes} onChange={set("extra_minutes")} />
                    </Field>
                  </div>
                </div>
                <Check id="wc" label="I need an accessible toilet on the way" checked={form.needs_accessible_toilet} onChange={set("needs_accessible_toilet")} />
                <Check id="stepfree" label="I need a route without steps" checked={form.step_free_required} onChange={set("step_free_required")} />
                <Check id="cp" label="I need a Changing Places toilet" checked={form.needs_changing_places} onChange={set("needs_changing_places")} />
                <Check id="crowd" label="Avoid crowds if possible" checked={form.avoid_crowds} onChange={set("avoid_crowds")} />
                <Check id="taxi" label="A taxi is an option for me" checked={form.can_use_taxi} onChange={set("can_use_taxi")} />
                <Field label="Anything else (stays on the local AI)" id="notes">
                  <input id="notes" className="form-control" maxLength={300} value={form.condition_notes} onChange={set("condition_notes")} />
                </Field>
                <Check id="ai" label="Use the local AI agent (Nemotron on DGX Spark)" checked={form.use_model} onChange={set("use_model")} />

                {accountProfile && <div className="d-flex flex-wrap gap-2 my-3">
                  <button type="button" className="btn btn-outline-primary" disabled={!!busy || restoring} onClick={saveForm}>Save this form</button>
                  <button type="button" className="btn btn-outline-secondary" disabled={!!busy || restoring} onClick={() => {
                    setForm(previous => ({ ...previous, ...profileNeeds(accountProfile) })); setPlan(null); setDraft(null);
                    setSavedMessage("Profile preferences applied. The agent uses transfer plus boarding time as one extra-time allowance; check it for this journey.");
                  }}>Use profile preferences</button>
                  <button type="button" className="btn btn-outline-danger" disabled={!!busy || restoring} onClick={removeSavedForm}>Remove saved form</button>
                </div>}
                <button type="submit" className="btn btn-primary btn-lg w-100 mt-2" disabled={!!busy || restoring}>
                  {busy === "plan" ? "Agent is checking routes…" : "Plan my journey"}
                </button>
              </div>
            </form>
          </section>

          <section className="col-lg-8" aria-live="polite" aria-busy={!!busy}>
            {error && <div className="alert alert-danger" role="alert">{error}</div>}
            {busy && (
              <div className="alert alert-info" role="status">
                {busy === "draft" ? "Writing your draft…" : "The agent is checking the weather, roadworks, trams, buses, events and toilets…"}
              </div>
            )}
            {!plan && !busy && (
              <div className="card shadow-sm"><div className="card-body">
                <h2 className="h5">How it works</h2>
                <ol className="mb-0">
                  <li>The local AI agent decides what to check: weather, roadworks, trams and buses, events, toilets.</li>
                  <li>Safety rules check every route against your slope, distance and step-free needs. The AI can never override them.</li>
                  <li>You get a clear plan, and can re-plan if something changes on the day.</li>
                </ol>
              </div></div>
            )}
            {plan && (
              <Results
                plan={plan}
                scenarios={ctx?.scenarios || []}
                active={activeScenarios}
                onToggle={toggleScenario}
                onReassess={onReassess}
                onDraft={onDraft}
                busy={busy}
                draft={draft}
                setDraft={setDraft}
              />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function Field({ label, id, children }) {
  return (
    <div className="mb-2">
      <label htmlFor={id} className="form-label fw-semibold mb-1">{label}</label>
      {children}
    </div>
  );
}

function Check({ id, label, checked, onChange }) {
  return (
    <div className="form-check mb-2">
      <input className="form-check-input" type="checkbox" id={id} checked={checked} onChange={onChange} />
      <label className="form-check-label" htmlFor={id}>{label}</label>
    </div>
  );
}
