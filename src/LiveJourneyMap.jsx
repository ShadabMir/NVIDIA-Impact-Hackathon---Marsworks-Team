import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export default function LiveJourneyMap({ location, destination, geometry, onDestination, focus, roadOverlay, transitLegs = [], portrait = false }) {
  const container = useRef(null);
  const map = useRef(null);
  const locationMarker = useRef(null);
  const accuracyCircle = useRef(null);
  const destinationMarker = useRef(null);
  const routeLayer = useRef(null);
  const roadLayer = useRef(null);
  const transitLayer = useRef(null);
  const callback = useRef(onDestination);
  useEffect(() => { callback.current = onDestination; }, [onDestination]);
  const [follow, setFollow] = useState(true);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState("");

  useEffect(() => {
    const instance = L.map(container.current, { zoomControl: false }).setView([53.39, -1.48], 13);
    L.control.zoom({ position: "bottomright" }).addTo(instance);
    instance.createPane("journey-route");
    instance.getPane("journey-route").style.zIndex = "450";
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(instance);
    instance.on("click", event => callback.current({ latitude: event.latlng.lat, longitude: event.latlng.lng, label: "Selected map point — confirm the entrance" }));
    instance.on("dragstart", () => setFollow(false));
    map.current = instance;
    queueMicrotask(() => setReady(true));
    const resize = new ResizeObserver(() => instance.invalidateSize());
    resize.observe(container.current);
    return () => {
      resize.disconnect();
      // Leaflet finishes zoom animations on a timer; if the map is removed first (e.g. switching tabs
      // mid-zoom) that timer crashes with "_leaflet_pos". Stop animations and clear the zoom flag so the pending timer does nothing.
      instance.stop();
      instance._animatingZoom = false; // the pending zoom-end timer then returns early
      instance.remove(); map.current = null; locationMarker.current = null; accuracyCircle.current = null; destinationMarker.current = null; routeLayer.current = null; roadLayer.current = null; transitLayer.current = null; };
  }, []);

  useEffect(() => {
    if (!ready || !location || !map.current) return;
    const point = [location.latitude, location.longitude];
    if (!locationMarker.current) {
      locationMarker.current = L.circleMarker(point, { radius: 9, color: "#fff", weight: 3, fillColor: "#005eb8", fillOpacity: 1 }).addTo(map.current).bindPopup("Your current location");
      accuracyCircle.current = L.circle(point, { radius: location.accuracy || 0, color: "#005eb8", weight: 1, fillOpacity: 0.08 }).addTo(map.current);
    } else {
      locationMarker.current.setLatLng(point);
      accuracyCircle.current.setLatLng(point).setRadius(location.accuracy || 0);
    }
    if (follow) map.current.setView(point, Math.max(map.current.getZoom(), 15));
  }, [ready, location, follow]);

  useEffect(() => {
    if (!ready || !map.current) return;
    if (destinationMarker.current) { destinationMarker.current.remove(); destinationMarker.current = null; }
    if (destination) {
      const node = document.createElement("span"); node.textContent = destination.label || "Destination — entrance unverified";
      destinationMarker.current = L.circleMarker([destination.latitude, destination.longitude], { radius: 9, color: "#fff", weight: 3, fillColor: "#15803d", fillOpacity: 1 }).addTo(map.current).bindPopup(node);
      if (!location) map.current.setView([destination.latitude, destination.longitude], 15);
    }
  }, [ready, destination, location]);

  useEffect(() => {
    if (!ready || !map.current) return;
    if (routeLayer.current) { routeLayer.current.remove(); routeLayer.current = null; }
    if (geometry) {
      try {
        routeLayer.current = L.geoJSON(geometry, { pane: "journey-route", style: { color: "#005eb8", weight: 6, opacity: 1, className: "appointment-route-line" } }).addTo(map.current);
        map.current.invalidateSize();
        map.current.fitBounds(routeLayer.current.getBounds(), { padding: [30, 30], maxZoom: 17 });
        routeLayer.current.bringToFront();
        queueMicrotask(() => { setFollow(false); setMapError(""); });
      } catch { queueMicrotask(() => setMapError("The route line could not be drawn. Check your connection; navigation updates automatically when it reconnects.")); }
    }
  }, [ready, geometry]);

  useEffect(() => {
    if (!ready || !map.current) return;
    if (roadLayer.current) { roadLayer.current.remove(); roadLayer.current = null; }
    if (roadOverlay) {
      try {
        roadLayer.current = L.geoJSON(roadOverlay, {
          style: { color: "#b45309", weight: 4, dashArray: "5,5" },
          onEachFeature: (feature, layer) => {
            const text = document.createElement("span");
            text.textContent = String(feature.properties?.title || feature.properties?.description || "Live Roads incident; impact unverified");
            layer.bindPopup(text);
          },
        }).addTo(map.current);
      } catch { console.warn("The road overlay could not be displayed."); }
    }
  }, [ready, roadOverlay]);

  useEffect(() => {
    if (!ready || !map.current) return;
    if (transitLayer.current) transitLayer.current.remove();
    const group = L.featureGroup().addTo(map.current);
    transitLayer.current = group;
    const pin = (coordinate, title, leg) => {
      const node = document.createElement("span");
      node.className = "transport-map-pin"; node.style.background = leg.style.color;
      node.textContent = `${leg.style.icon}${leg.line ? ` ${leg.line}` : ""}`;
      const popup = document.createElement("span"); popup.textContent = title;
      L.marker([coordinate[1], coordinate[0]], { icon: L.divIcon({ html: node, className: "transport-map-marker", iconSize: [44, 36], iconAnchor: [22, 18] }) }).addTo(group).bindPopup(popup);
    };
    for (const leg of transitLegs) {
      if (leg.geometry) {
        L.geoJSON(leg.geometry, { pane: "journey-route", style: { color: leg.style.color, weight: 6, dashArray: leg.simulated ? "9,5" : undefined, className: `transit-route-${leg.mode}` } }).addTo(group);
        const points = leg.geometry.coordinates;
        pin(points[Math.floor(points.length / 2)], `${leg.style.label} ${leg.line || ""}${leg.simulated ? " — demonstration shape" : ""}`, leg);
      }
      for (const stop of leg.map_stops) {
        if (Array.isArray(stop.coordinate) && stop.coordinate.length >= 2) pin(stop.coordinate, stop.name || "Transport stop", leg);
      }
    }
  }, [ready, transitLegs]);

  useEffect(() => {
    if (ready && focus && map.current) {
      queueMicrotask(() => setFollow(false));
      map.current.flyTo([focus[1], focus[0]], 17);
    }
  }, [ready, focus]);

  return <section aria-label="Journey map" className={portrait ? "portrait-journey-map" : ""}>
    <div className="gmap-wrapper"><div ref={container} className="gmap-canvas" style={portrait ? undefined : { minHeight: 340 }} aria-label="Map showing your route to the appointment hospital." /></div>
    {mapError && <p role="alert">{mapError}</p>}
    <div className={portrait ? "map-nav-controls" : "d-flex justify-content-between align-items-center gap-2 mt-2"}>
      <button type="button" className="btn btn-outline-primary" disabled={!geometry} onClick={() => {
        setFollow(false);
        if (routeLayer.current && map.current) {
          const bounds = routeLayer.current.getBounds();
          if (transitLayer.current?.getLayers().length) bounds.extend(transitLayer.current.getBounds());
          map.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
        }
      }}>Full route</button>
      <button type="button" className="btn btn-outline-primary" disabled={!location} onClick={() => setFollow(true)} aria-label="Centre on my location">◎</button>
    </div>
  </section>;
}
