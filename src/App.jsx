import { useState, useEffect } from "react";
import "./App.css";

// Automatically uses the IP from your .env file, or localhost as a fallback
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const INITIAL_SAMPLE_DATA = {
  extraction: {
    patientName: "Margaret Davies (Age 67)",
    origin: "42 South Road, Walkley, S6 3TA",
    hospital: "Royal Hallamshire Hospital",
    department: "Neuro-Rehabilitation Outpatients (Floor C)",
    date: "Monday, 16 Nov 2026",
    arrivalTime: "10:30 AM",
    entrance: "B Road Step-Free Outpatient Entrance",
    modelUsed: "Ollama VLM on DGX Spark (Local)",
  },
  accessNeeds: {
    mobilityAid: "powered_wheelchair",
    stepFree: true,
    maxGradient: "1:12",
    maxDistanceMeters: 150,
    transferBufferMins: 15,
  },
  routes: [
    {
      id: "route-a",
      name: "Walkley via Howard Rd & Commonside",
      gradient: "1-in-8 (12.5%)",
      distance: "420m",
      status: "REJECTED",
      reason: "Steep 1-in-8 hill on Howard Rd is unsafe for a powered wheelchair.",
    },
    {
      id: "demo-direct",
      name: "Stagecoach Bus 95 (South Rd → Glossop Rd)",
      gradient: "1-in-20 (5.0%)",
      distance: "95m",
      status: "RECOMMENDED",
      leaveTime: "09:35 AM",
      reason: "Avoids steep Walkley valleys; stops 50m from B-Road step-free entrance.",
    },
  ],
  steps: [
    {
      time: "09:35 AM",
      title: "Leave Home (42 South Rd, Walkley)",
      detail: "Roll 45m along level pavement (max 3% slope) to South Rd / Fir St stop.",
    },
    {
      time: "09:42 AM",
      title: "Take Bus 95 towards City Centre",
      detail: "Request driver boarding ramp. Alight at Glossop Rd / Beech Hill Rd.",
    },
    {
      time: "10:00 AM",
      title: "Use B-Road Step-Free Entrance",
      detail: "Roll 50m down Beech Hill Rd. Avoid main Glossop Rd steps. Take Lift 2 to Floor C (includes +15m transfer buffer).",
    },
  ],
  verifiedFacts: [
    " Avoids 1-in-8 slopes (Sheffield terrain verified under 1-in-20)",
    " Stagecoach 95 operates low-floor buses with wheelchair ramps",
    " Royal Hallamshire B-Road entrance is step-free with lift to Floor C",
  ],
  unknowns: [
    " Live wheelchair bay occupancy on the 09:42 bus is not in public feeds",
    " Unannounced temporary pavement parking/works on Beech Hill Rd",
  ],
  toolResults: [
    "check_gradient('S6 3TA', 'S10 2JF') → Rejected Howard Rd (1:8 slope)",
    "query_transit('Bus_95') → Low-floor verified, 14 min journey",
    "verify_entrance('RHH_B_Road') → Step-free, Lift C active",
  ],
  disruption: {
    time: "09:15 AM",
    location: "Beech Hill Rd / Glossop Rd Footway",
    alert:
      "Unannounced utility roadworks & pavement parking have closed the pavement between the Bus 95 stop and B-Road Entrance (width < 0.7m, no dropped-kerb bypass).",
    reassessmentLog: [
      "❌ Alternative Stop 1 (Clarkehouse Rd): Requires 1-in-8 (12.5%) uphill slope on Newbould Ln. Violates Margaret's 1:12 slope limit.",
      "❌ Alternative Stop 2 (Westbourne Rd): Requires 290m outdoor roll. Violates Margaret's 150m distance limit.",
      "⚠️ RESULT: No safe public transport route remains. Auto-drafting Hospital Travel Support Request.",
    ],
    supportDraft: {
      to: "RHH Patient Access & Transport Team (Neurology Floor C)",
      patient: "Margaret Davies (67) — Appt Today 10:30 AM",
      summary:
        "Powered wheelchair user in Walkley (S6 3TA). Standard routes blocked by 1-in-8 gradients; Bus 95 alighting route on Beech Hill Rd blocked by live pavement roadworks.",
      actionRequested:
        "Dispatch wheelchair-accessible door-to-door transport to 42 South Rd (S6 3TA) for direct drop-off at B-Road Outpatient Bay.",
    },
  },
};

