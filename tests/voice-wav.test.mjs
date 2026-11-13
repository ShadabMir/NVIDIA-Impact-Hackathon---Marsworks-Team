import assert from "node:assert/strict";
import test from "node:test";
import { checkRecording, encodeWav, microphoneError, rms, TARGET_RATE } from "../src/voice/wav.js";

const tone = (seconds, amplitude = 0.3) => Float32Array.from(
  { length: Math.round(seconds * TARGET_RATE) }, (_, i) => amplitude * Math.sin((2 * Math.PI * 220 * i) / TARGET_RATE));

test("encodeWav writes a valid 16 kHz mono 16-bit WAV header and data", () => {
  const samples = Float32Array.from([0, 0.5, -0.5, 1, -1, 2, Number.NaN]);
  const view = new DataView(encodeWav(samples));
  const text = (o, n) => String.fromCharCode(...new Uint8Array(view.buffer, o, n));
  assert.equal(text(0, 4), "RIFF"); assert.equal(text(8, 4), "WAVE"); assert.equal(text(36, 4), "data");
  assert.equal(view.getUint16(22, true), 1); assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(34, true), 16); assert.equal(view.getUint32(40, true), samples.length * 2);
  assert.equal(view.byteLength, 44 + samples.length * 2);
  assert.equal(view.getInt16(44 + 3 * 2, true), 32767);   // 1.0
  assert.equal(view.getInt16(44 + 4 * 2, true), -32768);  // -1.0
  assert.equal(view.getInt16(44 + 5 * 2, true), 32767);   // clipped 2.0
  assert.equal(view.getInt16(44 + 6 * 2, true), 0);       // NaN -> silence
});

test("checkRecording rejects too short and silent recordings, accepts speech-level audio", () => {
  assert.match(checkRecording(tone(0.3)), /too short/);
  assert.match(checkRecording(new Float32Array(TARGET_RATE * 2)), /didn't hear anything/);
  assert.match(checkRecording(tone(2, 0.001)), /didn't hear anything/);
  assert.equal(checkRecording(tone(2)), null);
});

test("rms handles empty input", () => {
  assert.equal(rms(new Float32Array(0)), 0);
  assert.ok(Math.abs(rms(tone(1, 0.5)) - 0.5 / Math.SQRT2) < 0.01);
});

test("microphone errors map to plain-English messages", () => {
  assert.match(microphoneError({ name: "NotAllowedError" }), /permission/);
  assert.match(microphoneError({ name: "NotFoundError" }), /No microphone/);
  assert.match(microphoneError({ name: "NotReadableError" }), /another app/);
  assert.match(microphoneError({ name: "NotSupportedError" }), /didn't allow the microphone/);
  assert.match(microphoneError(new Error("weird")), /couldn't be started/);
});

test("describeDetails builds the read-back sentence from what was heard", async () => {
  const { describeDetails } = await import("../src/voice/describe.js");
  assert.match(describeDetails({ date: "2026-11-16", arrival: "10:15", department: "Neuro rehab", origin: "Walkley" }),
    /^Monday,? 16 November 2026, arrive by 10:15, Neuro rehab, travelling from Walkley$/);
  assert.equal(describeDetails({}), "");
});
