import { useState, useEffect, useRef } from "react";
import "./App.css";
import ListenBar, { ListenButton } from "./tts/ListenBar";
import {
  IconAlertTriangle,
  IconFileText,
  IconMap,
  IconWheelchair,
} from "@tabler/icons-react";
import HelpButton from "./emergency/HelpButton";
import StaffAlerts from "./emergency/StaffAlerts";
import {
  alertScript,
  appointmentScript,
  routeStepScript,
  screenScript,
} from "./tts/screenScripts";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// Live Roads API Configuration
const LIVE_ROADS_KEY = import.meta.env.VITE_LIVEROADS_KEY || "";

// WMO Weather Code Decoder for Open-Meteo
function decodeWmoWeather(code) {
  const map = {
    0: { label: "Clear sky", icon: "☀️", wet: false },
    1: { label: "Mainly clear", icon: "🌤️", wet: false },
    2: { label: "Partly cloudy", icon: "⛅", wet: false },
    3: { label: "Overcast", icon: "☁️", wet: false },
    45: { label: "Foggy", icon: "🌫️", wet: false },
    48: { label: "Freezing fog", icon: "🌫️", wet: true },
    51: { label: "Light drizzle", icon: "🌦️", wet: true },
    53: { label: "Moderate drizzle", icon: "🌦️", wet: true },
    55: { label: "Dense drizzle", icon: "🌧️", wet: true },
    61: { label: "Slight rain", icon: "🌧️", wet: true },
    63: { label: "Moderate rain", icon: "🌧️", wet: true },
    65: { label: "Heavy rain", icon: "⛈️", wet: true },
    71: { label: "Slight snow", icon: "❄️", wet: true },
    73: { label: "Moderate snow", icon: "❄️", wet: true },
    75: { label: "Heavy snow", icon: "❄️", wet: true },
    80: { label: "Rain showers", icon: "🌦️", wet: true },
    81: { label: "Heavy showers", icon: "🌧️", wet: true },
    95: { label: "Thunderstorm", icon: "⛈️", wet: true },
  };
  return map[code] || { label: `Weather code ${code}`, icon: "🌥️", wet: false };
}

// Background theme for the weather card, like a phone weather app.
// For visual testing only, add ?weatherTheme=rain (sun, night, cloud, fog, rain, snow, storm).
function weatherTheme(code, isDay) {
  try {
    const forced = new URLSearchParams(window.location.search).get("weatherTheme");
    if (forced) return forced;
  } catch {
    /* ignore */
  }
  if ([95, 96, 99].includes(code)) return "storm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if (code === 45 || code === 48) return "fog";
  if (code === 2 || code === 3) return "cloud";
  return isDay === 0 ? "night" : "sun";
}

// Decorative animated layer (rain drops, snowflakes, stars, clouds). Hidden from screen readers.
function WeatherEffects({ theme }) {
  const counts = { rain: 40, storm: 50, snow: 30, night: 25, cloud: 4, fog: 3 };
  const n = counts[theme] || 0;
  const kind = theme === "storm" ? "rain" : theme;
  return (
    <div className={`weather-fx weather-fx-${theme}`} aria-hidden="true">
      {theme === "sun" && <span className="wx-sun" />}
      {theme === "storm" && <span className="wx-flash" />}
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className={`wx-${kind}`}
          style={{
            left: `${(i * 37) % 100}%`,
            top: kind === "night" ? `${(i * 53) % 90}%` : undefined,
            animationDelay: `${((i * 0.29) % 2).toFixed(2)}s`,
            animationDuration:
              kind === "snow"
                ? `${4 + (i % 5)}s`
                : kind === "rain"
                ? `${0.6 + (i % 4) * 0.12}s`
                : undefined,
          }}
        />
      ))}
    </div>
  );
}

// Standard QGIS GeoJSON FeatureCollection (CRS: EPSG:4326 / WGS84)
const INITIAL_QGIS_GEOJSON = {
  type: "FeatureCollection",
  name: "sheffield_hospital_access_qgis",
  crs: {
    type: "name",
    properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" },
  },
  features: [
    {
      type: "Feature",
      properties: {
        fid: 101,
        layer: "safe_corridor",
        name: "Stagecoach 95 Accessible Corridor (A57 Glossop Rd)",
        max_gradient: "1:20 (5.0%)",
        roll_dist_m: 95,
        surface: "Tarmac / Raised Kerb",
        status: "RECOMMENDED",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-1.5008, 53.3934],
          [-1.4992, 53.3928],
          [-1.5028, 53.3912],
          [-1.5018, 53.3862],
          [-1.4982, 53.3812],
          [-1.4942, 53.3792],
          [-1.4934, 53.3782],
        ],
      },
    },
    {
      type: "Feature",
      properties: {
        fid: 102,
        layer: "steep_gradient_hazard",
        name: "Howard Rd / Commonside Steep Valley",
        max_gradient: "1:8 (12.5%)",
        roll_dist_m: 420,
        surface: "Steep Camber Footway",
        status: "REJECTED_SLOPE",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-1.5008, 53.3934],
          [-1.4972, 53.3912],
          [-1.4952, 53.3895],
          [-1.4935, 53.3845],
          [-1.4934, 53.3782],
        ],
      },
    },
    {
      type: "Feature",
      properties: {
        fid: 201,
        layer: "steep_gradient_hazard",
        name: "QGIS DEM Slope > 12% (1-in-8 Hazard Polygon)",
        max_gradient: "12.5% (1:8)",
        source: "Sheffield LiDAR 1m DTM",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-1.498, 53.3908],
            [-1.4935, 53.3908],
            [-1.4935, 53.3878],
            [-1.498, 53.3878],
            [-1.498, 53.3908],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: {
        fid: 301,
        layer: "key_nodes",
        node_type: "home",
        icon: "🏠",
        color: "#005eb8",
        name: "Origin: 42 South Rd, Walkley (S6 3TA)",
        gradient: "3.0% (Level Footway)",
        notes: "45m roll to South Rd / Fir St bus stop.",
      },
      geometry: {
        type: "Point",
        coordinates: [-1.5008, 53.3934],
      },
    },
    {
      type: "Feature",
      properties: {
        fid: 302,
        layer: "key_nodes",
        node_type: "bus",
        icon: "🚌",
        color: "#16a34a",
        name: "Stop: South Rd / Fir St (Bus 95)",
        gradient: "2.5% (Raised Boarding Kerb)",
        notes: "Low-floor wheelchair ramp verified.",
      },
      geometry: {
        type: "Point",
        coordinates: [-1.4992, 53.3928],
      },
    },
    {
      type: "Feature",
      properties: {
        fid: 303,
        layer: "key_nodes",
        node_type: "hospital",
        icon: "🏥",
        color: "#15803d",
        name: "Destination: RHH B-Road Outpatient Entrance",
        gradient: "0.0% (Level Automatic Doors)",
        notes: "Step-free access • Direct Lift 2 to Neurology Floor C.",
      },
      geometry: {
        type: "Point",
        coordinates: [-1.4934, 53.3782],
      },
    },
  ],
};

