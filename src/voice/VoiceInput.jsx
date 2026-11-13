import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { blobToMono16k, checkRecording, encodeWav, MAX_SECONDS, microphoneError, voiceSupport } from "./wav.js";
import { formatDate } from "./describe.js";
import "./voice.css";

// "Tell us about your appointment" by voice. Records, sends a WAV to the backend (speech model on the
// DGX Spark, then Nemotron), shows the transcript and what was understood, and only fills the form when
// the user presses "Use these details". Every failure ends in a plain message and the typed form still works.

const LABELS = [
  ["hospital_said", "Hospital"], ["department", "Clinic / department"], ["date", "Date"],
  ["appointment_time", "Appointment time"], ["arrival", "Arrive by"], ["origin", "Travelling from"],
];

const SERVICE_MESSAGES = {
  checking: "Checking voice input…",
  loading: "Voice input is starting up. Try again in a minute.",
  not_configured: "Voice input isn't switched on yet. Please type the details below. (Setup: Settings → Voice input.)",
  error: "Voice input isn't working right now. Please type the details below.",
  unreachable: "Voice input isn't available right now. Please type the details below.",
};

// Stop the microphone, level meter and timers.
function release(p) {
  clearInterval(p.timer); cancelAnimationFrame(p.frame);
  p.stream?.getTracks().forEach(track => track.stop());
  p.meterContext?.close?.().catch(() => {});
  p.stream = null; p.meterContext = null;
}

