"""Evaluate the AccessRoute agent on inputs where we know the right answer.

Runs each case through the real agent (Nemotron on the DGX Spark via your SSH tunnel)
and checks the result. Includes an ambiguous input and two "I don't know" cases, as the
organisers asked.

Run from the backend folder, with the tunnel open and backend/.env set:

    python -m eval.run_eval                     # uses OLLAMA_AGENT_MODEL from .env
    python -m eval.run_eval --model nemotron-3.5-lightning:30b
    python -m eval.run_eval --rules-only        # no model, safety rules only

Writes a Markdown table to eval/results.md for the README, demo video and submission.
"""
import argparse
import asyncio
import sys
import time
from datetime import datetime
from pathlib import Path

from app.agent_schemas import AgentPlanRequest
from app.config import Settings
from app.services import agent
from app.services.llm import ModelUnavailable, warmup

MARGARET = {
    "origin_id": "walkley",
    "appointment": {
        "department": "Neuro-Rehabilitation Outpatients",
        "arrive_by": "2026-11-16T10:15:00+00:00",
        "confirmed_by_user": True,
    },
    "needs": {"mobility_aid": "powered_wheelchair", "needs_accessible_toilet": True},
}


def case(name, kind, question, expect, **changes):
    req = {**MARGARET, **{k: v for k, v in changes.items() if k in ("origin_id", "disruptions", "needs")}}
    if "department" in changes or "arrive_by" in changes:
        req["appointment"] = {**MARGARET["appointment"],
                              **{k: changes[k] for k in ("department", "arrive_by") if k in changes}}
    return {"name": name, "kind": kind, "question": question, "request": req, "expect": expect}


CASES = [
    case("normal-day", "known answer",
         "Margaret (powered wheelchair, Walkley) on a normal Monday",
         {"option_id": "walkley-bus-95", "support_needed": False}),
    case("pavement-blocked", "known answer",
         "Beech Hill Road pavement blocked by works and parked cars",
         {"option_id": "walkley-taxi", "support_needed": True,
          "actions": ["blocked_pavement_report", "hospital_transport_request"]},
         disruptions=[{"type": "pavement_blocked", "target": "beech-hill-road",
                       "description": "Footway blocked; no dropped-kerb bypass."}]),
    case("trams-suspended", "known answer",
         "From Hillsborough while Blue and Yellow trams are suspended",
         {"option_id": "hillsborough-bus-52"}, origin_id="hillsborough",
         disruptions=[{"type": "tram_cancelled", "target": "Blue"}, {"type": "tram_cancelled", "target": "Yellow"}]),
    case("icy-hills", "known answer",
         "Ice warning: avoid slopes, go door to door",
         {"option_id": "walkley-taxi"},
         disruptions=[{"type": "severe_weather", "target": "ice", "description": "Ice on untreated pavements."}]),
    case("manual-wheelchair", "known answer",
         "Manual wheelchair user (5% slope limit) from the city centre",
         {"option_id": "city-bus-120"}, origin_id="city-centre",
         needs={"mobility_aid": "manual_wheelchair"}),
    case("unclear-department", "ambiguous",
         "Letter only says 'Follow-up appointment', with no clinic or floor",
         {"option_id": "walkley-bus-95", "entrance_matched": False, "tips_contain": "Not sure which entrance"},
         department="Follow-up appointment"),
    case("no-route-data", "I don't know",
         "Start point with no checked route data (Rotherham)",
         {"option_id": None, "summary_contains": "don't know", "support_needed": True},
         origin_id="rotherham"),
    case("weather-too-far-ahead", "I don't know",
         "Appointment 7 weeks away: no forecast exists yet",
         {"weather_source": "unavailable", "no_weather_claims": True},
         arrive_by="2027-01-04T10:15:00+00:00"),
]


