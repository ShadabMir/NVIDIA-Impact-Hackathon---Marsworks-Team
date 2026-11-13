// Text-to-speech helper. Tries the speech model on the DGX Spark (POST /api/v1/tts) first and
// falls back to the browser's own voice, so the demo never goes silent.
//
// Usage from any component:
//   import { speak, stopSpeaking } from "./tts/speak";
//   const source = await speak("Your route has changed.");
//   // "spark" | "browser" | "browser-online" | "no-english" | "none"

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

let currentAudio = null;
let currentUrl = null;

export function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

// Browsers load their voice list asynchronously; the first call often returns an empty list.
function loadVoices(timeoutMs = 1500) {
  const synth = window.speechSynthesis;
  const voices = synth.getVoices();
  if (voices.length) return Promise.resolve(voices);
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener("voiceschanged", done);
      clearTimeout(timer);
      resolve(synth.getVoices());
    };
    const timer = setTimeout(done, timeoutMs);
    synth.addEventListener("voiceschanged", done);
  });
}

// Prefer British English, then any English. Prefer voices installed on the device, so the
// text is not sent to an online voice service.
export function pickEnglishVoice(voices) {
  const lang = (v) => (v.lang || "").replace("_", "-").toLowerCase();
  const tests = [
    (v) => lang(v) === "en-gb" && v.localService,
    (v) => lang(v).startsWith("en") && v.localService,
    (v) => lang(v) === "en-gb",
    (v) => lang(v).startsWith("en"),
  ];
  for (const test of tests) {
    const voice = voices.find(test);
    if (voice) return voice;
  }
  return null;
}

async function speakWithBrowser(text) {
  if (typeof window === "undefined" || !window.speechSynthesis) return "none";
  const voice = pickEnglishVoice(await loadVoices());
  // Never fall back to the system default voice: on a non-English system it would read
  // English text with, for example, a Chinese voice.
  if (!voice) return "no-english";
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
  return voice.localService ? "browser" : "browser-online";
}

export async function speak(text, { preferSpark = true, timeoutMs = 20000 } = {}) {
  const clean = (text || "").trim();
  if (!clean) return "none";
  stopSpeaking();

  if (preferSpark) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${API_BASE}/api/v1/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean.slice(0, 2000) }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`TTS request failed: ${res.status}`);
      const blob = await res.blob();
      currentUrl = URL.createObjectURL(blob);
      currentAudio = new Audio(currentUrl);
      await currentAudio.play();
      return "spark";
    } catch (err) {
      console.warn("Spark TTS unavailable, using the browser voice", err);
    } finally {
      clearTimeout(timer);
    }
  }
  return speakWithBrowser(clean);
}

export async function checkSparkTts() {
  try {
    const res = await fetch(`${API_BASE}/api/v1/tts/health`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