export default function VoiceInput({ disabled, onApply }) {
  const [service, setService] = useState("checking");
  const [state, setState] = useState("idle"); // idle | starting | recording | processing | result
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [transcript, setTranscript] = useState("");
  const parts = useRef({});
  const unsupported = voiceSupport();

  useEffect(() => {
    let active = true;
    const recording = parts.current;
    api("/api/v1/appointments/voice/health")
      .then(data => { if (active) setService(data.status); })
      .catch(() => { if (active) setService("unreachable"); });
    return () => { active = false; release(recording); recording.request?.abort(); };
  }, []);

  const cleanup = () => release(parts.current);

  async function start() {
    setError(""); setResult(null); setState("starting");
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (failure) {
      setError(microphoneError(failure)); setState("idle"); return;
    }
    const p = parts.current;
    p.stream = stream; p.chunks = []; p.cancelled = false;
    try {
      p.recorder = new MediaRecorder(stream);
    } catch {
      cleanup(); setError("This browser can't record audio. Please type the details."); setState("idle"); return;
    }
    p.recorder.ondataavailable = event => { if (event.data?.size) p.chunks.push(event.data); };
    p.recorder.onstop = () => { const cancelled = p.cancelled; cleanup(); if (!cancelled) process(); };
    p.recorder.onerror = () => { p.cancelled = true; cleanup(); setError("Recording stopped unexpectedly. Please try again."); setState("idle"); };
    // Level meter so people can see the microphone is hearing them.
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      p.meterContext = new AudioCtx();
      const analyser = p.meterContext.createAnalyser();
      analyser.fftSize = 512;
      p.meterContext.createMediaStreamSource(stream).connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      const tick = () => {
        analyser.getFloatTimeDomainData(data);
        let peak = 0; for (const value of data) peak = Math.max(peak, Math.abs(value));
        setLevel(Math.min(1, peak * 3));
        p.frame = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* the meter is optional */ }
    setSeconds(0);
    p.ticks = 0;
    p.timer = setInterval(() => {
      p.ticks += 1;
      const elapsed = Math.floor(p.ticks / 4);
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) stop();
    }, 250);
    p.recorder.start(250);
    setState("recording");
  }

  function stop() {
    const recorder = parts.current.recorder;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  function cancel() {
    parts.current.cancelled = true;
    stop(); cleanup(); parts.current.request?.abort();
    setState("idle"); setLevel(0);
  }

  async function send(path, options) {
    const controller = new AbortController();
    parts.current.request = controller;
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      return await api(path, { ...options, signal: controller.signal });
    } catch (failure) {
      if (failure.name === "AbortError") throw new Error("That took too long. Please try again or type the details.");
      if (failure instanceof TypeError) throw new Error("Couldn't reach the app's server. Check it's running, then try again.");
      throw failure;
    } finally {
      clearTimeout(timer);
    }
  }

  async function process() {
    setState("processing"); setLevel(0);
    try {
      const chunks = parts.current.chunks || [];
      if (!chunks.length) throw new Error("No audio was recorded. Please try again.");
      let samples;
      try {
        samples = await blobToMono16k(new Blob(chunks, { type: chunks[0].type }));
      } catch {
        throw new Error("We couldn't process that recording. Please try again.");
      }
      const problem = checkRecording(samples);
      if (problem) throw new Error(problem);
      const form = new FormData();
      form.append("file", new Blob([encodeWav(samples)], { type: "audio/wav" }), "speech.wav");
      const data = await send("/api/v1/appointments/voice", { method: "POST", body: form });
      setResult(data); setTranscript(data.transcript); setState("result");
    } catch (failure) {
      setError(failure.message || "Something went wrong. Please try again or type the details."); setState("idle");
    }
  }

  async function reread() {
    if (!transcript.trim()) { setError("Type or record what you said first."); return; }
    setError(""); setState("processing");
    try {
      const data = await send("/api/v1/appointments/voice/text", { method: "POST", body: JSON.stringify({ transcript: transcript.slice(0, 1000) }) });
      setResult(data); setTranscript(data.transcript); setState("result");
    } catch (failure) {
      setError(failure.message); setState("result");
    }
  }

  function apply() {
    onApply(result);
    setState("idle"); setResult(null);
  }

  // Always shown, so it never appears to vanish: the button is enabled only when the speech service is ready.
  const available = service === "ready" && !unsupported;
  const found = result ? LABELS.filter(([key]) => result.details[key]) : [];

  return (
    <section className="voice-input card mb-3" aria-labelledby="voice-title">
      <div className="card-body">
        <h3 id="voice-title" className="h5 mb-1">Tell us about your appointment</h3>
        <p className="small mb-2">Say the clinic, the date and the time, for example: <em>“Neuro rehab at the Hallamshire, Monday the 16th at half past ten.”</em></p>
        {!available && <p className="small text-muted mb-2" role="status">
          {unsupported || SERVICE_MESSAGES[service] || SERVICE_MESSAGES.unreachable}
        </p>}

        {state === "idle" && <button type="button" className="btn btn-primary btn-accessible voice-button" disabled={disabled || !available} onClick={start}>
          <span aria-hidden="true">🎤 </span>Speak your appointment details
        </button>}
        {state === "starting" && <p role="status">Waiting for microphone permission…</p>}
        {state === "recording" && <div>
          <p className="mb-1" role="status"><span className="voice-dot" aria-hidden="true" /> Listening… {seconds}s (up to {MAX_SECONDS}s)</p>
          <div className="voice-meter" aria-hidden="true"><span style={{ width: `${Math.round(level * 100)}%` }} /></div>
          <div className="d-flex flex-wrap gap-2 mt-2">
            <button type="button" className="btn btn-danger btn-accessible" onClick={stop}>■ Stop and continue</button>
            <button type="button" className="btn btn-outline-secondary" onClick={cancel}>Cancel</button>
          </div>
        </div>}
        {state === "processing" && <p role="status">Understanding what you said (on the DGX Spark)…</p>}

        {error && <p className="alert alert-warning mt-2 mb-0" role="alert">{error}</p>}

        {state === "result" && result && <div className="mt-2">
          <label className="d-block mb-2"><span className="form-label-accessible d-block">What we heard (you can correct it)</span>
            <textarea className="form-control" rows={3} maxLength={1000} value={transcript} onChange={e => setTranscript(e.target.value)} />
          </label>
          {found.length > 0
            ? <dl className="voice-found">{found.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{key === "date" ? formatDate(result.details[key]) : result.details[key]}</dd></div>)}</dl>
            : <p className="small">We couldn't pick out any appointment details.</p>}
          {result.warnings.length > 0 && <ul className="alert alert-warning small">{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
          <div className="d-flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary btn-accessible" disabled={!found.length} onClick={apply}>Use these details</button>
            <button type="button" className="btn btn-outline-primary" onClick={reread}>Read my corrected words again</button>
            <button type="button" className="btn btn-outline-secondary" onClick={start}>Record again</button>
            <button type="button" className="btn btn-link" onClick={() => { setState("idle"); setResult(null); }}>Type instead</button>
          </div>
        </div>}
      </div>
    </section>
  );
}
