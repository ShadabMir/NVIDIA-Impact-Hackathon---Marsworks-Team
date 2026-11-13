// Calls to the Royal Hallamshire agent endpoints (/api/v1/agent/*).
import { londonArrival } from "../api.js";
export const API_BASE = import.meta.env.VITE_API_BASE_URL || "/backend";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(body.detail)
      ? body.detail.map((d) => `${d.loc?.slice(1).join(".")}: ${d.msg}`).join("; ")
      : body.detail;
    const error = new Error(detail || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return body;
}

export const getContext = () => request("/api/v1/agent/context");
export const getProfile = () => request("/api/v1/profile");
export const getWorkspace = () => request("/api/v1/workspace");
export const saveWorkspace = body => request("/api/v1/workspace", { method: "PATCH", body: JSON.stringify(body) });
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

// Interpret the appointment in hospital time, regardless of the phone's timezone.
export const toIso = londonArrival;
