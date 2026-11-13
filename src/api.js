export const API = import.meta.env.VITE_API_BASE_URL || "/backend";

export async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const response = await fetch(`${API}${path}`, {
    credentials: "include",
    ...options,
    headers: { ...(!isForm && options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.detail === "string" ? data.detail
      : Array.isArray(data.detail) ? data.detail.map(item => `${item.loc?.slice(1).join(".")}: ${item.msg}`).join("; ")
      : `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

export const MOBILITY_OPTIONS = [
  ["manual_wheelchair", "I use a manual wheelchair"],
  ["powered_wheelchair", "I use a powered wheelchair"],
  ["walking_aid", "I use a stick or walking frame"],
  ["limited_mobility", "I walk, but need regular rests"],
  ["no_aid", "I do not use a mobility aid"],
];

export function presetFor(aid) {
  const distance = { manual_wheelchair: 150, powered_wheelchair: 150, walking_aid: 50, limited_mobility: 100, no_aid: 300 }[aid] ?? 100;
  const wheelchair = aid.includes("wheelchair");
  return {
    wheelchair_user: wheelchair, step_free_required: aid !== "no_aid",
    max_continuous_walking_m: distance, max_total_walking_m: distance * 2,
    min_transfer_minutes: 10, boarding_buffer_minutes: wheelchair ? 3 : 0,
    max_gradient_percent: 5,
  };
}

export function londonArrival(date, time) {
  const base = new Date(`${date}T${time}:00Z`);
  if (Number.isNaN(base.getTime())) throw new Error("Enter a valid appointment date and arrival time.");
  // Determine London's offset for the supplied appointment date, not the device timezone.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", timeZoneName: "shortOffset",
  }).formatToParts(base);
  const offset = parts.find(part => part.type === "timeZoneName")?.value;
  return `${date}T${time}:00${offset === "GMT+1" ? "+01:00" : "+00:00"}`;
}

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) return reject(new Error("Location requires HTTPS or localhost. You can enter your address manually."));
    if (!navigator.geolocation) return reject(new Error("This browser does not support location. Enter your address manually."));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
      error => reject(new Error(error.code === 1 ? "Location permission was declined. Enter your address manually." : "Could not find your location. Try again or enter an address.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 },
    );
  });
}
