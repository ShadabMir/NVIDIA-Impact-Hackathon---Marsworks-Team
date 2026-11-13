import { useEffect, useRef, useState } from "react";
import { api, getPosition, londonArrival, MOBILITY_OPTIONS, presetFor } from "./api";
import LiveJourneyMap from "./LiveJourneyMap";
import LiveConditions from "./LiveConditions";
import { draftMessage, getContext as getAgentContext, getModelHealth as getAgentHealth, planJourney as planWithAgent, reassessJourney, warmUpModel } from "./agent/api.js";
import { Results as AgentResults } from "./agent/AgentResults.jsx";
import { profileNeeds } from "./agent/profileNeeds.js";
import "./agent/agent.css";

const emptyProfile = () => ({ first_name: "", last_name: "", email: "", default_hospital_id: "royal-hallamshire", default_starting_address: "", mobility_aid: "manual_wheelchair", access: presetFor("manual_wheelchair") });
const initialAppointment = () => ({ hospital_id: "royal-hallamshire", department: "Neuro-Rehabilitation Outpatients", date: "2026-11-16", arrival: "10:15", origin: "" });

// Royal Hallamshire journeys are planned by the AI agent, which only has checked route data for
// some areas. Pick the nearest one to the user's start point, or say honestly that there is none.
const AGENT_HOSPITAL = "royal-hallamshire";
const AREA_RADIUS_KM = 2.5;
const NO_DATA_AREA = "elsewhere";
function distanceKm(a, b) {
  const rad = degrees => degrees * Math.PI / 180;
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
function nearestArea(point, origins) {
  let best = null;
  for (const area of origins.filter(o => !o.no_data && o.lat != null)) {
    const km = distanceKm(point, { latitude: area.lat, longitude: area.lon });
    if (!best || km < best.km) best = { ...area, km };
  }
  return best && best.km <= AREA_RADIUS_KM ? best : { id: NO_DATA_AREA, name: "Somewhere else", km: best?.km ?? null };
}
const AGENT_EXTRAS = [
  ["needs_accessible_toilet", "I need an accessible toilet on the way"],
  ["needs_changing_places", "I need a Changing Places toilet"],
  ["avoid_crowds", "Avoid crowds if possible"],
  ["can_use_taxi", "A taxi is an option for me"],
  ["use_model", "Use the local AI agent (Nemotron on the DGX Spark)"],
];

function Field({ label, children }) {
  return <label className="d-block mb-3"><span className="form-label-accessible d-block">{label}</span>{children}</label>;
}

function NeedsForm({ profile, setProfile, presets }) {
  return <>
    <Field label="How do you usually get around?">
      <select className="form-select form-select-lg-accessible" value={profile.mobility_aid} onChange={event => {
        const aid = event.target.value;
        setProfile(previous => ({ ...previous, mobility_aid: aid, access: presets?.[aid] || presetFor(aid) }));
      }}>{MOBILITY_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
    </Field>
    <label className="need-toggle"><input type="checkbox" checked={profile.access.step_free_required} disabled={profile.access.wheelchair_user} onChange={event => setProfile(previous => ({ ...previous, access: { ...previous.access, step_free_required: event.target.checked } }))} /> I need routes without steps</label>
    <p className="text-muted small">We suggest shorter distances, gentler slopes and time for boarding. You can change these preferences in Settings. Suggestions do not assess your personal ability.</p>
  </>;
}

export default function AccessRouteApp({ AdvancedMap, demoGeoJson }) {
  const [page, setPage] = useState("journey");
  const [step, setStep] = useState(1);
  const [profile, setProfile] = useState(emptyProfile);
  const [signedIn, setSignedIn] = useState(false);
  const [authMode, setAuthMode] = useState("register");
  const [password, setPassword] = useState("");
  const [presets, setPresets] = useState(null);
  const [hospitals, setHospitals] = useState([]);
  const [health, setHealth] = useState(null);
  const [model, setModel] = useState("Checking…");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [appointment, setAppointment] = useState(initialAppointment);
  const [confirmed, setConfirmed] = useState(false);
  const [extractionWarnings, setExtractionWarnings] = useState([]);
  const [filename, setFilename] = useState("");
  const [location, setLocation] = useState(null);
  const [originPoint, setOriginPoint] = useState(null);
  const [tracking, setTracking] = useState(false);
  const watchId = useRef(null);
  const [locationMessage, setLocationMessage] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchKind, setSearchKind] = useState("destination");
  const [destination, setDestination] = useState(null);
  const [navigation, setNavigation] = useState(null);
  const [navigationIndex, setNavigationIndex] = useState(0);
  const [focus, setFocus] = useState(null);
  const [supportDraft, setSupportDraft] = useState(null);
  const [reviewed, setReviewed] = useState(false);
  const [geoJson, setGeoJson] = useState(demoGeoJson);
  const [roadOverlay, setRoadOverlay] = useState(null);
  // AI agent (Royal Hallamshire)
  const [agentCtx, setAgentCtx] = useState(null);
  const [agentStatus, setAgentStatus] = useState("Checking…");
  const [areaId, setAreaId] = useState("walkley");
  const [areaNote, setAreaNote] = useState("");
  const [agentExtras, setAgentExtras] = useState({ needs_accessible_toilet: false, needs_changing_places: false, avoid_crowds: false, can_use_taxi: true, use_model: true });
  const [agentPlan, setAgentPlan] = useState(null);
  const [agentRequest, setAgentRequest] = useState(null);
  const [activeScenarios, setActiveScenarios] = useState([]);
  const [agentDraft, setAgentDraft] = useState(null);

  useEffect(() => {
    let active = true;
    api("/health").then(data => { if (active) setHealth(data); }).catch(() => { if (active) setModel("API offline"); });
    api("/health/model").then(() => { if (active) setModel("Available"); }).catch(() => { if (active) setModel("Not connected"); });
    api("/api/v1/hospitals").then(data => { if (active) setHospitals(data); }).catch(() => {});
    api("/api/v1/access/defaults").then(data => { if (active) setPresets(data.presets); }).catch(() => {});
    getAgentContext().then(data => { if (active) setAgentCtx(data); }).catch(() => {});
    getAgentHealth().then(data => { if (active) setAgentStatus(`Available: ${data.model}`); }).catch(() => { if (active) setAgentStatus("Not connected – safety rules only"); });
    api("/api/v1/profile").then(async data => {
      if (!active) return;
      setProfile(data); setSignedIn(true);
      setAppointment(previous => ({ ...previous, hospital_id: data.default_hospital_id, origin: data.default_starting_address || "" }));
      try {
        const saved = await api("/api/v1/workspace");
        if (active && saved.appointment) { setAppointment(saved.appointment); setMessage("Loaded your saved appointment. Check the details before planning."); }
      } catch (failure) { if (active) setError(`Could not load your saved appointment: ${failure.message}`); }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => () => { if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current); }, []);

  // When the start point is chosen (GPS or address search), pick the agent's start area from it.
  const updateAreaFor = point => {
    if (!point || !agentCtx) return;
    const area = nearestArea(point, agentCtx.origins);
    setAreaId(area.id);
    setAreaNote(area.id === NO_DATA_AREA
      ? `No checked route data within ${AREA_RADIUS_KM} km of this start point${area.km != null ? ` (nearest area ${area.km.toFixed(1)} km away)` : ""}. The agent will say so rather than guess.`
      : `Nearest area with checked route data: ${area.name} (${area.km.toFixed(1)} km away).`);
  };

  const run = async task => {
    setBusy(true); setError(""); setMessage("");
    try { await task(); } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const openPage = next => { setPage(next); setError(""); setMessage(""); };
  const changeAppointment = (key, value) => {
    setAppointment(previous => ({ ...previous, [key]: value })); setConfirmed(false);
    setSupportDraft(null);
    setAgentPlan(null); setAgentRequest(null); setAgentDraft(null); setActiveScenarios([]);
    if (key === "origin") { setOriginPoint(null); setNavigation(null); }
  };
  const changeDestination = point => { setDestination(point); setNavigation(null); setNavigationIndex(0); };
  const changeProfileField = (key, value) => setProfile(previous => ({ ...previous, [key]: value }));
  const updateAccess = (key, value) => setProfile(previous => ({ ...previous, access: { ...previous.access, [key]: value } }));

  const currentAddress = () => run(async () => {
    const point = await getPosition(); setLocation(point); setOriginPoint(point); updateAreaFor(point);
    setAppointment(previous => ({ ...previous, origin: `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}` }));
    setNavigation(null);
    setLocationMessage(`Location found (accuracy about ${Math.round(point.accuracy)} m). Confirm the nearby address.`);
    const found = await api(`/api/v1/locations/reverse?latitude=${point.latitude}&longitude=${point.longitude}`);
    setAppointment(previous => ({ ...previous, origin: found.address }));
    setMessage(found.notice);
  });

  const toggleTracking = () => {
    if (tracking) {
      navigator.geolocation.clearWatch(watchId.current); watchId.current = null;
      setTracking(false); setLocationMessage("Location tracking stopped; the marker shows your last known position."); return;
    }
    if (!window.isSecureContext || !navigator.geolocation) {
      setError("Live location needs HTTPS or localhost and location permission. You can choose a map point instead."); return;
    }
    setError(""); setTracking(true); setLocationMessage("Finding your location…");
    watchId.current = navigator.geolocation.watchPosition(({ coords, timestamp }) => {
      setLocation({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy });
      setLocationMessage(`GPS accuracy about ${Math.round(coords.accuracy)} m · updated ${new Date(timestamp).toLocaleTimeString("en-GB")}`);
    }, failure => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null; setTracking(false);
      setError(failure.code === 1 ? "Location permission declined. Choose a starting address instead." : "GPS is unavailable. Check your connection or try again.");
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  };

  const upload = event => {
    const file = event.target.files?.[0]; if (!file) return;
    setFilename(file.name); setConfirmed(false);
    run(async () => {
      const form = new FormData(); form.append("file", file);
      const extracted = await api("/api/v1/appointments/extract", { method: "POST", body: form });
      const details = extracted.details;
      const matched = hospitals.find(hospital => hospital.name.replace(/ \(demo\)$/, "").toLowerCase() === details.hospital?.toLowerCase());
      setAppointment(previous => ({ ...previous,
        hospital_id: matched?.id || "",
        department: details.department || "",
        date: details.appointment_date || "",
        arrival: details.arrival_time?.slice(0, 5) || "",
      }));
      setExtractionWarnings([...details.warnings,
        ...(details.hospital && !matched ? [`Extracted hospital: ${details.hospital}. Select a supported hospital explicitly.`] : []),
        ...(!details.arrival_time ? [`Arrival time was not supplied. Appointment time: ${details.appointment_time || "unknown"}. Please enter your required arrival time.`] : []),
      ]);
      setModel(`Extraction completed: ${extracted.model}`);
      setMessage("Letter read. Check every field before continuing.");
    });
  };

  const buildAgentRequest = () => {
    const needs = profileNeeds(profile);
    const { use_model, ...extras } = agentExtras;
    return {
      origin_id: areaId,
      appointment: { hospital_id: AGENT_HOSPITAL, department: appointment.department,
        arrive_by: londonArrival(appointment.date, appointment.arrival), confirmed_by_user: true },
      needs: { ...needs, ...extras,
        max_gradient_pct: needs.max_gradient_pct === "" ? null : Number(needs.max_gradient_pct),
        extra_minutes: Math.min(120, Number(needs.extra_minutes) || 0) },
      disruptions: [], use_model,
    };
  };
  const selectedDisruptions = () => (agentCtx?.scenarios || [])
    .filter(scenario => activeScenarios.includes(scenario.id)).flatMap(scenario => scenario.disruptions);
  const setBothDrafts = draft => { setAgentDraft(draft); setSupportDraft({ subject: draft.subject, body: draft.body }); };

  const agentReassess = () => run(async () => {
    if (!agentRequest) throw new Error("Plan a journey first.");
    setAgentPlan(await reassessJourney(agentRequest, selectedDisruptions())); setAgentDraft(null);
  });
  const agentMakeDraft = kind => run(async () => {
    const disruptions = selectedDisruptions();
    const location = disruptions.find(item => item.type === "pavement_blocked")?.description;
    const draft = await draftMessage({ kind, request: { ...agentRequest, disruptions }, location: location || null, use_model: agentRequest.use_model });
    setBothDrafts(draft); setReviewed(false);
  });

  const planJourney = () => run(async () => {
    if (!confirmed) throw new Error("Confirm your appointment details on page 1 first.");
    const request = buildAgentRequest();
    const result = await planWithAgent(request);
    setAgentPlan(result); setAgentRequest(request); setActiveScenarios([]); setAgentDraft(null); setSupportDraft(null);
    const hospital = agentCtx?.hospital;
    if (hospital?.lat) changeDestination({ latitude: hospital.lat, longitude: hospital.lon, label: `${result.entrance.name}, ${hospital.name}` });
    setStep(3);
  });


  const search = kind => run(async () => {
    setSearchKind(kind);
    const query = kind === "origin" ? appointment.origin : destinationQuery;
    if (query.trim().length < 3) throw new Error("Enter an address or place name first.");
    const results = await api(`/api/v1/locations/search?q=${encodeURIComponent(query)}`);
    setSearchResults(results);
    if (!results.length) throw new Error("No matching location found. Try a more complete address or use the map.");
  });

  const getDirections = () => run(async () => {
    const start = tracking ? location : originPoint;
    if (!start || !destination) throw new Error("Choose a starting point and destination first.");
    const result = await api("/api/v1/navigation/route", { method: "POST", body: JSON.stringify({
      origin: { latitude: start.latitude, longitude: start.longitude },
      destination: { latitude: destination.latitude, longitude: destination.longitude }, access: profile.access,
    }) });
    setNavigation(result); setNavigationIndex(0);
  });

  const saveProfile = () => run(async () => {
    if (!signedIn) { setMessage("Your preferences apply to this visit. Sign in or create an account to save them."); return; }
    const saved = await api("/api/v1/profile", { method: "PUT", body: JSON.stringify(profile) });
    setProfile(saved); setMessage("Your profile and journey preferences have been saved.");
  });

  const saveAppointment = () => run(async () => {
    if (!signedIn) throw new Error("Sign in to save your appointment.");
    await api("/api/v1/workspace", { method: "PATCH", body: JSON.stringify({ appointment }) });
    setMessage("Appointment details saved to your account. The uploaded image and live GPS position are not stored.");
  });

  const deleteAppointment = () => run(async () => {
    await api("/api/v1/workspace", { method: "PATCH", body: JSON.stringify({ appointment: null }) });
    setAppointment(initialAppointment()); setConfirmed(false); setFilename(""); setExtractionWarnings([]);
    setSupportDraft(null); setMessage("Saved appointment removed.");
  });

  const authenticate = event => {
    event.preventDefault();
    run(async () => {
      const body = authMode === "register" ? { ...profile, password } : { email: profile.email, password };
      const result = await api(`/api/v1/auth/${authMode}`, { method: "POST", body: JSON.stringify(body) });
      setProfile(result); setSignedIn(true); setPassword(""); setPage("profile");
      const saved = await api("/api/v1/workspace");
      setAppointment(saved.appointment || { ...initialAppointment(), hospital_id: result.default_hospital_id, origin: result.default_starting_address || "" });
      setConfirmed(false); setSupportDraft(null);
      setMessage(authMode === "register" ? "Account created. Your preferences are saved." : "You are signed in.");
    });
  };

  return <>
    <header className="nhs-header py-3 px-3 mb-3">
      <div className="max-w-wide mx-auto d-flex flex-wrap justify-content-between align-items-center gap-2">
        <div><h1 className="h4 mb-1">AccessRoute AI Journey Planner</h1><span className="small">Accessible journeys to the Royal Hallamshire Hospital, planned by a local AI agent on NVIDIA DGX Spark · hackathon prototype</span></div>
        <span className="spark-badge">API: {health ? "Online" : "Connecting"} · Letter model: {model} · AI agent: {agentStatus}</span>
      </div>
    </header>
    <div className="app-container-wide px-3">
      <nav className="account-nav" aria-label="Main navigation">{[["journey", "Your journey"], ["profile", "Profile"], ["settings", "Settings"], ["auth", signedIn ? "Account" : "Sign in / Register"]].map(([id, label]) => <button key={id} type="button" className={`btn ${page === id ? "btn-primary" : "btn-outline-primary"}`} aria-current={page === id ? "page" : undefined} onClick={() => openPage(id)}>{label}</button>)}</nav>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}
      {busy && <p className="alert alert-info" role="status">Working… Please wait.</p>}

      {page === "auth" && <section className="card shadow-sm"><div className="card-body">
        {signedIn ? <><h2 className="h4">You are signed in</h2><p>{profile.first_name} {profile.last_name} · {profile.email}</p><button className="btn btn-outline-danger btn-accessible" disabled={busy} onClick={() => run(async () => {
          await api("/api/v1/auth/logout", { method: "POST" }); setSignedIn(false); setProfile(emptyProfile()); setPassword(""); setSupportDraft(null);
          setAppointment(initialAppointment()); setConfirmed(false); setFilename(""); setExtractionWarnings([]); setNavigation(null); setLocation(null); setOriginPoint(null); setDestination(null);
          if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
          watchId.current = null; setTracking(false); setLocationMessage("");
          setMessage("Signed out. Saved preferences and appointments remain in your account.");
        })}>Sign out</button></> : <>
          <h2 className="h4">{authMode === "register" ? "Create your profile" : "Welcome back"}</h2>
          <p>Save your access needs so you do not have to enter them for each journey. Use fictional details for this prototype.</p>
          <div className="d-flex gap-2 mb-3">{["register", "login"].map(mode => <button key={mode} type="button" className={`btn ${authMode === mode ? "btn-primary" : "btn-outline-primary"}`} onClick={() => { setAuthMode(mode); setError(""); }}>{mode === "register" ? "Register" : "Sign in"}</button>)}</div>
          <form onSubmit={authenticate}>
            {authMode === "register" && <div className="row"><div className="col-sm-6"><Field label="First name"><input required autoComplete="given-name" className="form-control form-control-lg-accessible" value={profile.first_name} onChange={e => changeProfileField("first_name", e.target.value)} /></Field></div><div className="col-sm-6"><Field label="Surname"><input required autoComplete="family-name" className="form-control form-control-lg-accessible" value={profile.last_name} onChange={e => changeProfileField("last_name", e.target.value)} /></Field></div></div>}
            <Field label="Email"><input required type="email" autoComplete="email" className="form-control form-control-lg-accessible" value={profile.email} onChange={e => changeProfileField("email", e.target.value)} /></Field>
            <Field label={authMode === "register" ? "Password (at least 10 characters)" : "Password"}><input required type="password" minLength={authMode === "register" ? 10 : 1} autoComplete={authMode === "register" ? "new-password" : "current-password"} className="form-control form-control-lg-accessible" value={password} onChange={e => setPassword(e.target.value)} /></Field>
            {authMode === "register" && <><NeedsForm profile={profile} setProfile={setProfile} presets={presets} /><Field label="Usual hospital"><select className="form-select form-select-lg-accessible" value={profile.default_hospital_id} onChange={e => changeProfileField("default_hospital_id", e.target.value)}><option value="royal-hallamshire">Royal Hallamshire Hospital</option></select></Field></>}
            <button disabled={busy} className="btn btn-primary btn-accessible w-100">{authMode === "register" ? "Create account" : "Sign in"}</button>
          </form><button type="button" className="btn btn-link mt-2" onClick={() => openPage("journey")}>Continue without an account</button>
        </>}
      </div></section>}

      {page === "profile" && <section className="card shadow-sm"><div className="card-body"><h2 className="h4">Your profile</h2>
        <p>{signedIn ? "Edit your details and save your changes." : "Guest preferences last for this visit. Create an account to save them."}</p>
        <form onSubmit={event => { event.preventDefault(); saveProfile(); }}>
          <Field label="First name"><input required={signedIn} className="form-control form-control-lg-accessible" value={profile.first_name} onChange={e => changeProfileField("first_name", e.target.value)} /></Field>
          <Field label="Surname"><input required={signedIn} className="form-control form-control-lg-accessible" value={profile.last_name} onChange={e => changeProfileField("last_name", e.target.value)} /></Field>
          <Field label="Email"><input type="email" required={signedIn} className="form-control form-control-lg-accessible" value={profile.email} onChange={e => changeProfileField("email", e.target.value)} /></Field>
          <Field label="Usual starting address (optional)"><input autoComplete="street-address" maxLength={500} className="form-control form-control-lg-accessible" value={profile.default_starting_address || ""} onChange={e => changeProfileField("default_starting_address", e.target.value)} /></Field>
          <Field label="Usual hospital"><select className="form-select form-select-lg-accessible" value={profile.default_hospital_id} onChange={e => changeProfileField("default_hospital_id", e.target.value)}><option value="royal-hallamshire">Royal Hallamshire Hospital</option></select></Field>
          <NeedsForm profile={profile} setProfile={setProfile} presets={presets} />
          <button className="btn btn-primary btn-accessible w-100" disabled={busy}>Save profile</button>
        </form>
      </div></section>}

      {page === "settings" && <section className="card shadow-sm"><div className="card-body">
        <h2 className="h4">Journey settings</h2><p>Optional details for you or someone helping you plan. These are planning preferences, not measured personal limits.</p>
        <form onSubmit={event => { event.preventDefault(); saveProfile(); }}>
          {[["max_continuous_walking_m", "Distance before a rest (metres)", 0, 10000], ["max_total_walking_m", "Total walking / wheeling distance (metres)", 0, 20000], ["boarding_buffer_minutes", "Extra allowance per vehicle boarding (minutes)", 0, 30], ["min_transfer_minutes", "Minimum time to change services (minutes)", 0, 120], ["max_gradient_percent", "Preferred maximum slope (%)", 0, 15]].map(([key, label, min, max]) => <Field key={key} label={label}><input required type="number" min={min} max={max} step={key === "max_gradient_percent" ? "0.5" : "1"} className="form-control form-control-lg-accessible" value={profile.access[key] ?? ""} onChange={e => updateAccess(key, e.target.value === "" ? "" : Number(e.target.value))} /></Field>)}
          <div className="d-flex flex-wrap gap-2"><button type="submit" disabled={busy} className="btn btn-primary btn-accessible">Save settings</button><button type="button" className="btn btn-outline-primary" onClick={() => setProfile(previous => ({ ...previous, access: presets?.[previous.mobility_aid] || presetFor(previous.mobility_aid) }))}>Reset suggested preferences</button></div>
        </form>
        <details className="mt-4"><summary>Where do these suggestions come from?</summary><p className="mt-2">DfT Inclusive Mobility §3.4 gives average distances without a rest: 150 m for wheelchair users, 50 m for stick/cane users and 100 m for mobility impairment without a stick. These vary between people. We use the stick/cane preset provisionally for walking frames too.</p><p>§4.3 prefers level routes and suggests gradients no steeper than 1:20 (5%) where level access is not feasible. This is infrastructure guidance, not a guarantee that 5% is suitable for you.</p><p>The 3-minute boarding allowance, 10-minute transfer margin, total-distance cap and no-aid preset are editable app assumptions. They are not official wheelchair standards.</p><a target="_blank" rel="noreferrer" href="https://www.gov.uk/government/publications/inclusive-mobility-making-transport-accessible-for-passengers-and-pedestrians">Read Department for Transport guidance</a></details>
        <hr /><h3 className="h5">Local model on Spark</h3><p>Model status: <strong>{model}</strong></p>
        <button className="btn btn-outline-primary" disabled={busy} onClick={() => run(async () => { const status = await api("/health/model"); setModel(`Available: ${status.model}`); setMessage("Server and model are available. Test a synthetic letter to confirm image support."); })}>Check model connection</button>
        <h3 className="h5 mt-4">AI journey agent (Nemotron)</h3><p>Status: <strong>{agentStatus}</strong></p>
        <button className="btn btn-outline-primary" disabled={busy} onClick={() => run(async () => { const warm = await warmUpModel(); setAgentStatus(`Available: ${warm.model}`); setMessage(`${warm.model} loaded on the Spark in ${warm.load_seconds}s and kept loaded for ${warm.keep_alive}.`); })}>Warm up the AI agent</button>
        <p className="small text-muted mt-2">The server administrator configures the Spark endpoint and model. Appointment images go to that configured model server. Location lookup and live directions use external providers.</p>
      </div></section>}

      {page === "journey" && <>
        <nav className="journey-tabs" aria-label="Journey steps">{["1. Appointment", "2. Access needs", "3. Plan & map", "4. Support", "Staff demo"].map((label, index) => <button key={label} className={`btn ${step === index + 1 ? "btn-primary" : "btn-outline-secondary"}`} aria-current={step === index + 1 ? "step" : undefined} onClick={() => setStep(index + 1)}>{label}</button>)}</nav>

        {step === 1 && <section className="card shadow-sm"><div className="card-body"><h2 className="h4">Your appointment</h2><p>Upload a photograph, or enter the details yourself. The initial date and department below are examples.</p>
          <Field label="Appointment letter (JPEG or PNG, up to 10 MB)"><input className="form-control" type="file" accept="image/jpeg,image/png" disabled={busy} onChange={upload} /></Field>
          {filename && <p className="small">Selected: {filename}</p>}{extractionWarnings.length > 0 && <ul className="alert alert-warning">{extractionWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
          <form onSubmit={event => { event.preventDefault(); if (confirmed) setStep(2); }}>
            <Field label="Hospital"><select required className="form-select form-select-lg-accessible" value={appointment.hospital_id} onChange={e => changeAppointment("hospital_id", e.target.value)}><option value="">Choose a hospital</option>{(hospitals.length ? hospitals : [{ id: AGENT_HOSPITAL, name: "Royal Hallamshire Hospital" }]).map(hospital => <option key={hospital.id} value={hospital.id}>{hospital.name}</option>)}</select></Field>
            <Field label="Department / clinic"><input required maxLength={150} className="form-control form-control-lg-accessible" value={appointment.department} onChange={e => changeAppointment("department", e.target.value)} /></Field>
            <div className="row"><div className="col-sm-6"><Field label="Appointment date"><input required type="date" className="form-control form-control-lg-accessible" value={appointment.date} onChange={e => changeAppointment("date", e.target.value)} /></Field></div><div className="col-sm-6"><Field label="Required arrival time (UK time)"><input required type="time" className="form-control form-control-lg-accessible" value={appointment.arrival} onChange={e => changeAppointment("arrival", e.target.value)} /></Field></div></div>
            <Field label="Starting address"><input required autoComplete="street-address" className="form-control form-control-lg-accessible" placeholder="Enter your address or use your location" value={appointment.origin} onChange={e => changeAppointment("origin", e.target.value)} /></Field>
            <button type="button" className="btn btn-outline-primary btn-accessible w-100 mb-2" disabled={busy} onClick={currentAddress}>Use my current location</button>
            <p className="small text-muted">With your permission, your coordinates are sent to OpenStreetMap / Nominatim once to find a nearby address. Check it before continuing.</p>
            {locationMessage && <p className="small" role="status">{locationMessage}</p>}
            {<Field label="Starting area with checked route data (used by the AI agent)"><select className="form-select form-select-lg-accessible" value={areaId} onChange={e => { setAreaId(e.target.value); setAreaNote(""); setAgentPlan(null); }}>{(agentCtx?.origins || [{ id: "walkley", name: "Walkley (S6)" }]).map(area => <option key={area.id} value={area.id}>{area.name}</option>)}</select></Field>}
            {areaNote && <p className="small" role="status">{areaNote}</p>}
            <label className="need-toggle"><input required type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I have checked the hospital, date and arrival time.</label>
            {signedIn ? <div className="d-flex flex-wrap gap-2 mb-3"><button type="button" disabled={busy} className="btn btn-outline-primary" onClick={saveAppointment}>Save appointment to my account</button><button type="button" disabled={busy} className="btn btn-outline-danger" onClick={deleteAppointment}>Remove saved appointment</button></div> : <p className="small"><button type="button" className="btn btn-link p-0" onClick={() => openPage("auth")}>Sign in</button> to save appointment details across visits.</p>}
            <button className="btn btn-primary btn-accessible w-100" disabled={busy}>Continue to access needs →</button>
          </form>
        </div></section>}

        {step === 2 && <section className="card shadow-sm"><div className="card-body"><h2 className="h4">What would help on your journey?</h2><p>{signedIn ? "We have filled these in from your profile. Change them for this journey if needed." : "Choose what applies to you. We will suggest the detailed settings."}</p>
          <NeedsForm profile={profile} setProfile={setProfile} presets={presets} />
          <label className="need-toggle"><input type="checkbox" checked={profile.access.max_continuous_walking_m <= 50} onChange={e => {
            const distance = e.target.checked ? 50 : (presets?.[profile.mobility_aid] || presetFor(profile.mobility_aid)).max_continuous_walking_m;
            setProfile(previous => ({ ...previous, access: { ...previous.access, max_continuous_walking_m: distance, max_total_walking_m: distance * 2 } }));
          }} /> I prefer very short distances and frequent rests</label>
          <label className="need-toggle"><input type="checkbox" checked={profile.access.boarding_buffer_minutes > 3} onChange={e => updateAccess("boarding_buffer_minutes", e.target.checked ? 5 : profile.access.wheelchair_user ? 3 : 0)} /> Give me extra time to get on and off</label>
          {<fieldset className="mb-3"><legend className="h6 mt-2">For this Royal Hallamshire journey</legend>
            {AGENT_EXTRAS.map(([key, label]) => <label key={key} className="need-toggle"><input type="checkbox" checked={agentExtras[key]} onChange={e => setAgentExtras(previous => ({ ...previous, [key]: e.target.checked }))} /> {label}</label>)}
          </fieldset>}
          <button className="btn btn-link mb-3" onClick={() => openPage("settings")}>Change detailed journey settings</button>
          <button className="btn btn-primary btn-accessible w-100 mb-2" disabled={busy} onClick={planJourney}>{busy ? "The AI agent is checking weather, roadworks, trams, buses and events…" : "Plan my journey →"}</button>
          <button className="btn btn-outline-secondary btn-accessible w-100" onClick={() => setStep(1)}>Back to appointment</button>
        </div></section>}

        {step === 3 && <div className="d-flex flex-column gap-3">
          {agentPlan
            ? <section aria-label="AI journey plan"><AgentResults plan={agentPlan} scenarios={agentCtx?.scenarios || []} active={activeScenarios}
                onToggle={id => setActiveScenarios(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])}
                onReassess={agentReassess} onDraft={agentMakeDraft} busy={busy ? "working" : ""} draft={agentDraft} setDraft={setBothDrafts} /></section>
            : <p className="alert alert-info">Confirm your appointment and choose “Plan my journey” to get the AI agent's plan.</p>}
          <section className="card shadow-sm"><div className="card-body"><h2 className="h4">Map and outdoor directions</h2>
            <p>Your blue marker moves as your device reports a new location. Directions are requested separately; they do not automatically replan.</p>
            <button className="btn btn-primary btn-accessible mb-2" onClick={toggleTracking}>{tracking ? "Stop live location" : "Start live location"}</button>
            {locationMessage && <p role="status" className="small">{locationMessage}</p>}
            <p className="small text-muted">GPS tracking stays in this browser. Map tiles use OpenStreetMap. Route and address requests send coordinates or the entered address to the named provider.</p>
            <LiveJourneyMap location={location || originPoint} destination={destination} geometry={navigation?.geometry} onDestination={changeDestination} focus={focus} roadOverlay={roadOverlay} />
            <div className="mt-3"><p className="small">Starting address: {appointment.origin || "Not chosen"}</p><button className="btn btn-outline-primary" disabled={busy} onClick={() => search("origin")}>Find starting address on map</button></div>
            <Field label="Destination address or hospital entrance"><input className="form-control form-control-lg-accessible" placeholder="Search, or tap an entrance on the map" value={destinationQuery} onChange={e => setDestinationQuery(e.target.value)} /></Field>
            <button className="btn btn-outline-primary mb-2" disabled={busy} onClick={() => search("destination")}>Find destination</button>
            {searchResults.length > 0 && <ul className="list-unstyled">{searchResults.map((item, index) => <li key={index}><button className="btn btn-light border text-start w-100 my-1" onClick={() => {
              if (searchKind === "origin") {
                if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
                watchId.current = null; setTracking(false); setLocationMessage("Using the selected starting address.");
                setOriginPoint(item); updateAreaFor(item); setLocation(null); setNavigation(null); setAppointment(previous => ({ ...previous, origin: item.label }));
              }
              else changeDestination(item);
              setSearchResults([]);
            }}>{item.label}</button></li>)}</ul>}
            {destination && <p className="small">Destination: {destination.label}. <strong>Confirm the exact entrance; search results may be a building centre.</strong></p>}
            <button className="btn btn-primary btn-accessible w-100" disabled={busy || !destination} onClick={getDirections}>Get / refresh wheelchair directions</button>
            {!health?.live_navigation_configured && <p className="small text-muted mt-2">GPS is available independently. Directions require an openrouteservice key configured on the backend.</p>}
            {navigation && <div className="mt-3"><p className="alert alert-info small">{navigation.notice} Provider slope limit applied: {navigation.applied_max_gradient_percent}% (rounded down where necessary).</p><p><strong>{Math.round(navigation.distance_m)} m</strong> · approximately {Math.ceil(navigation.duration_seconds / 60)} minutes · {navigation.provider}</p>
              {navigation.warnings.map((warning, index) => <p className="alert alert-warning" key={index}>{warning}</p>)}
              {navigation.provider_warnings?.length > 0 && <p className="alert alert-warning">The routing provider returned additional warnings: {navigation.provider_warnings.map(item => typeof item === "string" ? item : item.message || JSON.stringify(item)).join("; ")}</p>}
              <ol className="navigation-steps">{navigation.steps.map((item, index) => <li key={index}><button className={`step-instruction ${index === navigationIndex ? "current-instruction" : ""}`} onClick={() => { setNavigationIndex(index); setFocus(item.coordinate); }} aria-current={index === navigationIndex ? "step" : undefined}>{item.instruction}<small>{Math.round(item.distance_m)} m</small></button></li>)}</ol>
              <button className="btn btn-outline-primary" disabled={navigationIndex >= navigation.steps.length - 1} onClick={() => { const next = navigationIndex + 1; setNavigationIndex(next); setFocus(navigation.steps[next]?.coordinate); }}>Mark current step complete</button>
            </div>}
          </div></section>
          <LiveConditions onRoadsGeoJson={setRoadOverlay} />
          <details className="card p-3"><summary>Advanced: inspect demonstration GeoJSON layers</summary><p className="alert alert-warning small mt-2">These hand-authored Royal Hallamshire overlays are separate fictional examples, not a computed route or verified LiDAR/access survey. They do not follow your live position.</p><AdvancedMap geojsonData={geoJson} onImportGeoJson={setGeoJson} focusTarget={null} showDisruption={false} /></details>
        </div>}

        {step === 4 && <section className="card shadow-sm"><div className="card-body"><h2 className="h4">Travel support</h2><p>Review the simulated disruption and prepare a message. No request is sent from this prototype.</p>
          {supportDraft ? <><Field label="Subject"><input className="form-control" value={supportDraft.subject} onChange={e => setSupportDraft(previous => ({ ...previous, subject: e.target.value }))} /></Field><Field label="Message draft"><textarea rows={14} className="form-control" value={supportDraft.body} onChange={e => setSupportDraft(previous => ({ ...previous, body: e.target.value }))} /></Field><button className="btn btn-primary btn-accessible" onClick={() => run(async () => { await navigator.clipboard.writeText(`${supportDraft.subject}\n\n${supportDraft.body}`); setMessage("Draft copied. Choose the recipient and review it before sending."); })}>Copy draft</button></> : <button className="btn btn-outline-primary" onClick={() => setStep(3)}>Go to step 3: simulate a problem, re-plan, and choose a draft</button>}
        </div></section>}

        {step === 5 && <section className="card shadow-sm"><div className="card-body"><span className="badge bg-warning text-dark mb-2">Staff view · local demonstration only</span><h2 className="h4">Travel-support review</h2><p>This preview does not notify hospital staff, dispatch vehicles or send messages.</p>
          {supportDraft ? <><h3 className="h5">{profile.first_name || "Demo patient"} · {appointment.department}</h3><p>Status: {reviewed ? "Marked reviewed in this browser" : "Awaiting review in this browser"}</p><pre className="draft-preview">{supportDraft.body}</pre><button className="btn btn-primary btn-accessible" onClick={() => setReviewed(true)} disabled={reviewed}>Mark demo case reviewed</button></> : <p>No draft yet. Complete the journey and support example first.</p>}
        </div></section>}
      </>}
      <footer className="py-4 small text-muted">Independent hackathon prototype · not an NHS service. Use synthetic letters and account details. Travel accessibility and assistance availability require confirmation.</footer>
    </div>
  </>;
}
