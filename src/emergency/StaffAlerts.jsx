import { useEffect, useState } from "react";
import { acknowledgeAlert, clearAlerts, getAlerts, subscribe } from "./alerts";
import "./help.css";

const TYPE_TEXT = {
  "999": "999 CALLED",
  help: "NEEDS HELP",
  carer: "CALLED CARER",
  stuck: "STUCK ON ROUTE",
};

function timeText(iso) {
  try {
    return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

// Live list of Help alerts for the hospital staff view. Updates across browser tabs.
export default function StaffAlerts() {
  const [alerts, setAlerts] = useState(getAlerts);

  useEffect(() => subscribe(setAlerts), []);

  if (!alerts.length) {
    return (
      <div className="card border-0 shadow-sm">
        <div className="card-body small text-muted">
          No help alerts from patients. Alerts appear here as soon as a patient presses Help.
        </div>
      </div>
    );
  }

  return (
    <section aria-label="Patient help alerts" className="d-flex flex-column gap-2">
      <div aria-live="assertive" className="visually-hidden">
        {alerts.find((a) => !a.acknowledged)
          ? `New help alert: ${alerts.find((a) => !a.acknowledged).label}`
          : ""}
      </div>
      {alerts.map((a) => (
        <article key={a.id} className={`staff-alert ${a.acknowledged ? "is-ack" : ""}`}>
          <div className="staff-alert-head">
            <span className="staff-alert-badge">
              {a.acknowledged ? "ACKNOWLEDGED" : TYPE_TEXT[a.type] || "HELP"}
            </span>
            <strong>
              {a.patientName} · {timeText(a.time)}
            </strong>
          </div>
          <dl>
            <dt>What happened</dt>
            <dd>{a.label}</dd>
            <dt>Appointment</dt>
            <dd>
              {a.department}, {a.hospital}, arrive by {a.arriveBy}
            </dd>
            <dt>On their route</dt>
            <dd>{a.routeStep || a.screen}</dd>
            <dt>Location</dt>
            <dd>
              {a.location ? (
                <a
                  href={`https://www.openstreetmap.org/?mlat=${a.location.lat}&mlon=${a.location.lon}#map=17/${a.location.lat}/${a.location.lon}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {a.location.lat}, {a.location.lon} (±{a.location.accuracy_m} m)
                </a>
              ) : (
                "Not shared; use their route step"
              )}
            </dd>
            <dt>Needs</dt>
            <dd>{a.needs}</dd>
          </dl>
          {!a.acknowledged && (
            <button
              type="button"
              className="btn btn-danger fw-bold align-self-start"
              style={{ minHeight: 44 }}
              onClick={() => acknowledgeAlert(a.id)}
            >
              Acknowledge and contact patient
            </button>
          )}
        </article>
      ))}
      <button
        type="button"
        className="btn btn-link btn-sm align-self-start text-secondary"
        onClick={clearAlerts}
      >
        Clear demo alerts
      </button>
    </section>
  );
}
