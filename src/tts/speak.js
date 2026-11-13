// Text-to-speech helper. Tries the speech model on the DGX Spark (POST /api/v1/tts) first and
// falls back to the browser's own voice, so the demo never goes silent.
//
// Usage from any component:
//   import { speak, stopSpeaking } from "./tts/speak";
//   const source = await speak("Your route has changed.");   // "spark" | "browser" | "none"

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

function speakWithBrowser(text) {
  if (typeof window === "undefined" || !window.speechSynthesis) return "none";
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-GB";
  const voices = window.speechSynthesis.getVoices();
  // Prefer a voice installed on the device so nothing is sent to a cloud voice service.
  const local = voices.find((v) => v.lang === "en-GB" && v.localService) ||
    voices.find((v) => v.lang.startsWith("en") && v.localService);
  if (local) utterance.voice = local;
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
  return "browser";
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
