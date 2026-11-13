// Audio helpers for voice input. The browser records in whatever format it supports (webm, mp4,
// ogg); we decode it and convert it to 16 kHz mono 16-bit WAV, which the speech service reads
// without ffmpeg. Pure functions (rms, encodeWav, checkRecording) are unit-tested in Node.

export const TARGET_RATE = 16000;
export const MIN_SECONDS = 0.7;
export const MAX_SECONDS = 60;
export const SILENCE_RMS = 0.006;

export function rms(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

// Returns null when the recording is usable, otherwise a message for the user.
export function checkRecording(samples, sampleRate = TARGET_RATE) {
  const seconds = samples.length / sampleRate;
  if (seconds < MIN_SECONDS) return "That was too short. Press the button, speak, then press Stop.";
  if (rms(samples) < SILENCE_RMS) return "We didn't hear anything. Check your microphone is on and not muted, then try again.";
  return null;
}

export function encodeWav(samples, sampleRate = TARGET_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, Number.isFinite(samples[i]) ? samples[i] : 0));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return buffer;
}

// Browser only: decode a recorded Blob and resample it to 16 kHz mono.
export async function blobToMono16k(blob) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const context = new AudioCtx();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const length = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
    const offline = new OfflineAudioContext(1, length, TARGET_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded; // multi-channel input is mixed down to the single output channel
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  } finally {
    context.close?.().catch(() => {});
  }
}

export function voiceSupport() {
  if (typeof window === "undefined") return "This browser can't record audio.";
  if (!window.isSecureContext) return "Voice input needs a secure page (https or localhost).";
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return "This browser can't record audio. Please type the details.";
  if (!(window.AudioContext || window.webkitAudioContext) || !window.OfflineAudioContext) return "This browser can't process audio. Please type the details.";
  return null;
}

export function microphoneError(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone permission was declined. Allow the microphone in your browser's address bar, or type the details.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone was found. Plug one in, or type the details.";
    case "NotSupportedError":
      return "Your browser didn't allow the microphone. Allow microphone access for this page, or type the details.";
    case "NotReadableError":
      return "The microphone is being used by another app. Close it and try again.";
    default:
      return "The microphone couldn't be started. Please try again or type the details.";
  }
}