const INITIAL_SAMPLE_DATA = {
  extraction: {
    patientName: "Margaret Davies (Age 67)",
    origin: "42 South Road, Walkley, S6 3TA",
    hospital: "Royal Hallamshire Hospital",
    department: "Neuro-Rehabilitation Outpatients (Floor C)",
    date: "Monday, 16 Nov 2026",
    arrivalTime: "10:30 AM",
    entrance: "B Road Step-Free Outpatient Entrance",
  },
  accessNeeds: {
    mobilityAid: "powered_wheelchair",
    stepFree: true,
    maxGradient: "1:12",
    maxDistanceMeters: 150,
    transferBufferMins: 15,
  },
  steps: [
    {
      id: "step-1",
      time: "09:35 AM",
      icon: "🏠",
      title: "Leave Home (42 South Rd, Walkley)",
      detail: "Roll 45m along level pavement (max 3% slope) to South Rd / Fir St stop.",
      coord: [53.3934, -1.5008],
    },
    {
      id: "step-2",
      time: "09:42 AM",
      icon: "🚌",
      title: "Board Bus 95 towards City Centre",
      detail: "Low-floor wheelchair ramp verified. Alight at Glossop Rd / Beech Hill Rd.",
      coord: [53.3928, -1.4992],
    },
    {
      id: "step-3",
      time: "10:00 AM",
      icon: "🏥",
      title: "Enter via B-Road Step-Free Entrance",
      detail: "Roll 50m down Beech Hill Rd. Avoid main Glossop Rd steps. Take Lift 2 to Floor C.",
      coord: [53.3782, -1.4934],
    },
  ],
  verifiedFacts: [
    "Avoids 1-in-8 slopes (QGIS LiDAR DTM slope verified under 1-in-20)",
    "Stagecoach 95 operates low-floor buses with wheelchair ramps",
    "Royal Hallamshire B-Road entrance is step-free with lift to Floor C",
  ],
  unknowns: [
    "Live wheelchair bay occupancy on the 09:42 bus is not in public feeds",
    "Local council footway parking outside trunk road network is not in national feeds",
  ],
  disruption: {
    time: "09:15 AM",
    location: "Beech Hill Rd / A57 Glossop Rd Approach",
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

// Live Weather Widget (Open-Meteo API)
function LiveWeatherBanner({ weather, onRefresh, loadingWeather }) {
  if (!weather) {
    return (
      <div className="weather-card shadow-sm d-flex justify-content-between align-items-center">
        <span className="small">🌦️ Loading live Sheffield weather (Open-Meteo)...</span>
      </div>
    );
  }

  const wmo = decodeWmoWeather(weather.weather_code);
  const isSlipperyOrWet = wmo.wet || weather.precipitation > 0;
  const isColdBatteryRisk = weather.temperature_2m <= 5;
  const theme = weatherTheme(weather.weather_code, weather.is_day);

  return (
    <div className={`weather-card weather-${theme} shadow-sm`}>
      <WeatherEffects theme={theme} />
      <div className="d-flex justify-content-between align-items-start gap-2">
        <div>
          <span className="badge bg-info text-dark fw-bold mb-1">
            Sheffield weather now
          </span>
          <div className="d-flex align-items-center gap-2 mt-1">
            <span className="fs-3">{wmo.icon}</span>
            <div>
              <div className="fw-bold fs-5">
                {weather.temperature_2m}°C{" "}
                <span className="fs-6 fw-normal text-white-50">
                  (Feels {weather.apparent_temperature}°C) • {wmo.label}
                </span>
              </div>
              <div className="small text-white-50">
                Rain: {weather.precipitation} mm • Wind: {weather.wind_speed_10m} km/h
                (gusts {weather.wind_gusts_10m} km/h)
              </div>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loadingWeather}
          className="btn btn-sm btn-outline-light py-1 px-2"
          style={{ fontSize: "0.72rem" }}
        >
          {loadingWeather ? "..." : "↻ Refresh"}
        </button>
      </div>

      {/* Wheelchair Mobility Weather Impact */}
      <div className="mt-2 pt-2 border-top border-secondary small">
        {isSlipperyOrWet ? (
          <div className="text-warning fw-bold">
            ⚠️ Wet pavements: wheelchair brakes grip less on slopes. We will keep you
            off steep hills.
          </div>
        ) : (
          <div className="text-info">
            ✅ Dry pavements: normal grip for your wheelchair on this route.
          </div>
        )}
        {isColdBatteryRisk && (
          <div className="text-warning small mt-1">
            🔋 Cold today ({Math.round(weather.temperature_2m)}°C): wheelchair batteries can
            run down faster, especially uphill. Charge fully before you leave.
          </div>
        )}
        <div className="text-white-50 mt-1" style={{ fontSize: "0.75rem" }}>
          Weather data: Open-Meteo
        </div>
      </div>
    </div>
  );
}

// Live Roads Public API Panel (with Mandatory Attribution & Original Source Credits)
function LiveRoadsPanel({
  roadIncidents,
  roadMetaLicence,
  roadFilter,
  setRoadFilter,
  onRefreshRoads,
  loadingRoads,
  roadError,
  onPlotIncidentOnMap,
}) {
  return (
    <details className="map-options">
      <summary>
        Roadworks and closures nearby
        {roadIncidents?.length ? ` (${roadIncidents.length})` : ""}
      </summary>
    <div className="liveroads-card shadow-sm">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
        <div>
          <span className="badge bg-warning text-dark fw-bold me-2">
            🛣️ Live Roads
          </span>
          <span className="fw-bold small">Roadworks, closures and incidents</span>
        </div>

        <div className="d-flex gap-1">
          <select
            value={roadFilter}
            onChange={(e) => setRoadFilter(e.target.value)}
            className="form-select form-select-sm"
            style={{ fontSize: "0.75rem", width: "auto" }}
          >
            <option value="A57,M1,A61,A628">Sheffield Approaches (A57/M1/A61)</option>
            <option value="M1">M1 Corridor (Sheffield / South Yorks)</option>
            <option value="M25">M25 (Live API Test Feed)</option>
            <option value="ALL">All Active UK Trunk Incidents</option>
          </select>
          <button
            type="button"
            onClick={onRefreshRoads}
            disabled={loadingRoads}
            className="btn btn-sm btn-outline-primary py-1 px-2"
            style={{ fontSize: "0.75rem" }}
          >
            {loadingRoads ? "Loading..." : "↻"}
          </button>
        </div>
      </div>

      {roadError && (
        <div className="alert alert-warning py-1 px-2 small mb-2">
          {roadError}
        </div>
      )}

      {/* Incident List */}
      {roadIncidents.length === 0 ? (
        <div className="p-2 bg-light rounded border small text-muted mb-2">
          No active trunk road closures reported on <strong>{roadFilter}</strong> right
          now. (Note: Local council pavements are monitored via our local Sheffield
          barrier layer).
        </div>
      ) : (
        <div
          className="d-flex flex-column gap-2 mb-2"
          style={{ maxHeight: "220px", overflowY: "auto" }}
        >
          {roadIncidents.slice(0, 6).map((inc, idx) => {
            // Preserve the original source credit that comes with each record
            const originalSourceCredit =
              inc.source ||
              inc.credit ||
              inc.authority ||
              inc.highway_authority ||
              inc.organisation ||
              inc.publisher ||
              "Official Transport Data Feed (National Highways / DfT)";

            return (
              <div
                key={inc.id || idx}
                className="p-2 bg-light rounded-3 border-start border-4 border-warning small"
              >
                <div className="d-flex justify-content-between align-items-start gap-2">
                  <div>
                    <span className="badge bg-dark me-1">
                      {inc.road || "UK Road"}
                    </span>
                    <span className="badge bg-danger-subtle text-danger border border-danger-subtle me-1">
                      {inc.type || inc.closure || "Incident"}
                    </span>
                    <strong>{inc.title || inc.location || "Road Restriction"}</strong>
                  </div>
                  {inc.lat && inc.lng && (
                    <button
                      type="button"
                      onClick={() => onPlotIncidentOnMap([inc.lat, inc.lng])}
                      className="btn btn-sm btn-outline-dark py-0 px-1"
                      style={{ fontSize: "0.7rem" }}
                    >
                      📍 Map
                    </button>
                  )}
                </div>

                {inc.description && (
                  <div className="text-muted mt-1" style={{ fontSize: "0.76rem" }}>
                    {inc.description}
                  </div>
                )}

                {/* Mandatory Original Source Credit per Record */}
                <div
                  className="text-secondary fst-italic mt-1"
                  style={{ fontSize: "0.71rem" }}
                >
                  Source credit: {originalSourceCredit}
                  {inc.updated_at || inc.updated
                    ? ` • Updated: ${inc.updated_at || inc.updated}`
                    : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Mandatory Live Roads Attribution Footer */}
      <div className="liveroads-attribution d-flex flex-wrap justify-content-between align-items-center gap-1">
        <div>
          <strong>
            Data:{" "}
            <a
              href="https://liveroads.co.uk"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary fw-bold text-decoration-underline"
            >
              Live Roads
            </a>
          </strong>{" "}
          (
          <a
            href="https://liveroads.co.uk"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted"
          >
            liveroads.co.uk
          </a>
          )
        </div>
        <div className="text-muted" style={{ fontSize: "0.7rem" }}>
          {roadMetaLicence ||
            "Contains National Highways, Traffic Wales, Traffic Scotland & DfT BODS data (Open Government Licence)."}
        </div>
      </div>
    </div>
    </details>
  );
}

// QGIS Web GIS Component
function QgisWebMap({
  geojsonData,
  liveRoadsGeoJson,
  onImportGeoJson,
  focusTarget,
  showDisruption,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const fittedRef = useRef(false);

  const [basemap, setBasemap] = useState("clean");
  const [visibleLayers, setVisibleLayers] = useState({
    safe_corridor: true,
    steep_gradient_hazard: true,
    key_nodes: true,
    live_roads_api: true,
  });
  const [selectedFeatureProps, setSelectedFeatureProps] = useState(null);

  useEffect(() => {
    const L = window.L;
    if (!L || !mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [53.386, -1.4975],
        zoom: 14,
        zoomControl: false,
        scrollWheelZoom: false, // page scrolling must not zoom the map; use the +/- buttons
      });
      L.control.zoom({ position: "bottomright" }).addTo(map);
      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;
    map.eachLayer((layer) => map.removeLayer(layer));

    if (basemap === "clean") {
      // Clean, Google-style street map (Esri World Street Map, no key needed)
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 19,
          attribution:
            "Tiles © Esri — Source: Esri, HERE, Garmin, USGS, NGA, EPA, USDA, NPS | Data: Live Roads (liveroads.co.uk)",
        }
      ).addTo(map);
    } else if (basemap === "topo") {
      L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
        maxZoom: 17,
        attribution: "GIS: OpenTopoMap | Data: Live Roads (liveroads.co.uk)",
      }).addTo(map);
    } else {
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap | Data: Live Roads (liveroads.co.uk)",
      }).addTo(map);
    }

    // 1. Render Local QGIS GeoJSON Layers
    const activeFeatures = {
      ...geojsonData,
      features: geojsonData.features.filter(
        (f) => visibleLayers[f.properties?.layer] !== false
      ),
    };

    // White outline under route lines (Google Maps style), so they stand out on any base map
    L.geoJSON(
      {
        ...activeFeatures,
        features: activeFeatures.features.filter(
          (f) => f.geometry.type === "LineString"
        ),
      },
      {
        style: () => ({ color: "#ffffff", weight: 11, opacity: 0.95 }),
        interactive: false,
      }
    ).addTo(map);

    const routeLayer = L.geoJSON(activeFeatures, {
      style: (feature) => {
        if (feature.geometry.type === "Polygon") {
          return {
            color: "#dc2626",
            weight: 2,
            fillColor: "#ef4444",
            fillOpacity: 0.28,
            dashArray: "4, 4",
          };
        }
        if (feature.properties.layer === "steep_gradient_hazard") {
          return {
            color: "#dc2626",
            weight: 5,
            dashArray: "8, 8",
            opacity: 0.85,
          };
        }
        return {
          color: showDisruption ? "#f59e0b" : "#16a34a",
          weight: 7,
          opacity: 1,
        };
      },
      pointToLayer: (feature, latlng) => {
        const icon = feature.properties.icon || "📍";
        const bg = feature.properties.color || "#005eb8";
        return L.marker(latlng, {
          icon: L.divIcon({
            className: "",
            html: `<div class="custom-map-pin" style="background:${bg}">${icon}</div>`,
            iconSize: [34, 34],
            iconAnchor: [17, 17],
            popupAnchor: [0, -18],
          }),
        });
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties || {};
        layer.bindPopup(
          `<div style="font-size:12px">
            <b>${p.name || "QGIS Feature"}</b><br/>
            <span><b>Layer:</b> <code>${p.layer || "custom"}</code></span><br/>
            ${p.max_gradient ? `<span><b>Max Slope:</b> ${p.max_gradient}</span><br/>` : ""}
            ${p.gradient ? `<span><b>Slope:</b> ${p.gradient}</span><br/>` : ""}
            ${p.notes ? `<span>${p.notes}</span>` : ""}
          </div>`
        );
        layer.on("click", () => setSelectedFeatureProps(p));
      },
    }).addTo(map);

    // Start framed on the whole route (once), so it is readable without zooming
    const bounds = routeLayer.getBounds();
    if (!fittedRef.current && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      fittedRef.current = true;
    }

    // 2. Render Live Roads API GeoJSON Layer if available
    if (visibleLayers.live_roads_api && liveRoadsGeoJson?.features?.length) {
      L.geoJSON(liveRoadsGeoJson, {
        pointToLayer: (feature, latlng) =>
          L.marker(latlng, {
            icon: L.divIcon({
              className: "",
              html: `<div class="custom-map-pin" style="background:#d97706">⚠️</div>`,
              iconSize: [32, 32],
              iconAnchor: [16, 16],
            }),
          }),
        onEachFeature: (feature, layer) => {
          const p = feature.properties || {};
          const credit =
            p.source || p.credit || p.authority || "Official Transport Feed";
          layer.bindPopup(
            `<div style="font-size:12px">
              <b>${p.road || ""} ${p.title || "Live Road Incident"}</b><br/>
              <span>${p.description || ""}</span><br/>
              <small>Source: ${credit} • Data: <a href="https://liveroads.co.uk" target="_blank">Live Roads</a></small>
            </div>`
          );
        },
      }).addTo(map);
    }

    // 3. Add Live Beech Hill Rd Footway Closure Pin on Screen 4
    if (showDisruption) {
      L.marker([53.3787, -1.4938], {
        icon: L.divIcon({
          className: "",
          html: `<div class="custom-map-pin" style="background:#b91c1c">🚧</div>`,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        }),
      })
        .addTo(map)
        .bindPopup(
          "<b>Pavement blocked</b><br/>Beech Hill Road: the pavement is narrower than 0.7 m, with no way round."
        )
        .openPopup();
      map.setView([53.3787, -1.4938], 16);
    }
  }, [geojsonData, liveRoadsGeoJson, basemap, visibleLayers, showDisruption]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !focusTarget) return;
    map.flyTo(focusTarget.coord, focusTarget.zoom || 16, { duration: 0.7 });
  }, [focusTarget]);

  const toggleLayer = (key) => {
    setVisibleLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleGeoJsonUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        onImportGeoJson(parsed);
      } catch {
        alert("Invalid GeoJSON file. Export from QGIS as EPSG:4326 GeoJSON.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="d-flex flex-column gap-2">
      <div
        className="gmap-wrapper"
        role="region"
        aria-label="Map of your route. The steps below describe the same route in words."
      >
        <div ref={mapContainerRef} className="gmap-canvas" />
      </div>

      <details className="map-options">
        <summary>Map options and layers</summary>
      <div className="qgis-layer-panel">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <span className="fw-bold text-info">🗺️ Map style</span>
          <div className="btn-group btn-group-sm">
            <button
              type="button"
              onClick={() => setBasemap("clean")}
              className={`btn btn-sm py-0 px-2 ${
                basemap === "clean" ? "btn-info fw-bold" : "btn-outline-light"
              }`}
              style={{ fontSize: "0.72rem" }}
            >
              Simple
            </button>
            <button
              type="button"
              onClick={() => setBasemap("topo")}
              className={`btn btn-sm py-0 px-2 ${
                basemap === "topo" ? "btn-info fw-bold" : "btn-outline-light"
              }`}
              style={{ fontSize: "0.72rem" }}
            >
              Hills
            </button>
            <button
              type="button"
              onClick={() => setBasemap("osm")}
              className={`btn btn-sm py-0 px-2 ${
                basemap === "osm" ? "btn-info fw-bold" : "btn-outline-light"
              }`}
              style={{ fontSize: "0.72rem" }}
            >
              Detailed
            </button>
          </div>
        </div>

        <div className="d-flex flex-wrap gap-3 mb-2">
          <label className="d-flex align-items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={visibleLayers.safe_corridor}
              onChange={() => toggleLayer("safe_corridor")}
            />
            <span>🟢 Your route</span>
          </label>
          <label className="d-flex align-items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={visibleLayers.steep_gradient_hazard}
              onChange={() => toggleLayer("steep_gradient_hazard")}
            />
            <span>🔴 Steep hills</span>
          </label>
          <label className="d-flex align-items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={visibleLayers.live_roads_api}
              onChange={() => toggleLayer("live_roads_api")}
            />
            <span>⚠️ Roadworks</span>
          </label>
        </div>

        <div className="d-flex justify-content-between align-items-center pt-1 border-top border-secondary">
          <span className="text-white-50" style={{ fontSize: "0.72rem" }}>
            Tap anything on the map for details. Map data prepared in QGIS.
          </span>
          <label
            className="btn btn-sm btn-outline-info py-0 px-2"
            style={{ fontSize: "0.72rem" }}
          >
            📂 Load map file (staff)
            <input
              type="file"
              accept=".geojson,.json"
              onChange={handleGeoJsonUpload}
              hidden
            />
          </label>
        </div>
      </div>
      </details>

      {selectedFeatureProps && (
        <div className="p-2 bg-dark text-light rounded-3 border border-info small d-flex justify-content-between align-items-center">
          <div>
            <span className="qgis-attribute-badge me-2">
              FID: {selectedFeatureProps.fid || "Custom"}
            </span>
            <strong>{selectedFeatureProps.name}</strong>
            {selectedFeatureProps.max_gradient && (
              <span className="ms-2 text-warning">
                Slope: {selectedFeatureProps.max_gradient}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSelectedFeatureProps(null)}
            className="btn btn-sm btn-outline-light py-0 px-2"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [data, setData] = useState(INITIAL_SAMPLE_DATA);
  const [qgisGeoJson, setQgisGeoJson] = useState(INITIAL_QGIS_GEOJSON);
  const [taxiApproved, setTaxiApproved] = useState(false);

  const [activeStepId, setActiveStepId] = useState("step-1");
  const [mapFocus, setMapFocus] = useState(null);

  const [apiStatus, setApiStatus] = useState("Checking...");
  const [modelStatus, setModelStatus] = useState("Checking...");

  // Live Open-Meteo State
  const [weather, setWeather] = useState(null);
  const [loadingWeather, setLoadingWeather] = useState(false);

  // Live Roads API State
  const [roadFilter, setRoadFilter] = useState("A57,M1,A61,A628");
  const [roadIncidents, setRoadIncidents] = useState([]);
  const [liveRoadsGeoJson, setLiveRoadsGeoJson] = useState(null);
  const [roadMetaLicence, setRoadMetaLicence] = useState("");
  const [loadingRoads, setLoadingRoads] = useState(false);
  const [roadError, setRoadError] = useState("");

  // Fetch Live Weather for Sheffield (Royal Hallamshire / Walkley coordinates)
  const fetchSheffieldWeather = async () => {
    setLoadingWeather(true);
    try {
      const url =
        "https://api.open-meteo.com/v1/forecast?latitude=53.3782&longitude=-1.4934&current=temperature_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m,wind_gusts_10m,is_day&timezone=Europe%2FLondon";
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        setWeather(json.current);
      }
    } catch (err) {
      console.warn("Open-Meteo fetch failed:", err);
    } finally {
      setLoadingWeather(false);
    }
  };

  // Fetch Live Roads Incidents & GeoJSON (Uses Authorization: Bearer + URL key fallback)
  const fetchLiveRoadsData = async (selectedFilter = roadFilter) => {
    setLoadingRoads(true);
    setRoadError("");

    const roadParam =
      selectedFilter && selectedFilter !== "ALL"
        ? `road=${encodeURIComponent(selectedFilter)}&`
        : "";

    const queryPath = `/api/v1/incidents?${roadParam}status=active&key=${LIVE_ROADS_KEY}`;
    const geoJsonQueryPath = `/api/v1/incidents?${roadParam}status=active&format=geojson&key=${LIVE_ROADS_KEY}`;

    const headers = {
      Authorization: `Bearer ${LIVE_ROADS_KEY}`,
      Accept: "application/json",
    };

    try {
      // Try Vite local proxy first to avoid CORS, then direct URL if needed
      let res = await fetch(`/liveroads-api${queryPath}`, { headers }).catch(
        () => null
      );
      if (!res || !res.ok) {
        res = await fetch(`https://liveroads.co.uk${queryPath}`, { headers });
      }

      if (res && res.ok) {
        const payload = await res.json();
        const list = Array.isArray(payload)
          ? payload
          : payload.incidents || payload.data || payload.features || [];
        setRoadIncidents(list);
        if (payload.meta?.licence || payload.licence) {
          setRoadMetaLicence(payload.meta?.licence || payload.licence);
        }
      } else {
        throw new Error(`Status ${res?.status || "Network"}`);
      }

      // Also fetch GeoJSON format to drop directly onto the QGIS Map
      const geoRes = await fetch(`/liveroads-api${geoJsonQueryPath}`, {
        headers,
      }).catch(() => null);
      if (geoRes && geoRes.ok) {
        const geoData = await geoRes.json();
        if (geoData?.type === "FeatureCollection") {
          setLiveRoadsGeoJson(geoData);
        }
      }
    } catch {
      setRoadError(
        "Live feed note: Showing cached South Yorkshire / A57 / M1 snapshot."
      );
      setRoadIncidents([
        {
          id: "lr-shef-1",
          road: "A57",
          type: "roadworks",
          title: "A57 Glossop Rd / Beech Hill Rd Utility Works",
          description:
            "Temporary footway & carriageway incursion near Royal Hallamshire Hospital approach.",
          source:
            "Bus Open Data Service (DfT) / Sheffield StreetWorks · Open Government Licence",
          lat: 53.3787,
          lng: -1.4938,
        },
        {
          id: "lr-shef-2",
          road: "M1",
          type: "incident",
          title: "M1 J33 to J34 (Sheffield / Meadowhall)",
          description: "Lane restriction & slow traffic approaching Sheffield Parkway.",
          source:
            "National Highways · Powered by National Highways Transport Data Feeds (OGL)",
          lat: 53.4112,
          lng: -1.3985,
        },
      ]);
    } finally {
      setLoadingRoads(false);
    }
  };

  // App Startup: Ping Backend Health, Open-Meteo Weather, and Live Roads API
  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((res) => (res.ok ? setApiStatus("Online") : setApiStatus("Error")))
      .catch(() => setApiStatus("Offline"));

    fetch(`${API_BASE}/health/model`)
      .then((res) =>
        res.ok ? setModelStatus("Connected") : setModelStatus("Error")
      )
      .catch(() => setModelStatus("Offline"));

    fetch(`${API_BASE}/api/v1/hospitals`).catch(() => {});

    fetchSheffieldWeather();
    fetchLiveRoadsData(roadFilter);
  }, []);

  // Re-fetch Live Roads whenever user changes the road filter dropdown
  useEffect(() => {
    fetchLiveRoadsData(roadFilter);
  }, [roadFilter]);

  // Upload Letter: POST /api/v1/appointments/extract
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
      console.warn("VLM Extraction failed, falling back to sample data");
    } finally {
      setTimeout(() => setLoading(false), 500);
    }
  };

  // Plan Journey: POST /api/v1/journeys/plan
  const handlePlanJourney = async () => {
    setLoading(true);
    try {
      const payload = {
        origin_id: "demo-home",
        appointment: {
          hospital_id: "northern-general-demo",
          department: data.extraction.department,
          arrive_by: "2026-11-16T10:30:00+00:00",
          confirmed_by_user: true,
        },
        access: { step_free_required: data.accessNeeds.stepFree },
      };

      await fetch(`${API_BASE}/api/v1/journeys/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      console.warn("Journey planning using local Margaret scenario");
    } finally {
      setLoading(false);
      setStep(3);
    }
  };

  // Replan & Support Draft: POST /api/v1/journeys/reassess & /api/v1/support/draft
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
            confirmed_by_user: true,
          },
          access: { step_free_required: data.accessNeeds.stepFree },
        },
        disruption: {
          unavailable_route_ids: ["demo-direct"],
          delay_minutes_by_route: {},
        },
        earliest_departure: "2026-11-16T08:00:00+00:00",
      };

      await fetch(`${API_BASE}/api/v1/journeys/reassess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      await fetch(`${API_BASE}/api/v1/support/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      console.warn("Disruption reassessment using local Margaret scenario");
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
      {/* Top NHS Header */}
      <header className="nhs-header py-3 px-3 shadow-sm mb-3">
        <div className="d-flex justify-content-between align-items-center max-w-wide mx-auto">
          <div>
            <span className="badge bg-white text-primary fw-bold me-2">NHS</span>
            <span className="fw-bold fs-5">AccessRoute Sheffield</span>
            <div className="small text-white-50 mt-1">
              API:{" "}
              <span className={apiStatus === "Online" ? "text-info" : "text-warning"}>
                {apiStatus}
              </span>{" "}
              | Model:{" "}
              <span
                className={modelStatus === "Connected" ? "text-info" : "text-warning"}
              >
                {modelStatus}
              </span>
            </div>
          </div>
          <span className="spark-badge">⚡ Local DGX Spark + Live Feeds</span>
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
            {step === 1 && "Step 1 of 4: Your letter"}
            {step === 2 && "Step 2 of 4: Your needs"}
            {step === 3 && "Step 3 of 4: Your route"}
            {step === 4 && "Step 4 of 4: Route alert"}
            {step === 5 && "Hospital staff view"}
          </span>
          <span className="badge bg-secondary">Margaret, 67</span>
        </div>

        {/* Read-aloud controls: first control on every screen */}
        <ListenBar
          screenKey={step}
          script={screenScript(step, data, weather)}
          alertText={step === 4 ? alertScript(data) : ""}
        />

        {/* ================= SCREEN 1: LETTER UPLOAD ================= */}
        {step === 1 && (
          <div className="d-flex flex-column gap-3">
            <div className="card border-0 shadow-sm">
              <div className="card-body">
                <span className="badge bg-success-subtle text-success border border-success-subtle mb-2">
                  🔒 Private: read on our own computer, not online
                </span>
                <h2 className="h5 fw-bold">Add your appointment letter</h2>
                <p className="text-muted small mb-3">
                  Take a photo of your hospital letter. We will read the date, time
                  and clinic for you, and find the right step-free entrance.
                </p>

                <label className="btn btn-outline-primary btn-accessible w-100 mb-2">
                  📷{" "}
                  {selectedFile
                    ? `Loaded: ${selectedFile}`
                    : "Take or choose a photo of your letter"}
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={handleFileUpload}
                    hidden
                  />
                </label>

                {loading && (
                  <div className="alert alert-info py-2 small mb-0">
                    Reading your letter…
                  </div>
                )}
              </div>
            </div>

            <div className="card border-0 shadow-sm">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-center gap-2 mb-3">
                  <h3 className="h6 fw-bold text-primary mb-0">
                    Are these details right?
                  </h3>
                  <ListenButton
                    text={appointmentScript(data)}
                    label="Listen to details"
                  />
                </div>

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
                      onChange={(e) =>
                        updateExtraction("arrivalTime", e.target.value)
                      }
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
                  Yes, these are right →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= SCREEN 2: ACCESS REQUIREMENTS ================= */}
        {step === 2 && (
          <div className="card border-0 shadow-sm">
            <div className="card-body">
              <h2 className="h5 fw-bold mb-1">What do you need on your journey?</h2>
              <p className="text-muted small mb-3">
                We use this to avoid hills, steps and distances that do not work for
                you.
              </p>

              <div className="mb-3">
                <label className="form-label-accessible">How do you get around?</label>
                <select
                  className="form-select form-select-lg-accessible"
                  value={data.accessNeeds.mobilityAid}
                  onChange={(e) => updateAccess("mobilityAid", e.target.value)}
                >
                  <option value="powered_wheelchair">Powered wheelchair</option>
                  <option value="manual_wheelchair">Manual wheelchair</option>
                  <option value="rollator">Walking frame or rollator</option>
                </select>
              </div>

              <div className="mb-3">
                <label className="form-label-accessible">
                  How steep a hill can you manage?
                </label>
                <select
                  className="form-select form-select-lg-accessible"
                  value={data.accessNeeds.maxGradient}
                  onChange={(e) => updateAccess("maxGradient", e.target.value)}
                >
                  <option value="1:12">
                    Gentle slopes are fine, but no steep hills
                  </option>
                  <option value="1:15">Flat or very gentle slopes only</option>
                </select>
              </div>

              <div className="mb-3">
                <label className="form-label-accessible">
                  Furthest you can go without a rest (metres)
                </label>
                <input
                  type="number"
                  className="form-control form-control-lg-accessible"
                  value={data.accessNeeds.maxDistanceMeters}
                  onChange={(e) =>
                    updateAccess("maxDistanceMeters", Number(e.target.value))
                  }
                />
              </div>

              <div className="mb-3">
                <label className="form-label-accessible">
                  Extra time to get on and off buses and trams (minutes)
                </label>
                <input
                  type="number"
                  className="form-control form-control-lg-accessible"
                  value={data.accessNeeds.transferBufferMins}
                  onChange={(e) =>
                    updateAccess("transferBufferMins", Number(e.target.value))
                  }
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
                <label
                  className="form-check-label fw-bold"
                  htmlFor="stepFreeSwitch"
                >
                  I need step-free routes with dropped kerbs
                </label>
              </div>

              <button
                onClick={handlePlanJourney}
                className="btn btn-primary btn-accessible w-100 mb-2"
              >
                {loading ? "Finding your route…" : "Show my route →"}
              </button>
              <button
                onClick={() => setStep(1)}
                className="btn btn-outline-secondary btn-accessible w-100"
              >
                ← Back
              </button>
            </div>
          </div>
        )}

        {/* ================= SCREEN 3: LIVE WEATHER + LIVE ROADS + QGIS MAP ================= */}
        {step === 3 && (
          <div className="d-flex flex-column gap-3">
            {/* Journey summary first: the answer the patient needs */}
            <div className="card border-success border-2 shadow-sm">
              <div className="card-body py-3">
                <div className="d-flex justify-content-between align-items-center mb-1 gap-2">
                  <span className="badge bg-success">✅ Suits your needs</span>
                  <span className="fw-bold text-success small">
                    Gentle slopes only
                  </span>
                </div>
                <h2 className="h5 fw-bold mb-1">
                  Leave home at {data.steps[0]?.time} · Bus 95
                </h2>
                <p className="small text-muted mb-0">
                  We avoided the steep hill on Howard Road (1 in 8). It is shown in
                  red on the map.
                </p>
              </div>
            </div>

            {/* 1. Open-Meteo Live Weather & Wheelchair Traction Card */}
            <LiveWeatherBanner
              weather={weather}
              onRefresh={fetchSheffieldWeather}
              loadingWeather={loadingWeather}
            />

            {/* 2. QGIS Terrain & Route Map */}
            <QgisWebMap
              geojsonData={qgisGeoJson}
              liveRoadsGeoJson={liveRoadsGeoJson}
              onImportGeoJson={(newGeo) => setQgisGeoJson(newGeo)}
              focusTarget={mapFocus}
              showDisruption={false}
            />

            {/* 3. Live Roads Public API Conditions & Mandatory Attribution */}
            <LiveRoadsPanel
              roadIncidents={roadIncidents}
              roadMetaLicence={roadMetaLicence}
              roadFilter={roadFilter}
              setRoadFilter={setRoadFilter}
              onRefreshRoads={() => fetchLiveRoadsData(roadFilter)}
              loadingRoads={loadingRoads}
              roadError={roadError}
              onPlotIncidentOnMap={(coord) =>
                setMapFocus({ coord, zoom: 15 })
              }
            />

            <div className="card border-0 shadow-sm">
              <div className="card-body">
                <h3 className="h6 fw-bold mb-1">Your journey, step by step</h3>
                <p className="small text-muted mb-2">
                  Tap a step to see it on the map.
                </p>

                {data.steps.map((s, index) => (
                  <div
                    key={s.id}
                    onClick={() => {
                      setActiveStepId(s.id);
                      setMapFocus({ coord: s.coord, zoom: 16 });
                    }}
                    className={`p-3 mb-2 bg-light rounded-3 border-start border-4 border-primary step-card-interactive ${
                      activeStepId === s.id ? "step-card-active" : ""
                    }`}
                  >
                    <div className="d-flex justify-content-between align-items-center">
                      <div className="fw-bold text-primary">
                        {s.icon} {s.time} — {s.title}
                      </div>
                      <span className="badge bg-white text-primary border">
                        Show on map
                      </span>
                    </div>
                    <div className="small mt-1">{s.detail}</div>
                    <ListenButton
                      text={routeStepScript(s, index)}
                      label={`Listen to step ${index + 1}`}
                      className="mt-2"
                    />
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={handleSimulateDisruption}
              className="btn btn-danger btn-accessible w-100 shadow"
            >
              {loading
                ? "Checking your route…"
                : "Demo: simulate a blocked pavement →"}
            </button>
          </div>
        )}

        {/* ================= SCREEN 4: DISRUPTION MAP & SUPPORT ================= */}
        {step === 4 && (
          <div className="d-flex flex-column gap-3">
            <div
              className="alert alert-danger border-2 border-danger shadow-sm mb-0"
              role="alert"
            >
              <div className="badge bg-danger mb-1">
                Problem on your route · {data.disruption.time}
              </div>
              <h2 className="h5 fw-bold mb-1">
                Pavement blocked: {data.disruption.location}
              </h2>
              <p className="small mb-2">{data.disruption.alert}</p>
              <ListenButton text={alertScript(data)} label="Listen to alert" />
            </div>

            {/* Live Weather context during disruption */}
            <LiveWeatherBanner
              weather={weather}
              onRefresh={fetchSheffieldWeather}
              loadingWeather={loadingWeather}
            />

            <QgisWebMap
              geojsonData={qgisGeoJson}
              liveRoadsGeoJson={liveRoadsGeoJson}
              onImportGeoJson={(newGeo) => setQgisGeoJson(newGeo)}
              focusTarget={mapFocus}
              showDisruption={true}
            />

            {/* Live Roads Panel with Mandatory Attribution */}
            <LiveRoadsPanel
              roadIncidents={roadIncidents}
              roadMetaLicence={roadMetaLicence}
              roadFilter={roadFilter}
              setRoadFilter={setRoadFilter}
              onRefreshRoads={() => fetchLiveRoadsData(roadFilter)}
              loadingRoads={loadingRoads}
              roadError={roadError}
              onPlotIncidentOnMap={(coord) =>
                setMapFocus({ coord, zoom: 15 })
              }
            />

            <div className="card border-0 shadow-sm">
              <div className="card-body">
                <h3 className="h6 fw-bold mb-2">What we checked for you</h3>
                {data.disruption.reassessmentLog.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-2 mb-2 bg-light rounded border small"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="card border-primary border-2 shadow-sm">
              <div className="card-body">
                <span className="badge bg-primary mb-2">
                  We can ask the hospital for help
                </span>
                <h3 className="h5 fw-bold">
                  Request for accessible transport (draft)
                </h3>
                <p className="small text-muted mb-2">
                  Check it before sending. Nothing is sent without you.
                </p>
                <div className="p-3 bg-light rounded-3 border small mb-3">
                  <div className="mb-1">
                    <strong>To:</strong> {data.disruption.supportDraft.to}
                  </div>
                  <div className="mb-1">
                    <strong>Patient:</strong>{" "}
                    {data.disruption.supportDraft.patient}
                  </div>
                  <div className="mb-1">
                    <strong>The problem:</strong>{" "}
                    {data.disruption.supportDraft.summary}
                  </div>
                  <div>
                    <strong>Help needed:</strong>{" "}
                    <span className="fw-bold text-primary">
                      {data.disruption.supportDraft.actionRequested}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => setStep(5)}
                  className="btn btn-success btn-accessible w-100"
                >
                  Send request to the hospital →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= SCREEN 5: STAFF DASHBOARD ================= */}
        {step === 5 && (
          <div className="d-flex flex-column gap-3">
            {/* Live Help alerts from patients */}
            <StaffAlerts />
            <div className="card border-0 shadow-sm bg-dark text-white">
              <div className="card-body d-flex flex-wrap justify-content-between align-items-center gap-2">
                <div>
                  <span className="badge bg-info text-dark fw-bold mb-1">
                    ROYAL HALLAMSHIRE HOSPITAL
                  </span>
                  <h2 className="h4 fw-bold mb-0">
                    Patient Access Intervention Dashboard
                  </h2>
                </div>
              </div>
            </div>

            <div className="card border-danger border-2 shadow-sm">
              <div className="card-body">
                <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
                  <div>
                    <span className="badge bg-danger me-2">
                      URGENT INTERVENTION NEEDED
                    </span>
                    <span className="badge bg-secondary">
                      Appt: Today 10:30 AM
                    </span>
                    <h3 className="h5 fw-bold mt-2 mb-0">
                      Margaret Davies (67) — Neuro-Rehab Outpatients (Floor C)
                    </h3>
                  </div>
                  <span
                    className={`badge fs-6 ${
                      taxiApproved ? "bg-success" : "bg-warning text-dark"
                    }`}
                  >
                    {taxiApproved
                      ? "✅ Taxi Dispatched (ETA 09:45)"
                      : "⏳ Awaiting Staff Approval"}
                  </span>
                </div>

                <div className="row g-3 mb-3">
                  <div className="col-md-6">
                    <div className="p-3 bg-danger-subtle rounded-3 h-100">
                      <div className="fw-bold text-danger-emphasis mb-1">
                        Barriers Detected:
                      </div>
                      <ul className="small mb-0 ps-3">
                        <li>
                          <strong>Steep Hills:</strong> Walkley routes exceed
                          1-in-8 gradient limit.
                        </li>
                        <li>
                          <strong>Live Closure:</strong> Beech Hill Rd footway
                          blocked by works.
                        </li>
                      </ul>
                    </div>
                  </div>
                  <div className="col-md-6">
                    <div className="p-3 bg-success-subtle rounded-3 h-100">
                      <div className="fw-bold text-success-emphasis mb-1">
                        Suggested Follow-Up:
                      </div>
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
                    {taxiApproved
                      ? "✅ SMS Sent to Margaret"
                      : "✅ Approve Wheelchair Taxi"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Staff view lives outside the patient tabs */}
        <div className="text-center my-3">
          {step === 5 ? (
            <button
              type="button"
              onClick={() => setStep(4)}
              className="btn btn-outline-primary btn-accessible"
            >
              ← Back to the patient app
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep(5)}
              className="btn btn-link staff-link"
            >
              Hospital staff view
            </button>
          )}
        </div>
      </main>

      {/* Bottom Nav: patient screens only. The staff view is linked separately. */}
      {/* Help button on every patient screen (not on the staff view) */}
      {step !== 5 && (
        <HelpButton
          context={{
            patientName: data.extraction.patientName,
            hospital: data.extraction.hospital,
            department: data.extraction.department,
            arriveBy: `${data.extraction.arrivalTime}, ${data.extraction.date}`,
            screen: ["", "Letter", "My needs", "Route", "Alerts"][step],
            routeStep: (() => {
              const s = data.steps.find((x) => x.id === activeStepId);
              return s ? `${s.time}: ${s.title}` : "";
            })(),
            needs: [
              data.accessNeeds.mobilityAid.replace("_", " "),
              data.accessNeeds.stepFree ? "step-free" : null,
              `rest every ${data.accessNeeds.maxDistanceMeters} m`,
            ]
              .filter(Boolean)
              .join(", "),
          }}
          onReplan={() => setStep(4)}
        />
      )}

      <nav className="step-nav-bar" aria-label="Journey steps">
        <div className="d-flex justify-content-center gap-1 max-w-wide mx-auto">
          {[
            { id: 1, icon: IconFileText, label: "Letter" },
            { id: 2, icon: IconWheelchair, label: "My needs" },
            { id: 3, icon: IconMap, label: "Route" },
            { id: 4, icon: IconAlertTriangle, label: "Alerts" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStep(tab.id)}
              aria-current={step === tab.id ? "step" : undefined}
              className={`step-tab flex-fill ${step === tab.id ? "step-tab-active" : ""}`}
            >
              <tab.icon className="step-tab-icon" size={24} stroke={1.75} aria-hidden="true" />
              <span className="step-tab-label">{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}