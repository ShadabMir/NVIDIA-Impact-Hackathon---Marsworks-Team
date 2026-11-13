import { useState, useEffect, useRef } from "react";
import "./App.css";

import AccessRouteApp from "./AccessRouteApp";

// Standard QGIS GeoJSON FeatureCollection (CRS: EPSG:4326 / WGS84)
const INITIAL_QGIS_GEOJSON = {
  type: "FeatureCollection",
  name: "sheffield_hospital_access_qgis",
  crs: {
    type: "name",
    properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" },
  },
  features: [
    // 1. Safe Bus 95 Corridor LineString
    {
      type: "Feature",
      properties: {
        fid: 101,
        layer: "safe_corridor",
        name: "Demo Bus 95 corridor (unverified)",
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
    // 2. Rejected Steep Howard Rd LineString
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
    // 3. QGIS Polygon: Steep 1-in-8 Slope Hazard Zone (Howard Rd)
    {
      type: "Feature",
      properties: {
        fid: 201,
        layer: "steep_gradient_hazard",
        name: "QGIS DEM Slope > 12% (1-in-8 Hazard Polygon)",
        max_gradient: "12.5% (1:8)",
        source: "Hand-authored example; not verified LiDAR",
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
    // 4. Point: Margaret's Origin (42 South Rd, Walkley)
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
    // 5. Point: Walkley Bus 95 Boarding Stop
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
        notes: "Demo boarding point; access unverified.",
      },
      geometry: {
        type: "Point",
        coordinates: [-1.4992, 53.3928],
      },
    },
    // 6. Point: Royal Hallamshire B-Road Step-Free Entrance
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
        notes: "Demo destination; entrance and lift access unverified.",
      },
      geometry: {
        type: "Point",
        coordinates: [-1.4934, 53.3782],
      },
    },
  ],
};

