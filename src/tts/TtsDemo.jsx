import { useEffect, useState } from "react";
import { checkSparkTts, speak, stopSpeaking } from "./speak";

const SAMPLES = [
  "Pavement blocked on Beech Hill Road. I have changed your route. Please stay on Bus 95 to the Glossop Road stop, then use the step-free main entrance.",
  "Your appointment is on Monday the 16th of November at 10:30 at the Royal Hallamshire Hospital, Neuro-Rehabilitation Outpatients, Floor C.",
  "Turn left now. The automatic doors are ten metres ahead.",
];

const SOURCE_LABEL = {
  spark: "Spoken by the speech model on the DGX Spark",
  browser: "Spoken by this device's English voice (Spark speech model not reachable)",
  "browser-online": "Spoken by an online English voice from the browser (Spark speech model not reachable)",
  "no-english":
    "Not spoken: no English voice is installed on this device. On Windows: Settings → Time & language → Speech → Add voices → English (United Kingdom).",
  none: "This browser cannot speak",
};

export default function TtsDemo() {
  const [text, setText] = useState(SAMPLES[0]);
  const [status, setStatus] = useState(null);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    checkSparkTts().then(setStatus);
  }, []);

  const onSpeak = async () => {
    setBusy(true);
    setSource("");
    setSource(await speak(text));
    setBusy(false);
  };

  return (
    <main className="container py-4" style={{ maxWidth: 640 }}>
      <h1 className="h3">Text to speech test</h1>
      <p className="text-muted">
        Checks the <code>/api/v1/tts</code> endpoint. Run the backend with{" "}
        <code>app.main_tts:app</code>.
      </p>

      <div className={`alert ${status ? "alert-success" : "alert-warning"}`} role="status">
        {status
          ? `Speech model ready on the Spark (${status.voice}).`
          : "Speech model on the Spark is not reachable. The browser voice will be used."}
      </div>

      <label htmlFor="tts-text" className="form-label fw-semibold">Text to speak</label>
      <textarea
        id="tts-text"
        className="form-control mb-2"
        rows={5}
        maxLength={2000}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="d-flex flex-wrap gap-2 mb-3">
        {SAMPLES.map((sample, i) => (
          <button key={i} type="button" className="btn btn-outline-secondary btn-sm"
            onClick={() => setText(sample)}>
            Sample {i + 1}
          </button>
        ))}
      </div>

      <div className="d-flex gap-2">
        <button type="button" className="btn btn-primary btn-lg" onClick={onSpeak}
          disabled={busy || !text.trim()}>
          {busy ? "Generating…" : "🔊 Listen"}
        </button>
        <button type="button" className="btn btn-outline-danger btn-lg" onClick={stopSpeaking}>
          Stop
        </button>
      </div>

      <p className="mt-3" aria-live="polite">{source && SOURCE_LABEL[source]}</p>
    </main>
  );
}
