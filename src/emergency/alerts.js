// Help alerts from patients to the hospital team.
//
// Demo version: alerts are kept in this browser (localStorage) and shared between tabs, so the
// staff view can be open in a second tab or window during the demo. In production this would be
// a backend endpoint that delivers the alert to the hospital's patient access / transport team.

const KEY = "accessroute.helpAlerts";
const EVENT = "accessroute:help-alerts";

// Demo mode stops the app from dialling real numbers (999, carer, hospital) during the hackathon.
// Set VITE_DEMO_MODE=false only for a real pilot.
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== "false";

// Fictional numbers (Ofcom drama ranges) so nothing real is ever called from the demo.
export const DEMO_CONTACTS = {
  carer: { name: "Sam (carer)", phone: "07700 900123" },
  hospital: { name: "Hospital transport team", phone: "0114 496 0000" },
};

export function getAlerts() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function save(alerts) {
  try {
    localStorage.setItem(KEY, JSON.stringify(alerts.slice(0, 20)));
  } catch {
    /* storage blocked: the alert still shows in this tab */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function sendAlert(alert) {
  const full = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: new Date().toISOString(),
    acknowledged: false,
    ...alert,
  };
  save([full, ...getAlerts()]);
  return full;
}

export function acknowledgeAlert(id) {
  save(getAlerts().map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
}

export function clearAlerts() {
  save([]);
}

// Calls back whenever alerts change in this tab or another tab.
export function subscribe(callback) {
  const onStorage = (e) => {
    if (e.key === KEY) callback(getAlerts());
  };
  const onLocal = () => callback(getAlerts());
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, onLocal);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, onLocal);
  };
}

// Best-effort location, never blocks the alert for more than a few seconds.
export function getLocation(timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    const timer = setTimeout(() => resolve(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({
          lat: Number(pos.coords.latitude.toFixed(5)),
          lon: Number(pos.coords.longitude.toFixed(5)),
          accuracy_m: Math.round(pos.coords.accuracy),
        });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}
