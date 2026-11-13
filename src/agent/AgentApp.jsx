import { useEffect, useState } from "react";
import {
  draftMessage,
  getContext,
  getModelHealth,
  planJourney,
  reassessJourney,
  toIso,
  toLondonTime,
} from "./api.js";

const AIDS = [
  ["powered_wheelchair", "Powered wheelchair"],
  ["manual_wheelchair", "Manual wheelchair"],
  ["mobility_scooter", "Mobility scooter"],
  ["walking_aid", "Walking aid / rollator"],
  ["none", "No mobility aid"],
];

const STATUS = {
  suitable: { label: "Suitable", cls: "text-bg-success", icon: "✔" },
  caution: { label: "Use with care", cls: "text-bg-warning", icon: "!" },
  unsuitable: { label: "Not suitable", cls: "text-bg-danger", icon: "✖" },
};
const SEVERITY = {
  blocking: { cls: "barrier-blocking", icon: "✖", label: "Blocks this route" },
  warning: { cls: "barrier-warning", icon: "!", label: "Warning" },
  info: { cls: "barrier-info", icon: "i", label: "Note" },
};
const ACTOR = {
  model: ["text-bg-primary", "Nemotron chose"],
  safety_net: ["text-bg-warning", "Safety net"],
  rules: ["text-bg-secondary", "Rules"],
};
const MODE_ICON = { roll: "♿", bus: "🚌", tram: "🚊", taxi: "🚕" };

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
};

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
      step_free_required: true,
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

  useEffect(() => {
    getContext().then(setCtx).catch((e) => setApiError(e.message));
    getModelHealth().then(() => setModelOk(true)).catch(() => setModelOk(false));
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
          </div>
        </div>
      </header>

      <main id="main" className="agent-wrap px-3 pb-5">
        <p className="small"><a href="/">← Appointment upload, profile, settings and live map</a> · This Royal Hallamshire example has separate demo preferences.</p>
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
                <p className="small text-muted">Pre-filled for Margaret, 67, a powered wheelchair user in Walkley.</p>

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
                <Check id="cp" label="I need a Changing Places toilet" checked={form.needs_changing_places} onChange={set("needs_changing_places")} />
                <Check id="crowd" label="Avoid crowds if possible" checked={form.avoid_crowds} onChange={set("avoid_crowds")} />
                <Check id="taxi" label="A taxi is an option for me" checked={form.can_use_taxi} onChange={set("can_use_taxi")} />
                <Field label="Anything else (stays on the local AI)" id="notes">
                  <input id="notes" className="form-control" maxLength={300} value={form.condition_notes} onChange={set("condition_notes")} />
                </Field>
                <Check id="ai" label="Use the local AI agent (Nemotron on DGX Spark)" checked={form.use_model} onChange={set("use_model")} />

                <button type="submit" className="btn btn-primary btn-lg w-100 mt-2" disabled={!!busy}>
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

function Results({ plan, scenarios, active, onToggle, onReassess, onDraft, busy, draft, setDraft }) {
  const rec = plan.recommendation;
  const best = plan.options.find((o) => o.id === rec.option_id);
  return (
    <div className="d-flex flex-column gap-3">
      <div className={`card shadow-sm border-3 ${best ? "border-success" : "border-danger"}`}>
        <div className="card-body">
          <div className="d-flex flex-wrap gap-2 mb-2">
            <span className={`badge ${best ? "text-bg-success" : "text-bg-danger"}`}>{best ? "RECOMMENDED" : "NO SAFE ROUTE"}</span>
            <span className="badge text-bg-light border">
              {plan.agent_mode === "model_directed" ? `Agent: ${plan.model} on DGX Spark` :
                plan.agent_mode === "model_unavailable_fallback" ? "AI unreachable – safety rules only" : "Safety rules only"}
            </span>
            <span className="badge text-bg-light border">Explanation by {rec.generated_by === "model" ? "local AI" : "rules"}</span>
          </div>
          <h2 className="h4 fw-bold">{rec.summary}</h2>
          {best && (
            <p className="mb-2">
              Leave <strong>{toLondonTime(best.leave_at)}</strong>, arrive at the <strong>{plan.entrance.name}</strong> by{" "}
              <strong>{toLondonTime(plan.arrive_by)}</strong>.
            </p>
          )}
          {rec.reasons.length > 0 && <ul className="mb-2">{rec.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
          {rec.tips.length > 0 && (
            <>
              <h3 className="h6 fw-bold mb-1">Tips</h3>
              <ul className="mb-0">{rec.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </>
          )}
        </div>
      </div>

      {plan.support_needed && (
        <div className="alert alert-warning" role="alert">
          <strong>No public transport route fully meets your needs right now.</strong> You can ask the hospital about
          transport support below. Nothing is sent without you.
        </div>
      )}

      <div className="row g-3">
        <div className="col-md-6">
          <div className="card shadow-sm h-100"><div className="card-body">
            <h3 className="h6 fw-bold">Weather at the hospital</h3>
            <p className="mb-1">{plan.weather.summary}</p>
            <span className="small text-muted">Source: {plan.weather.source}</span>
          </div></div>
        </div>
        <div className="col-md-6">
          <div className="card shadow-sm h-100"><div className="card-body">
            <h3 className="h6 fw-bold">Accessible toilets</h3>
            {plan.toilets.length ? (
              <ul className="small mb-0">
                {plan.toilets.map((t) => (
                  <li key={t.id}>{t.name}{t.radar_key ? " (RADAR key)" : ""}{t.verified ? "" : " – unverified"}</li>
                ))}
              </ul>
            ) : <p className="small mb-0">None found on these routes.</p>}
          </div></div>
        </div>
      </div>

      <div className="card shadow-sm"><div className="card-body">
        <h3 className="h5 fw-bold">Simulate something going wrong on the day</h3>
        <p className="small text-muted">Pick one or more problems, then ask the agent to re-plan.</p>
        <div className="d-flex flex-wrap gap-2 mb-3" role="group" aria-label="Disruptions">
          {scenarios.map((s) => (
            <button key={s.id} type="button" aria-pressed={active.includes(s.id)}
              className={`btn ${active.includes(s.id) ? "btn-danger" : "btn-outline-danger"}`}
              onClick={() => onToggle(s.id)}>
              {active.includes(s.id) ? "✔ " : ""}{s.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-danger btn-lg" onClick={onReassess} disabled={!!busy}>
          {busy === "reassess" ? "Re-planning…" : "Re-plan with these problems"}
        </button>
        {plan.disruptions_applied.length > 0 && (
          <ul className="small mt-3 mb-0">
            {plan.disruptions_applied.map((d, i) => <li key={i}><strong>{d.type.replaceAll("_", " ")}</strong>: {d.description || d.target}</li>)}
          </ul>
        )}
      </div></div>

      {plan.suggested_actions.length > 0 && (
        <div className="card shadow-sm border-primary"><div className="card-body">
          <h3 className="h5 fw-bold">The agent suggests</h3>
          <div className="d-flex flex-wrap gap-2">
            {plan.suggested_actions.map((a) => (
              <button key={a.kind} type="button" className="btn btn-primary" onClick={() => onDraft(a.kind)} disabled={!!busy}>
                {a.label}
              </button>
            ))}
          </div>
          {draft && <Draft draft={draft} setDraft={setDraft} />}
        </div></div>
      )}

      <h3 className="h5 fw-bold mb-0">All routes checked</h3>
      {plan.options.map((o) => <OptionCard key={o.id} option={o} recommended={o.id === rec.option_id} />)}

      <details className="card shadow-sm">
        <summary className="card-body fw-bold">What the agent did ({plan.agent_steps.length} steps)</summary>
        <ol className="small px-4 pb-3 mb-0">
          {plan.agent_steps.map((s) => (
            <li key={s.step} className="mb-2">
              <span className={`badge ${ACTOR[s.actor][0]} me-1`}>{ACTOR[s.actor][1]}</span>
              <code>{s.tool}({Object.keys(s.arguments).length ? JSON.stringify(s.arguments) : ""})</code>
              <div className="text-muted text-break">{s.result_summary}</div>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function OptionCard({ option, recommended }) {
  const st = STATUS[option.status];
  return (
    <article className={`card shadow-sm ${recommended ? "border-success border-2" : ""}`} aria-label={option.title}>
      <div className="card-body">
        <div className="d-flex flex-wrap justify-content-between gap-2 mb-2">
          <h4 className="h6 fw-bold mb-0">{option.title}</h4>
          <span className={`badge ${st.cls}`}><span aria-hidden="true">{st.icon} </span>{st.label}</span>
        </div>
        <p className="small mb-2">
          Leave {toLondonTime(option.leave_at)} · about {option.total_minutes} min door to door
          {option.cost_note ? ` · ${option.cost_note}` : ""}
        </p>
        <ol className="list-unstyled small mb-2">
          {option.legs.map((l, i) => (
            <li key={i} className="mb-1">
              <span aria-hidden="true">{MODE_ICON[l.mode]} </span>{l.instruction}
              {l.max_gradient_pct != null && <span className="text-muted"> (steepest {l.max_gradient_pct}%)</span>}
            </li>
          ))}
        </ol>
        {option.barriers.length > 0 && (
          <ul className="list-unstyled mb-0">
            {option.barriers.map((b, i) => {
              const sv = SEVERITY[b.severity];
              return (
                <li key={i} className={`barrier ${sv.cls}`}>
                  <span className="visually-hidden">{sv.label}: </span>
                  <span aria-hidden="true" className="barrier-icon">{sv.icon}</span>
                  {b.message}{b.mitigation ? <em> {b.mitigation}</em> : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </article>
  );
}

function Draft({ draft, setDraft }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
    setCopied(true);
  };
  return (
    <div className="mt-3 p-3 bg-light border rounded-3">
      <p className="small mb-1"><strong>To:</strong> {draft.recipient}</p>
      <p className="small mb-2"><strong>How to send:</strong> {draft.how_to_send}</p>
      <label htmlFor="draft-subject" className="form-label fw-semibold mb-1">Subject</label>
      <input id="draft-subject" className="form-control mb-2" value={draft.subject}
        onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
      <label htmlFor="draft-body" className="form-label fw-semibold mb-1">Message (edit before sending)</label>
      <textarea id="draft-body" className="form-control mb-2" rows={12} value={draft.body}
        onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
      <div className="d-flex flex-wrap gap-2 align-items-center">
        <button type="button" className="btn btn-outline-primary" onClick={copy}>{copied ? "Copied" : "Copy message"}</button>
        <span className="small text-muted">
          Written by {draft.generated_by === "model" ? "the local AI" : "template"}. Not sent — you stay in control.
        </span>
      </div>
    </div>
  );
}
