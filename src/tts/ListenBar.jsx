import { useEffect, useRef, useState } from "react";
import { speak, stopSpeaking } from "./speak";
import "./listen.css";

const AUTO_KEY = "accessroute.autoReadAlerts";

function readAutoSetting() {
  try {
    return localStorage.getItem(AUTO_KEY) !== "off";
  } catch {
    return true;
  }
}

const SOURCE_TEXT = {
  spark: "Reading aloud with the speech model on the DGX Spark.",
  browser: "Reading aloud with this device's English voice.",
  "browser-online": "Reading aloud with an online English voice from your browser.",
  "no-english":
    "No English voice is installed on this device, so nothing was read. On Windows: Settings, Time & language, Speech, Add voices, English (United Kingdom).",
  none: "This browser cannot read aloud. Use your screen reader instead.",
};

// Sticky bar at the top of every screen: the first control after the header, so keyboard and
// screen reader users reach it immediately. Shortcuts: Alt+Shift+R reads, Alt+Shift+S stops.
export default function ListenBar({ screenKey, script, alertText }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoRead, setAutoRead] = useState(readAutoSetting);
  const spokenAlert = useRef("");

  const read = async (text) => {
    if (!text) return;
    setBusy(true);
    setStatus("Preparing audio…");
    const source = await speak(text);
    setStatus(SOURCE_TEXT[source]);
    setBusy(false);
  };

  const stop = () => {
    stopSpeaking();
    setBusy(false);
    setStatus("Stopped.");
  };

  // Read a new alert once, automatically, if the user allows it.
  useEffect(() => {
    if (autoRead && alertText && spokenAlert.current !== alertText) {
      spokenAlert.current = alertText;
      read(alertText);
    }
  }, [alertText, autoRead]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop speech when the screen changes, so old content is not read over new content.
  useEffect(() => () => stopSpeaking(), [screenKey]);

  useEffect(() => {
    const onKey = (e) => {
      if (!e.altKey || !e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === "r") {
        e.preventDefault();
        read(script);
      } else if (key === "s") {
        e.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [script]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAuto = (e) => {
    const on = e.target.checked;
    setAutoRead(on);
    try {
      localStorage.setItem(AUTO_KEY, on ? "on" : "off");
    } catch {
      /* setting just won't be remembered */
    }
  };

  return (
    <section className="listen-bar" aria-label="Read aloud">
      <div className="listen-bar-row">
        <button
          type="button"
          className="listen-btn listen-btn-primary"
          onClick={() => read(script)}
          disabled={busy}
          aria-keyshortcuts="Alt+Shift+R"
          aria-describedby="listen-hint"
        >
          <span aria-hidden="true">🔊</span> Read this screen
        </button>
        <button
          type="button"
          className="listen-btn listen-btn-stop"
          onClick={stop}
          aria-keyshortcuts="Alt+Shift+S"
        >
          <span aria-hidden="true">■</span> Stop
        </button>
      </div>
      <div className="listen-bar-row listen-bar-small">
        <label className="listen-toggle">
          <input type="checkbox" checked={autoRead} onChange={toggleAuto} />
          Read alerts aloud automatically
        </label>
        <span id="listen-hint" className="listen-hint">
          Shortcut: Alt + Shift + R to read, Alt + Shift + S to stop
        </span>
      </div>
      <p className="listen-status" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}

// Small Listen button for one section (an alert, a route step, the appointment details).
export function ListenButton({ text, label = "Listen", className = "" }) {
  const [problem, setProblem] = useState("");
  return (
    <>
      <button
        type="button"
        className={`listen-btn listen-btn-inline ${className}`}
        onClick={async (e) => {
          e.stopPropagation(); // don't trigger the card's own click (e.g. map zoom)
          const source = await speak(text);
          setProblem(source === "no-english" || source === "none" ? SOURCE_TEXT[source] : "");
        }}
        aria-label={`${label}: read aloud`}
      >
        <span aria-hidden="true">🔊</span> {label}
      </button>
      {problem && (
        <p className="listen-status" role="status">
          {problem}
        </p>
      )}
    </>
  );
}
