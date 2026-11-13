import { useState } from "react";

// Preserve the incoming branch's provider integration separately from account forms.
// This is a browser API key supplied for the demo, not the private ORS server key.
const roadKey = import.meta.env.VITE_LIVEROADS_KEY || "";

export default function LiveConditions({ onRoadsGeoJson }) {
  const [weather, setWeather] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [roadFilter, setRoadFilter] = useState("A57,M1,A61,A628");
  const [licence, setLicence] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);
  const [updated, setUpdated] = useState("");

  async function refresh() {
    setBusy(true); setErrors([]); setWeather(null); setIncidents([]); setUpdated("");
    onRoadsGeoJson(null);
    const results = await Promise.allSettled([
      (async () => {
        const response = await fetch("https://api.open-meteo.com/v1/forecast?latitude=53.3782&longitude=-1.4934&current=temperature_2m,precipitation,wind_speed_10m&timezone=Europe%2FLondon", { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error("Weather is unavailable.");
        const data = await response.json();
        if (!data.current) throw new Error("Weather response did not include current conditions.");
        setWeather(data.current);
      })(),
      (async () => {
        if (!roadKey) throw new Error("Road feed key is not configured.");
        const query = new URLSearchParams({ status: "active", format: "geojson" });
        if (roadFilter !== "ALL") query.set("road", roadFilter);
        const response = await fetch(`/liveroads-api/api/v1/incidents?${query}`, {
          headers: { Authorization: `Bearer ${roadKey}`, Accept: "application/json" },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error(`Road feed is unavailable (HTTP ${response.status}).`);
        const data = await response.json();
        if (data.type === "FeatureCollection" && Array.isArray(data.features)) {
          setIncidents(data.features.map(item => ({ ...item.properties, geometry: item.geometry })));
          onRoadsGeoJson(data);
        } else {
          const list = Array.isArray(data) ? data : data.incidents || data.data;
          if (!Array.isArray(list)) throw new Error("Road feed returned an unsupported format.");
          setIncidents(list);
        }
        const value = data.meta?.licence || data.licence;
        if (typeof value === "string") setLicence(value);
      })(),
    ]);
    setErrors(results.filter(item => item.status === "rejected").map(item => item.reason.message));
    setUpdated(new Date().toLocaleTimeString("en-GB")); setBusy(false);
  }

  return <section className="card shadow-sm"><div className="card-body">
    <h2 className="h5">Sheffield weather and road conditions</h2>
    <p className="small">Optional external feeds. Road incidents are not automatically assessed against your journey; no pavement accessibility or wheelchair traction is inferred from weather.</p>
    <label className="d-block mb-2">Road area<select className="form-select" value={roadFilter} onChange={event => setRoadFilter(event.target.value)}>
      <option value="A57,M1,A61,A628">Sheffield approaches</option><option value="M1">M1 corridor</option><option value="M25">M25 test area</option><option value="ALL">All available areas</option>
    </select></label>
    <button className="btn btn-outline-primary mb-2" disabled={busy} onClick={refresh}>{busy ? "Checking feeds…" : "Refresh conditions"}</button>
    {updated && <p className="small">Last request: {updated}</p>}
    {errors.map((message, index) => <p key={index} role="status" className="alert alert-warning small">{message} No sample incidents have been substituted.</p>)}
    {weather && <div className="weather-card mb-2">{weather.temperature_2m}°C · precipitation {weather.precipitation} mm · wind {weather.wind_speed_10m} km/h<br /><small>Sheffield observation time: {weather.time} · Open-Meteo</small></div>}
    {incidents.length > 0 && <ul className="small">{incidents.slice(0, 10).map((incident, index) => <li key={index}>
      <strong>{String(incident.title || incident.location || incident.road || "Reported incident")}</strong>
      {typeof incident.description === "string" && <p className="mb-1">{incident.description}</p>}
      <small>Source: {String(incident.source || incident.credit || incident.authority || "See provider record")}</small>
    </li>)}</ul>}
    <p className="liveroads-attribution small mb-0">Road data: <a href="https://liveroads.co.uk" target="_blank" rel="noreferrer">Live Roads</a>. {licence || "Original source and licence information are displayed when supplied by the provider."}</p>
  </div></section>;
}
