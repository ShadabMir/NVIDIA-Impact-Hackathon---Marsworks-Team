// Shared display of an agent plan: recommendation, local-compute stats, disruptions,
// drafts, every route checked and the agent trace. Used by the journey screen (AccessRouteApp.jsx).
import { useState } from "react";
import { toLondonTime } from "./api.js";
import { speak, stopSpeaking } from "../tts/speak.js";

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

export function Results({ plan, scenarios, active, onToggle, onReassess, onDraft, busy, draft, setDraft }) {
  const rec = plan.recommendation;
  const best = plan.options.find((o) => o.id === rec.option_id);
  return (
    <div className="d-flex flex-column gap-3">
      <div className={`card shadow-sm border-3 ${best ? "border-success" : "border-danger"}`}>
        <div className="card-body">
          <div className="d-flex flex-wrap gap-2 mb-2">
            <span className={`badge ${best ? "text-bg-success" : "text-bg-danger"}`}>{best ? "RECOMMENDED" : plan.options.length === 0 ? "I DON'T KNOW: NO ROUTE DATA" : "NO SAFE ROUTE"}</span>
            <span className="badge text-bg-light border">
              {plan.agent_mode === "model_directed" ? `Agent: ${plan.model} on DGX Spark` :
                plan.agent_mode === "model_unavailable_fallback" ? "AI unreachable – safety rules only" : "Safety rules only"}
            </span>
            <span className="badge text-bg-light border">Explanation by {rec.generated_by === "model" ? "local AI" : "rules"}</span>
          </div>
          <h2 className="h4 fw-bold">{rec.summary}</h2>
          <ReadAloud plan={plan} best={best} />
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
          <ComputeStats plan={plan} />
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
        <summary className="card-body fw-bold">
          What the agent did ({plan.agent_steps.length} steps:{" "}
          {plan.agent_steps.filter((s) => s.actor === "model").length} chosen by Nemotron,{" "}
          {plan.agent_steps.filter((s) => s.actor === "safety_net").length} added by the safety net)
        </summary>
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

// Reads the plan aloud: Dexi's speech model on the Spark if configured, else the browser's voice.
function ReadAloud({ plan, best }) {
  const [state, setState] = useState("");
  const rec = plan.recommendation;
  const text = [
    rec.summary,
    best ? `Leave at ${toLondonTime(best.leave_at)}. Arrive at the ${plan.entrance.name} by ${toLondonTime(plan.arrive_by)}.` : "",
    ...rec.tips,
  ].filter(Boolean).join(" ");
  const onClick = async () => {
    if (state === "speaking") { stopSpeaking(); setState(""); return; }
    setState("speaking");
    const source = await speak(text);
    setState(source === "none" ? "Speech is not available in this browser." : "speaking");
  };
  return (
    <div className="mb-2">
      <button type="button" className="btn btn-outline-primary btn-sm" onClick={onClick} aria-pressed={state === "speaking"}>
        <span aria-hidden="true">🔊 </span>{state === "speaking" ? "Stop reading" : "Read aloud"}
      </button>
      {state && state !== "speaking" && <span className="small ms-2">{state}</span>}
    </div>
  );
}

function ComputeStats({ plan }) {
  const st = plan.model_stats;
  if (!st) {
    return (
      <p className="small text-muted mt-3 mb-0">
        Planned by safety rules only in {plan.elapsed_seconds}s (local AI not used).
      </p>
    );
  }
  const items = [
    ["Model", st.model],
    ["Model calls", st.calls],
    ["Tokens", `${st.prompt_tokens.toLocaleString()} in / ${st.output_tokens.toLocaleString()} out`],
    ["Speed", st.tokens_per_second ? `${st.tokens_per_second} tokens/s` : "–"],
    ["Model time", `${st.model_seconds}s`],
    ["Total", `${plan.elapsed_seconds}s`],
  ];
  if (st.load_seconds > 0.5) items.push(["Model load", `${st.load_seconds}s`]);
  return (
    <div className="compute-stats mt-3" aria-label="Local compute on the DGX Spark">
      <div className="small fw-bold mb-1">Running locally on NVIDIA DGX Spark: no data left the building</div>
      <dl className="d-flex flex-wrap gap-3 mb-0 small">
        {items.map(([k, v]) => (
          <div key={k}>
            <dt className="fw-normal text-muted">{k}</dt>
            <dd className="fw-bold mb-0">{v}</dd>
          </div>
        ))}
      </dl>
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