// QGIS Web GIS Component (Renders EPSG:4326 GeoJSON Layers + Topographic Contours)
function QgisWebMap({
  geojsonData,
  onImportGeoJson,
  focusTarget,
  showDisruption,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);


  const [basemap, setBasemap] = useState("topo"); // 'topo' (QGIS Contours) or 'osm'
  const [visibleLayers, setVisibleLayers] = useState({
    safe_corridor: true,
    steep_gradient_hazard: true,
    key_nodes: true,
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
      });
      L.control.zoom({ position: "bottomright" }).addTo(map);
      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;

    // Clear old layers
    map.eachLayer((layer) => map.removeLayer(layer));

    // 1. Add Selected QGIS Basemap (OpenTopoMap shows real Sheffield hill contours)
    if (basemap === "topo") {
      L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
        maxZoom: 17,
        attribution: 'Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap (CC-BY-SA)',
      }).addTo(map);
    } else {
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors | QGIS GeoJSON",
      }).addTo(map);
    }

    // 2. Render QGIS GeoJSON FeatureCollection
    const activeFeatures = {
      ...geojsonData,
      features: geojsonData.features.filter(
        (f) => visibleLayers[f.properties?.layer] !== false
      ),
    };

    L.geoJSON(activeFeatures, {
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
        if (feature.properties?.layer === "steep_gradient_hazard") {
          return {
            color: "#dc2626",
            weight: 5,
            dashArray: "8, 8",
            opacity: 0.85,
          };
        }
        return {
          color: showDisruption ? "#f59e0b" : "#16a34a",
          weight: 6,
          opacity: 0.95,
        };
      },
      pointToLayer: (feature, latlng) => {
        const icon = String(feature.properties?.icon || "📍").replace(/[<>&"']/g, "");
        const bg = /^#[0-9a-f]{6}$/i.test(feature.properties?.color || "") ? feature.properties.color : "#005eb8";
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
        const popup = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = p.name || "Imported GeoJSON feature";
        const details = document.createElement("p");
        details.textContent = [p.layer, p.max_gradient, p.gradient, p.notes].filter(Boolean).join(" · ");
        popup.append(title, details);
        layer.bindPopup(popup);
        layer.on("click", () => setSelectedFeatureProps(p));
      },
    }).addTo(map);

    // 3. Add Live Beech Hill Rd Footway Closure Layer on Screen 4
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
          "<b>QGIS Layer: streetworks_closures</b><br/>Beech Hill Rd footway width < 0.7m (Impassable)."
        )
        .openPopup();
      map.setView([53.3787, -1.4938], 16);
    }


  }, [geojsonData, basemap, visibleLayers, showDisruption]);

  // Fly to coordinate when user taps a step card
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !focusTarget) return;
    map.flyTo(focusTarget.coord, focusTarget.zoom || 16, { duration: 0.7 });
  }, [focusTarget]);

  useEffect(() => () => {
    mapInstanceRef.current?.remove();
    mapInstanceRef.current = null;
  }, []);

  const toggleLayer = (key) => {
    setVisibleLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Allow user/team to import a real .geojson file exported from Desktop QGIS
  const handleGeoJsonUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)
            || parsed.features.length > 5000
            || parsed.features.some(feature => !feature.geometry || !["Point", "LineString", "Polygon", "MultiPolygon", "MultiLineString", "MultiPoint"].includes(feature.geometry.type))) {
          throw new Error("Expected a GeoJSON FeatureCollection");
        }
        onImportGeoJson(parsed);
      } catch {
        alert("Invalid GeoJSON file. Export from QGIS as EPSG:4326 GeoJSON.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="d-flex flex-column gap-2">
      {/* QGIS Layer Control & Basemap Switcher Bar */}
      <div className="qgis-layer-panel">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <span className="fw-bold text-info">
            🗺️ QGIS Spatial Layers (CRS: EPSG:4326)
          </span>
          <div className="btn-group btn-group-sm">
            <button
              type="button"
              onClick={() => setBasemap("topo")}
              className={`btn btn-sm py-0 px-2 ${
                basemap === "topo" ? "btn-info fw-bold" : "btn-outline-light"
              }`}
              style={{ fontSize: "0.72rem" }}
            >
              Topo Contours
            </button>
            <button
              type="button"
              onClick={() => setBasemap("osm")}
              className={`btn btn-sm py-0 px-2 ${
                basemap === "osm" ? "btn-info fw-bold" : "btn-outline-light"
              }`}
              style={{ fontSize: "0.72rem" }}
            >
              OSM Street
            </button>
          </div>
        </div>

        {/* Toggleable QGIS Vector Layers */}
        <div className="d-flex flex-wrap gap-3 mb-2">
          <label className="d-flex align-items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={visibleLayers.safe_corridor}
              onChange={() => toggleLayer("safe_corridor")}
            />
            <span>🟢 Bus_95_Corridor.geojson</span>
          </label>
          <label className="d-flex align-items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={visibleLayers.steep_gradient_hazard}
              onChange={() => toggleLayer("steep_gradient_hazard")}
            />
            <span>🔴 LiDAR_Slope_1in8.geojson</span>
          </label>
          <label className="d-flex align-items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={visibleLayers.key_nodes}
              onChange={() => toggleLayer("key_nodes")}
            />
            <span>📍 RHH_Access_Nodes.geojson</span>
          </label>
        </div>

        {/* Direct QGIS File Import Button */}
        <div className="d-flex justify-content-between align-items-center pt-1 border-top border-secondary">
          <span className="text-white-50" style={{ fontSize: "0.72rem" }}>
            Click any vector feature on map to inspect QGIS attributes
          </span>
          <label
            className="btn btn-sm btn-outline-info py-0 px-2"
            style={{ fontSize: "0.72rem" }}
          >
            📂 Load QGIS .geojson
            <input
              type="file"
              accept=".geojson,.json"
              onChange={handleGeoJsonUpload}
              hidden
            />
          </label>
        </div>
      </div>

      {/* Interactive Map Canvas */}
      <div className="gmap-wrapper">
        <div ref={mapContainerRef} className="gmap-canvas" />
      </div>

      {/* QGIS Feature Attribute Inspector Bar */}
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
  return <AccessRouteApp AdvancedMap={QgisWebMap} demoGeoJson={INITIAL_QGIS_GEOJSON} />;
}