export default function App() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [data, setData] = useState(INITIAL_SAMPLE_DATA);
  const [taxiApproved, setTaxiApproved] = useState(false);
  
  // Connection statuses for the header
  const [apiStatus, setApiStatus] = useState("Checking...");
  const [modelStatus, setModelStatus] = useState("Checking...");
  const [hospitals, setHospitals] = useState([]);

  // 1. App Startup: Ping Health, Model, and Hospitals on load
  useEffect(() => {
    // GET /health
    fetch(`${API_BASE}/health`)
      .then(res => res.ok ? setApiStatus("Online") : setApiStatus("Error"))
      .catch(() => setApiStatus("Offline"));

    // GET /health/model
    fetch(`${API_BASE}/health/model`)
      .then(res => res.ok ? setModelStatus("Connected") : setModelStatus("Error"))
      .catch(() => setModelStatus("Offline"));

    // GET /api/v1/hospitals
    fetch(`${API_BASE}/api/v1/hospitals`)
      .then(res => res.json())
      .then(data => setHospitals(data.hospitals || []))
      .catch(() => console.warn("Using simulated hospitals"));
  }, []);

  // 2. Upload Letter: POST /api/v1/appointments/extract
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file.name);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API_BASE}/api/v1/appointments/extract`, {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const extracted = await res.json();
        setData((prev) => ({
          ...prev,
          extraction: { ...prev.extraction, ...extracted },
        }));
      }
    } catch {
      // Fallback to sample data if FastAPI fails
      console.warn("VLM Extraction failed, falling back to sample data");
    } finally {
      setTimeout(() => setLoading(false), 500);
    }
  };

  // 3. Plan Journey: POST /api/v1/journeys/plan
  const handlePlanJourney = async () => {
    setLoading(true);
    try {
      const payload = {
        origin_id: "demo-home", 
        appointment: {
          hospital_id: "northern-general-demo", 
          department: data.extraction.department,
          arrive_by: "2026-11-16T10:30:00+00:00",
          confirmed_by_user: true
        },
        access: { step_free_required: data.accessNeeds.stepFree }
      };

      const res = await fetch(`${API_BASE}/api/v1/journeys/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const journeyData = await res.json();
        // Update data state with live backend responses here in Sprint 2/3
        console.log("Planned Journey:", journeyData);
      }
    } catch {
       console.warn("Journey planning failed, falling back to sample data");
    } finally {
      setLoading(false);
      setStep(3);
    }
  };

  // 4. Replan & Support Draft: POST /api/v1/journeys/reassess AND POST /api/v1/support/draft
  const handleSimulateDisruption = async () => {
    setLoading(true);
    try {
      const payload = {
        journey: {
          origin_id: "demo-home",
          appointment: {
            hospital_id: "northern-general-demo",
            department: data.extraction.department,
            arrive_by: "2026-11-16T10:30:00+00:00",
            confirmed_by_user: true
          },
          access: { step_free_required: data.accessNeeds.stepFree }
        },
        disruption: {
          unavailable_route_ids: ["demo-direct"],
          delay_minutes_by_route: {}
        },
        earliest_departure: "2026-11-16T08:00:00+00:00"
      };

      // Call Reassess Route
      const res = await fetch(`${API_BASE}/api/v1/journeys/reassess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      
      // Call Support Draft Route
      const draftRes = await fetch(`${API_BASE}/api/v1/support/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (draftRes.ok) {
        const supportDraft = await draftRes.json();
        console.log("Generated Support Draft:", supportDraft);
      }
    } catch {
       console.warn("Disruption reassessment failed, falling back to sample data");
    } finally {
      setLoading(false);
      setStep(4);
    }
  };

  const updateExtraction = (field, value) => {
    setData((prev) => ({
      ...prev,
      extraction: { ...prev.extraction, [field]: value },
    }));
  };

  const updateAccess = (field, value) => {
    setData((prev) => ({
      ...prev,
      accessNeeds: { ...prev.accessNeeds, [field]: value },
    }));
  };

  return (
    <div>
      {/* Top NHS-style Header */}
      <header className="nhs-header py-3 px-3 shadow-sm mb-3">
        <div className="d-flex justify-content-between align-items-center max-w-wide mx-auto">
          <div>
            <span className="badge bg-white text-primary fw-bold me-2">NHS</span>
            <span className="fw-bold fs-5">AccessRoute Sheffield</span>
            <div className="small text-white-50 mt-1">
               API: <span className={apiStatus === "Online" ? "text-info" : "text-warning"}>{apiStatus}</span> | 
               Model: <span className={modelStatus === "Connected" ? "text-info" : "text-warning"}>{modelStatus}</span>
            </div>
          </div>
          <span className="spark-badge">⚡ Local DGX Spark + Ollama</span>
        </div>
      </header>

      <main
        className={`px-3 ${
          step === 5 ? "app-container-wide" : "app-container-mobile"
        }`}
      >
        {/* Step Progress Indicator */}
        <div className="d-flex justify-content-between align-items-center mb-3 bg-white p-2 rounded-3 shadow-sm border">
          <span className="fw-bold text-primary small">
            {step === 1 && "Step 1 of 4: Appointment Letter"}
            {step === 2 && "Step 2 of 4: Your Access Needs"}
            {step === 3 && "Step 3 of 4: Accessible Journey Plan"}
            {step === 4 && "Step 4 of 4: Disruption & Support"}
            {step === 5 && "Hospital Staff Prototype View"}
          </span>
          <span className="badge bg-secondary">Persona: Margaret, 67</span>
        </div>

        {/* ================= SCREEN 1: LETTER UPLOAD ================= */}
        {step === 1 && (
          <div className="d-flex flex-column gap-3">
            <div className="card border-0 shadow-sm">
              <div className="card-body">
                <span className="badge bg-success-subtle text-success border border-success-subtle mb-2">
                  🔒 Private Local Vision Model
                </span>
                <h2 className="h5 fw-bold">1. Upload Appointment Letter</h2>
                <p className="text-muted small mb-3">
                  Take a photo or upload your NHS letter. Our local AI extracts
                  your clinic and matches the right step-free entrance.
                </p>

                <label className="btn btn-outline-primary btn-accessible w-100 mb-2">
                  📷 {selectedFile ? `Loaded: ${selectedFile}` : "Upload or Take Photo of Letter"}
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={handleFileUpload}
                    hidden
                  />
                </label>

                {loading && (
                  <div className="alert alert-info py-2 small mb-0">
                    Reading appointment letter with local Ollama VLM...
                  </div>
                )}
              </div>
            </div>

            {/* Extracted Details */}
            <div className="card border-0 shadow-sm">
              <div className="card-body">
                <h3 className="h6 fw-bold text-primary mb-3">
                  Confirm Extracted Details
                </h3>

                <div className="mb-3">
                  <label className="form-label-accessible">Hospital</label>
                  <input
                    className="form-control form-control-lg-accessible"
                    value={data.extraction.hospital}
                    onChange={(e) => updateExtraction("hospital", e.target.value)}
                  />
                </div>

                <div className="mb-3">
                  <label className="form-label-accessible">Department / Clinic</label>
                  <input
                    className="form-control form-control-lg-accessible"
                    value={data.extraction.department}
                    onChange={(e) => updateExtraction("department", e.target.value)}
                  />
                </div>

                <div className="row g-2 mb-3">
                  <div className="col-7">
                    <label className="form-label-accessible">Date</label>
                    <input
                      className="form-control form-control-lg-accessible"
                      value={data.extraction.date}
                      onChange={(e) => updateExtraction("date", e.target.value)}
                    />
                  </div>
                  <div className="col-5">
                    <label className="form-label-accessible">Arrival Time</label>
                    <input
                      className="form-control form-control-lg-accessible"
                      value={data.extraction.arrivalTime}
                      onChange={(e) => updateExtraction("arrivalTime", e.target.value)}
                    />
                  </div>
                </div>

                <div className="mb-3">
                  <label className="form-label-accessible">Starting Address</label>
                  <input
                    className="form-control form-control-lg-accessible"
                    value={data.extraction.origin}
                    onChange={(e) => updateExtraction("origin", e.target.value)}
                  />
                </div>

                <button
                  onClick={() => setStep(2)}
                  className="btn btn-primary btn-accessible w-100"
                >
                  Confirm Details & Set Access Needs →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= SCREEN 2: ACCESS REQUIREMENTS ================= */}
        {step === 2 && (
          <div className="card border-0 shadow-sm">
            <div className="card-body">
              <h2 className="h5 fw-bold mb-1">2. Practical Access Needs</h2>
              <p className="text-muted small mb-3">
                Tell us what barriers to avoid on Sheffield’s hills and streets.
              </p>

              <div className="mb-3">
                <label className="form-label-accessible">Mobility Aid</label>
                <select
                  className="form-select form-select-lg-accessible"
                  value={data.accessNeeds.mobilityAid}
                  onChange={(e) => updateAccess("mobilityAid", e.target.value)}
                >
                  <option value="powered_wheelchair">Powered Wheelchair (Post-Stroke)</option>
                  <option value="manual_wheelchair">Manual Wheelchair</option>
                  <option value="rollator">Walking Frame / Rollator</option>
                </select>
              </div>

              <div className="mb-3">
                <label className="form-label-accessible">Max Safe Hill Steepness</label>
                <select
                  className="form-select form-select-lg-accessible"
                  value={data.accessNeeds.maxGradient}
                  onChange={(e) => updateAccess("maxGradient", e.target.value)}
                >
                  <option value="1:12">Avoid Steep Hills — Block 1-in-8 (12.5%)</option>
                  <option value="1:15">Flat / Gentle Slopes Only (Max 1-in-15)</option>
                </select>
              </div>

              <div className="mb-3">
                <label className="form-label-accessible">Max Distance Between Stops (Metres)</label>
                <input
                  type="number"
                  className="form-control form-control-lg-accessible"
                  value={data.accessNeeds.maxDistanceMeters}
                  onChange={(e) => updateAccess("maxDistanceMeters", Number(e.target.value))}
                />
              </div>

              <div className="mb-3">
                <label className="form-label-accessible">Extra Time Needed for Ramps (Minutes)</label>
                <input
                  type="number"
                  className="form-control form-control-lg-accessible"
                  value={data.accessNeeds.transferBufferMins}
                  onChange={(e) => updateAccess("transferBufferMins", Number(e.target.value))}
                />
              </div>

              <div className="form-check form-switch mb-4 p-3 bg-light rounded-3 border">
                <input
                  className="form-check-input ms-0 me-3"
                  type="checkbox"
                  role="switch"
                  id="stepFreeSwitch"
                  checked={data.accessNeeds.stepFree}
                  onChange={(e) => updateAccess("stepFree", e.target.checked)}
                  style={{ transform: "scale(1.4)" }}
                />
                <label className="form-check-label fw-bold" htmlFor="stepFreeSwitch">
                  Require 100% Step-Free & Dropped Kerbs
                </label>
              </div>

              <button onClick={handlePlanJourney} className="btn btn-primary btn-accessible w-100 mb-2">
                {loading ? "Planning..." : "Plan My Accessible Journey →"}
              </button>
              <button onClick={() => setStep(1)} className="btn btn-outline-secondary btn-accessible w-100">
                ← Back
              </button>
            </div>
          </div>
        )}

        {/* ================= SCREEN 3: JOURNEY PLAN ================= */}
        {step === 3 && (
          <div className="d-flex flex-column gap-3">
            <div className="card border-success border-2 shadow-sm">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <span className="badge bg-success">RECOMMENDED ROUTE</span>
                  <span className="fw-bold text-success">Max Slope: 1-in-20</span>
                </div>
                <h2 className="h4 fw-bold mb-1">Leave Home at 09:35 AM</h2>
                <p className="small text-muted mb-0">
                  Arrives at Royal Hallamshire <strong>B-Road Entrance</strong> by
                  10:05 AM (includes +15m buffer).
                </p>
              </div>
            </div>

            <div className="card border-0 shadow-sm">
              <div className="card-body">
                <h3 className="h6 fw-bold mb-3">Step-by-Step Journey</h3>
                {data.steps.map((s, idx) => (
                  <div key={idx} className="p-3 mb-2 bg-light rounded-3 border-start border-4 border-primary">
                    <div className="fw-bold text-primary">{s.time} — {s.title}</div>
                    <div className="small mt-1">{s.detail}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card border-0 shadow-sm">
              <div className="card-body">
                <h3 className="h6 fw-bold mb-2">Why Other Routes Were Rejected</h3>
                <div className="table-responsive">
                  <table className="table table-sm align-middle small mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Route</th>
                        <th>Slope</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.routes.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <div className="fw-bold">{r.name}</div>
                            <div className="text-muted" style={{ fontSize: "0.78rem" }}>{r.reason}</div>
                          </td>
                          <td className="fw-bold">{r.gradient}</td>
                          <td>
                            <span className={`badge ${r.status === "RECOMMENDED" ? "bg-success" : "bg-danger"}`}>
                              {r.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <button onClick={handleSimulateDisruption} className="btn btn-danger btn-accessible w-100 shadow">
              {loading ? "Reassessing..." : "🚨 Simulate Live Pavement Disruption →"}
            </button>
          </div>
        )}

        {/* ================= SCREEN 4: DISRUPTION & SUPPORT ================= */}
        {step === 4 && (
          <div className="d-flex flex-column gap-3">
            <div className="alert alert-danger border-2 border-danger shadow-sm mb-0">
              <div className="badge bg-danger mb-1">LIVE BARRIER ALERT — {data.disruption.time}</div>
              <h2 className="h5 fw-bold mb-1">Blocked Pavement: {data.disruption.location}</h2>
              <p className="small mb-0">{data.disruption.alert}</p>
            </div>

            <div className="card border-0 shadow-sm">
              <div className="card-body">
                <h3 className="h6 fw-bold mb-2">Agent Reassessment Against Margaret’s Profile</h3>
                {data.disruption.reassessmentLog.map((item, idx) => (
                  <div key={idx} className="p-2 mb-2 bg-light rounded border font-monospace small">
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="card border-primary border-2 shadow-sm">
              <div className="card-body">
                <span className="badge bg-primary mb-2">FALLBACK ACTION READY</span>
                <h3 className="h5 fw-bold">Drafted Hospital Travel Support Request</h3>
                <div className="p-3 bg-light rounded-3 border small mb-3">
                  <div className="mb-1"><strong>To:</strong> {data.disruption.supportDraft.to}</div>
                  <div className="mb-1"><strong>Patient:</strong> {data.disruption.supportDraft.patient}</div>
                  <div className="mb-1"><strong>Access Barrier:</strong> {data.disruption.supportDraft.summary}</div>
                  <div><strong>Requested Support:</strong> <span className="fw-bold text-primary">{data.disruption.supportDraft.actionRequested}</span></div>
                </div>

                <button onClick={() => setStep(5)} className="btn btn-success btn-accessible w-100">
                  Send Request & Open Staff Dashboard →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= SCREEN 5: STAFF DASHBOARD ================= */}
        {step === 5 && (
          <div className="d-flex flex-column gap-3">
            <div className="card border-0 shadow-sm bg-dark text-white">
              <div className="card-body d-flex flex-wrap justify-content-between align-items-center gap-2">
                <div>
                  <span className="badge bg-info text-dark fw-bold mb-1">ROYAL HALLAMSHIRE HOSPITAL</span>
                  <h2 className="h4 fw-bold mb-0">Patient Access Intervention Dashboard</h2>
                </div>
              </div>
            </div>

            <div className="card border-danger border-2 shadow-sm">
              <div className="card-body">
                <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
                  <div>
                    <span className="badge bg-danger me-2">URGENT INTERVENTION NEEDED</span>
                    <span className="badge bg-secondary">Appt: Today 10:30 AM</span>
                    <h3 className="h5 fw-bold mt-2 mb-0">Margaret Davies (67) — Neuro-Rehab Outpatients (Floor C)</h3>
                  </div>
                  <span className={`badge fs-6 ${taxiApproved ? "bg-success" : "bg-warning text-dark"}`}>
                    {taxiApproved ? "✅ Taxi Dispatched (ETA 09:45)" : "⏳ Awaiting Staff Approval"}
                  </span>
                </div>

                <div className="row g-3 mb-3">
                  <div className="col-md-6">
                    <div className="p-3 bg-danger-subtle rounded-3 h-100">
                      <div className="fw-bold text-danger-emphasis mb-1">Barriers Detected:</div>
                      <ul className="small mb-0 ps-3">
                        <li><strong>Steep Hills:</strong> Walkley routes exceed 1-in-8 gradient limit.</li>
                        <li><strong>Live Closure:</strong> Beech Hill Rd footway blocked by works.</li>
                      </ul>
                    </div>
                  </div>
                  <div className="col-md-6">
                    <div className="p-3 bg-success-subtle rounded-3 h-100">
                      <div className="fw-bold text-success-emphasis mb-1">Suggested Follow-Up:</div>
                      <ul className="small mb-0 ps-3">
                        <li>Dispatch accessible taxi to 42 South Rd (S6 3TA).</li>
                        <li>Drop-off at B-Road Step-Free Outpatient Bay.</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="d-flex flex-wrap gap-2">
                  <button
                    onClick={() => setTaxiApproved(true)}
                    disabled={taxiApproved}
                    className="btn btn-success btn-accessible px-4"
                  >
                    {taxiApproved ? "✅ SMS Sent to Margaret" : "✅ Approve Wheelchair Taxi"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Nav */}
      <nav className="step-nav-bar">
        <div className="d-flex justify-content-center gap-1 max-w-wide mx-auto">
          {[
            { id: 1, label: "1. Letter" },
            { id: 2, label: "2. Access" },
            { id: 3, label: "3. Route" },
            { id: 4, label: "4. Alert" },
            { id: 5, label: "5. Staff" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStep(tab.id)}
              className={`btn btn-sm fw-bold flex-fill py-2 ${step === tab.id ? "btn-primary" : "btn-outline-secondary"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}