def check(plan, expect) -> list[str]:
    fails = []
    rec = plan.recommendation
    text = " ".join([rec.summary, *rec.reasons, *rec.tips])
    if "option_id" in expect and rec.option_id != expect["option_id"]:
        fails.append(f"chose {rec.option_id}, expected {expect['option_id']}")
    if "support_needed" in expect and plan.support_needed != expect["support_needed"]:
        fails.append(f"support_needed={plan.support_needed}")
    for kind in expect.get("actions", []):
        if kind not in {a["kind"] for a in plan.suggested_actions}:
            fails.append(f"missing action {kind}")
    if "entrance_matched" in expect and plan.entrance.get("matched") != expect["entrance_matched"]:
        fails.append("entrance ambiguity not flagged")
    if "tips_contain" in expect and expect["tips_contain"] not in text:
        fails.append(f"no '{expect['tips_contain']}' in advice")
    if "summary_contains" in expect and expect["summary_contains"] not in rec.summary:
        fails.append(f"summary lacks '{expect['summary_contains']}'")
    if "weather_source" in expect and plan.weather.source != expect["weather_source"]:
        fails.append(f"weather source {plan.weather.source}")
    if expect.get("no_weather_claims") and ("°C" in text or "°" in text):
        fails.append("advice mentions a temperature it cannot know")
    return fails


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", help="Override OLLAMA_AGENT_MODEL, e.g. nemotron-3.5-lightning:30b")
    parser.add_argument("--rules-only", action="store_true", help="Skip the model; safety rules only")
    parser.add_argument("--out", default=str(Path(__file__).with_name("results.md")))
    args = parser.parse_args()

    settings = Settings()
    if args.model:
        settings = settings.model_copy(update={"ollama_agent_model": args.model})
    use_model = not args.rules_only
    label = settings.ollama_agent_model if use_model else "rules only"
    print(f"AccessRoute evaluation: {len(CASES)} cases, model: {label}, server: {settings.ollama_base_url}\n")

    if use_model:
        try:
            w = await warmup(settings)
            print(f"Warm-up: model loaded in {w['load_seconds']:.1f} s (keep_alive={settings.ollama_keep_alive})\n")
        except ModelUnavailable as exc:
            print(f"Cannot reach the model: {exc}\nIs the SSH tunnel open and OLLAMA_BASE_URL right? "
                  "Or run with --rules-only.")
            return 2

    rows, passed = [], 0
    for c in CASES:
        req = AgentPlanRequest.model_validate({**c["request"], "use_model": use_model})
        t0 = time.perf_counter()
        plan = await agent.plan(req, settings)
        secs = time.perf_counter() - t0
        fails = check(plan, c["expect"])
        passed += not fails
        model_tools = sum(s.actor == "model" for s in plan.agent_steps)
        net_tools = sum(s.actor == "safety_net" for s in plan.agent_steps)
        st = plan.model_stats
        row = {
            "case": c["name"], "kind": c["kind"], "question": c["question"],
            "result": "PASS" if not fails else "FAIL: " + "; ".join(fails),
            "answer": plan.recommendation.summary,
            "mode": plan.agent_mode, "explained_by": plan.recommendation.generated_by,
            "tools": f"{model_tools} model / {net_tools} safety net",
            "secs": f"{secs:.1f}",
            "tokens": f"{st.prompt_tokens}+{st.output_tokens}" if st else "-",
            "tps": f"{st.tokens_per_second}" if st and st.tokens_per_second else "-",
        }
        rows.append(row)
        print(f"[{'PASS' if not fails else 'FAIL'}] {c['name']:<22} {secs:5.1f}s  {row['tools']:<24} {row['answer'][:70]}")
        for f in fails:
            print(f"        - {f}")

    print(f"\n{passed}/{len(CASES)} passed")
    write_markdown(Path(args.out), rows, passed, label, settings)
    print(f"Results table written to {args.out}")
    return 0 if passed == len(CASES) else 1


def write_markdown(path: Path, rows, passed, label, settings):
    esc = lambda s: str(s).replace("|", "\\|")
    lines = [
        "# AccessRoute agent evaluation",
        "",
        f"- Run: {datetime.now():%Y-%m-%d %H:%M}",
        f"- Model: `{label}` served locally by Ollama on the NVIDIA DGX Spark",
        f"- Result: **{passed}/{len(rows)} passed**",
        "- Tools = tool calls Nemotron chose itself / required checks the safety net added.",
        "- Tokens = prompt + output tokens across all model calls; tok/s = generation speed on the Spark.",
        "",
        "| Case | Type | Input | Result | Agent's answer | Mode | Tools | Time (s) | Tokens | tok/s |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in rows:
        lines.append("| " + " | ".join(esc(r[k]) for k in
                     ("case", "kind", "question", "result", "answer", "mode", "tools", "secs", "tokens", "tps")) + " |")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
