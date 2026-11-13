// Calls to the Royal Hallamshire agent endpoints (/api/v1/agent/*).
export const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(body.detail)
      ? body.detail.map((d) => `${d.loc?.slice(1).join(".")}: ${d.msg}`).join("; ")
      : body.detail;
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return body;
}

export const getContext = () => request("/api/v1/agent/context");
export const getModelHealth = () => request("/api/v1/agent/health");
export const warmUpModel = () => request("/api/v1/agent/warmup", { method: "POST" });
export const planJourney = (req) =>
  request("/api/v1/agent/plan", { method: "POST", body: JSON.stringify(req) });
export const reassessJourney = (req, disruptions, earliest_departure) =>
  request("/api/v1/agent/reassess", {
    method: "POST",
    body: JSON.stringify({ request: req, disruptions, earliest_departure }),
  });
export const draftMessage = (body) =>
  request("/api/v1/agent/draft", { method: "POST", body: JSON.stringify(body) });

export const toLondonTime = (iso) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });

// Build an ISO timestamp from a local date + time in the user's browser time zone.
export const toIso = (date, time) => new Date(`${date}T${time}:00`).toISOString();
