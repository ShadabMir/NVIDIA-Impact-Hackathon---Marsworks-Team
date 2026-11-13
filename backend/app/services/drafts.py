"""Reviewable drafts: blocked-pavement report, hospital transport request, operator feedback.

Nothing is ever sent. The local model may polish the wording; a template is always available.
"""
from pydantic import BaseModel, ValidationError

from app.agent_schemas import AgentDraftRequest, AgentDraftResponse, AgentPlanResponse
from app.config import Settings
from app.services import sheffield as sh
from app.services.llm import ModelUnavailable, chat

RECIPIENTS = {
    "blocked_pavement_report": (
        "Sheffield City Council — Highways (report a pavement or road problem)",
        "Use 'Report a problem with a road or pavement' on sheffield.gov.uk, or call the council. Attach a photo if safe to take one.",
    ),
    "hospital_transport_request": (
        "Royal Hallamshire Hospital — the clinic on your appointment letter / Patient Transport Service",
        "Phone or email the number on your appointment letter. Ask about NHS Patient Transport eligibility and help with travel costs.",
    ),
    "operator_feedback": (
        "Travel South Yorkshire customer services",
        "Use the feedback form on travelsouthyorkshire.com or contact the operator named on your ticket.",
    ),
}


class DraftText(BaseModel):
    subject: str
    body: str


def barrier_lines(plan: AgentPlanResponse) -> list[str]:
    seen, lines = set(), []
    for option in plan.options:
        for b in option.barriers:
            if b.severity != "info" and b.message not in seen:
                seen.add(b.message)
                lines.append(b.message)
    return lines[:8]


def template(req: AgentDraftRequest, plan: AgentPlanResponse) -> tuple[str, str]:
    appt = req.request.appointment
    when = appt.arrive_by.astimezone(sh.LONDON)
    aid = req.request.needs.mobility_aid.replace("_", " ")
    barriers = "\n".join(f"- {line}" for line in barrier_lines(plan)) or \
        "- No checked step-free public transport route is available from where I live."
    if req.kind == "blocked_pavement_report":
        location = req.location or next((d.description for d in plan.disruptions_applied if d.type == "pavement_blocked"),
                                        "[describe the exact location]")
        return ("Blocked pavement preventing wheelchair access", (
            "Hello,\n\nI would like to report a pavement obstruction.\n\n"
            f"Location: {location}\n"
            f"Date/time seen: {when:%A %d %B %Y}, around {when:%H:%M}\n"
            f"Impact: I use a {aid}. The obstruction leaves no step-free way past (no dropped kerbs nearby), "
            "so I had to find another route to my hospital appointment.\n"
            + (f"Details: {req.details}\n" if req.details else "") +
            "\nPlease could you inspect this and make sure a safe, step-free route is kept open, "
            "with dropped kerbs at any diversion.\n\nThank you,\n[Your name and contact details]"))
    if req.kind == "hospital_transport_request":
        return (f"Travel support needed for my appointment on {when:%d %B}", (
            "Hello,\n\n"
            f"I have an appointment at the Royal Hallamshire Hospital ({appt.department}) on "
            f"{when:%A %d %B %Y}; I need to arrive by {when:%H:%M}.\n"
            f"I use a {aid}. I have checked the accessible public transport routes and found these barriers:\n"
            f"{barriers}\n\n"
            "Could you please advise whether I am eligible for NHS Patient Transport, help with taxi costs, "
            "or whether the appointment could be moved to a time or format (e.g. phone/video) that I can reach?\n"
            + (f"\nMore details: {req.details}\n" if req.details else "") +
            "\nThank you,\n[Your name, date of birth / hospital number from your letter, and phone number]"))
    disrupted = [d for d in plan.disruptions_applied if d.type in {"bus_cancelled", "tram_cancelled", "bus_delayed", "tram_delayed", "event_crowding"}]
    lines = "\n".join(f"- {d.type.replace('_', ' ')}: {d.target}. {d.description}" for d in disrupted) or "- [describe the service problem]"
    return ("Accessibility impact of service disruption", (
        "Hello,\n\n"
        f"I am a {aid} user travelling to a hospital appointment at the Royal Hallamshire on {when:%d %B %Y}. "
        "These service problems affected my journey:\n"
        f"{lines}\n\n"
        "When services are cancelled or crowded, wheelchair spaces are the first thing lost. Please could you tell me how "
        "disabled passengers are informed of disruption, and what alternatives are offered?\n"
        + (f"\nMore details: {req.details}\n" if req.details else "") +
        "\nThank you,\n[Your name and contact details]"))


async def draft(req: AgentDraftRequest, plan: AgentPlanResponse, settings: Settings) -> AgentDraftResponse:
    recipient, how = RECIPIENTS[req.kind]
    subject, body = template(req, plan)
    method = "template"
    if req.use_model and settings.ollama_agent_model:
        messages = [
            {"role": "system", "content": "Improve this draft message for a disabled person. Keep every fact, placeholder in "
                "[brackets] and request. Plain, polite British English, under 220 words. Do not add facts. Return JSON with subject and body."},
            {"role": "user", "content": f"Subject: {subject}\n\n{body}"},
        ]
        try:
            msg = await chat(settings, messages, fmt=DraftText.model_json_schema(), num_predict=600)
            improved = DraftText.model_validate_json(msg.get("content", ""))
            if improved.body.strip() and "[" in improved.body:
                subject, body, method = improved.subject[:150], improved.body[:3000], "model"
        except (ModelUnavailable, ValidationError):
            pass
    body = "DRAFT — please check before sending. Nothing has been sent.\n\n" + body
    return AgentDraftResponse(kind=req.kind, recipient=recipient, how_to_send=how, subject=subject,
                              body=body, generated_by=method)
