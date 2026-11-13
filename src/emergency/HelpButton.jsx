import { useEffect, useRef, useState } from "react";
import {
  IconBuildingHospital,
  IconPhone,
  IconPhoneCall,
  IconRoute,
  IconSos,
  IconUserHeart,
  IconX,
} from "@tabler/icons-react";
import { DEMO_CONTACTS, DEMO_MODE, getLocation, sendAlert } from "./alerts";
import "./help.css";

const DONE_TEXT = {
  "999": DEMO_MODE
    ? "Demo mode: in real use your phone would now call 999. The hospital team has been alerted."
    : "Calling 999. The hospital team has been alerted.",
  help: "The hospital team has been alerted. They can see where you are on your route and will contact you.",
  carer: DEMO_MODE
    ? `Demo mode: in real use this would call ${DEMO_CONTACTS.carer.name}. The hospital team has been alerted.`
    : `Calling ${DEMO_CONTACTS.carer.name}. The hospital team has been alerted.`,
  hospital: DEMO_MODE
    ? "Demo mode: in real use this would call the hospital transport team."
    : "Calling the hospital transport team.",
};

// Fixed red Help button (bottom right, above the tabs) that opens a help sheet.
// Every option also sends an alert to the hospital staff view.
export default function HelpButton({ context, onReplan }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const firstOption = useRef(null);
  const trigger = useRef(null);

  const close = () => {
    setOpen(false);
    setDone("");
    trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    firstOption.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const alertHospital = async (type, label) => {
    setBusy(true);
    const location = await getLocation();
    sendAlert({ type, label, location, ...context });
    setBusy(false);
  };

  const call = (number) => {
    if (!DEMO_MODE) window.location.href = `tel:${number.replace(/\s/g, "")}`;
  };

  const choose = async (type) => {
    if (type === "999") {
      call("999"); // dial first: never delay an emergency call
      await alertHospital("999", "Called 999");
    } else if (type === "help") {
      await alertHospital("help", "Needs help on the way");
    } else if (type === "carer") {
      call(DEMO_CONTACTS.carer.phone);
      await alertHospital("carer", "Called their carer");
    } else if (type === "hospital") {
      call(DEMO_CONTACTS.hospital.phone);
    } else if (type === "stuck") {
      await alertHospital("stuck", "Stuck on route, asked for another way");
      close();
      onReplan?.();
      return;
    }
    setDone(DONE_TEXT[type]);
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="help-fab"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="Help: call 999 or alert the hospital"
      >
        <IconSos size={30} stroke={2} aria-hidden="true" />
        <span className="help-fab-label">Help</span>
      </button>

      {open && (
        <div className="help-backdrop" onClick={close}>
          <div
            className="help-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="help-sheet-head">
              <h2 id="help-title">Get help now</h2>
              <button type="button" className="help-close" onClick={close} aria-label="Close help">
                <IconX size={24} stroke={2} aria-hidden="true" />
              </button>
            </div>

            {done ? (
              <div className="help-done">
                <p role="status">{done}</p>
                <button type="button" className="help-option" onClick={close}>
                  Done
                </button>
              </div>
            ) : (
              <>
                <button
                  ref={firstOption}
                  type="button"
                  className="help-option help-option-999"
                  onClick={() => choose("999")}
                  disabled={busy}
                >
                  <IconPhone className="help-icon" size={28} stroke={1.75} aria-hidden="true" />
                  <span>
                    <strong>Call 999</strong>
                    <small>Danger, injury or a medical emergency. Also alerts the hospital.</small>
                  </span>
                </button>

                <button type="button" className="help-option" onClick={() => choose("help")} disabled={busy}>
                  <IconBuildingHospital className="help-icon" size={28} stroke={1.75} aria-hidden="true" />
                  <span>
                    <strong>Alert the hospital team</strong>
                    <small>Sends your location and journey to staff</small>
                  </span>
                </button>

                <button type="button" className="help-option" onClick={() => choose("carer")} disabled={busy}>
                  <IconUserHeart className="help-icon" size={28} stroke={1.75} aria-hidden="true" />
                  <span>
                    <strong>Call my carer</strong>
                    <small>{DEMO_CONTACTS.carer.name}, {DEMO_CONTACTS.carer.phone}</small>
                  </span>
                </button>

                <button type="button" className="help-option" onClick={() => choose("hospital")} disabled={busy}>
                  <IconPhoneCall className="help-icon" size={28} stroke={1.75} aria-hidden="true" />
                  <span>
                    <strong>Call the hospital</strong>
                    <small>If you'll be late or need transport</small>
                  </span>
                </button>

                <button type="button" className="help-option" onClick={() => choose("stuck")} disabled={busy}>
                  <IconRoute className="help-icon" size={28} stroke={1.75} aria-hidden="true" />
                  <span>
                    <strong>I'm stuck: find another way</strong>
                    <small>The agent re-plans from where you are</small>
                  </span>
                </button>

                {busy && <p className="help-note" role="status">Sending your location…</p>}
              </>
            )}

            <p className="help-note">
              For urgent advice that isn't an emergency, call NHS 111. Deaf or can't speak? Text 999
              if you're registered with emergencySMS.
            </p>
            {DEMO_MODE && (
              <p className="help-note help-demo">Demo mode: no real calls are made.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
