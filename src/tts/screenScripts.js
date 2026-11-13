// Plain-English scripts read aloud by the Listen buttons. Short sentences, action first,
// no emoji or symbols (speech engines read them literally).

const MOBILITY = {
  powered_wheelchair: "powered wheelchair",
  manual_wheelchair: "manual wheelchair",
  walking_aid: "walking aid",
  none: "no mobility aid",
};

export function clean(text) {
  return String(text ?? "")
    .replace(/[\p{Extended_Pictographic}️]/gu, "")
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

export function routeStepScript(s, index) {
  return clean(`Step ${index + 1}, at ${s.time}. ${s.title}. ${s.detail}`);
}

export function alertScript(data) {
  const d = data.disruption;
  return clean(
    `Alert at ${d.time}. Pavement blocked at ${d.location}. ${d.alert} ` +
      "Your journey has been reassessed. Read the screen for your options.",
  );
}

export function appointmentScript(data) {
  const e = data.extraction;
  return clean(
    `Your appointment is at ${e.hospital}, ${e.department}, on ${e.date}. ` +
      `Please arrive by ${e.arrivalTime}. Use the ${e.entrance}. ` +
      "Please check these details are correct before continuing.",
  );
}

export function screenScript(step, data, weather) {
  const a = data.accessNeeds;
  switch (step) {
    case 1:
      return clean(`Step 1 of 4, appointment letter. ${appointmentScript(data)}`);
    case 2:
      return clean(
        `Step 2 of 4, your access needs. Mobility aid: ${MOBILITY[a.mobilityAid] || a.mobilityAid}. ` +
          `${a.stepFree ? "Step-free route required." : "Steps are acceptable."} ` +
          `Steepest slope allowed: ${a.maxGradient.replace(":", " in ")}. ` +
          `Longest distance without a rest: ${a.maxDistanceMeters} metres. ` +
          `Extra time when changing transport: ${a.transferBufferMins} minutes.`,
      );
    case 3: {
      const weatherText = weather
        ? `Current weather in Sheffield: ${Math.round(weather.temperature_2m)} degrees` +
          (weather.precipitation > 0 ? ", with rain. Pavements may be slippery." : ", dry.")
        : "";
      const steps = data.steps.map(routeStepScript).join(" ");
      return clean(
        `Step 3 of 4, your route to ${data.extraction.hospital}. ${weatherText} ` +
          `Your route has ${data.steps.length} steps. ${steps}`,
      );
    }
    case 4: {
      const log = data.disruption.reassessmentLog.map(clean).join(" ");
      return clean(`Step 4 of 4. ${alertScript(data)} ${log}`);
    }
    case 5: {
      const s = data.disruption.supportDraft;
      return clean(
        `Hospital staff view. Travel support request for ${s.patient}. ${s.summary} ` +
          `Action requested: ${s.actionRequested}`,
      );
    }
    default:
      return "";
  }
}
