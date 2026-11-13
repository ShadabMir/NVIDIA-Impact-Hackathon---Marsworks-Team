// Reuse appointment locations; never invent a straight-line or car route as a fallback.
export async function loadAppointmentNavigation({ appointment, hospitals, originPoint, liveLocation, destinationOverride, access, request, signal }) {
  const selected = hospitals.find(item => item.id === appointment.hospital_id);
  const hospitalName = selected?.name.replace(/\s*\(demo\)\s*$/i, "")
    || (appointment.hospital_id === "northern-general-demo" ? "Northern General Hospital" : "");
  if (!hospitalName) throw new Error("Choose a hospital on the Appointment page first.");

  async function lookup(query, label) {
    const results = await request(`/api/v1/locations/search?q=${encodeURIComponent(query)}`, { signal });
    if (!results.length) throw new Error(`Could not locate ${label}. Check the address on the Appointment page or adjust the map point.`);
    return results[0];
  }

  const destination = destinationOverride?.hospital_id === appointment.hospital_id ? destinationOverride
    : { ...await lookup(`${hospitalName}, Sheffield`, "the appointment hospital"), hospital_id: appointment.hospital_id };
  const origin = liveLocation || originPoint || (appointment.origin.trim()
    ? await lookup(appointment.origin, "your starting address") : null);
  if (!origin) throw new Error("Enter your starting address on the Appointment page, or enable live location.");

  const navigation = await request("/api/v1/navigation/route", {
    method: "POST", signal,
    body: JSON.stringify({
      origin: { latitude: origin.latitude, longitude: origin.longitude },
      destination: { latitude: destination.latitude, longitude: destination.longitude }, access,
    }),
  });
  if (navigation.geometry?.type !== "LineString" || !Array.isArray(navigation.geometry.coordinates)
      || navigation.geometry.coordinates.length < 2) {
    throw new Error("The provider returned no drawable route. Try refreshing directions.");
  }
  return { origin, destination, navigation };
}
