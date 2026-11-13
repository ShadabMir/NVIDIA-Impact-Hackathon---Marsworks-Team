import { useEffect, useRef, useState } from "react";

export default function LiveJourneyMap({ location, destination, geometry, onDestination, focus }) {
  const container = useRef(null);
  const map = useRef(null);
  const locationMarker = useRef(null);
  const accuracyCircle = useRef(null);
  const destinationMarker = useRef(null);
  const routeLayer = useRef(null);
  const callback = useRef(onDestination);
  useEffect(() => { callback.current = onDestination; }, [onDestination]);
  const [follow, setFollow] = useState(true);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!window.L) { queueMicrotask(() => setUnavailable(true)); return; }
    const L = window.L;
    const instance = L.map(container.current).setView([53.39, -1.48], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(instance);
    instance.on("click", event => callback.current({ latitude: event.latlng.lat, longitude: event.latlng.lng, label: "Selected map point — confirm the entrance" }));
    instance.on("dragstart", () => setFollow(false));
    map.current = instance;
    queueMicrotask(() => setReady(true));
    const resize = new ResizeObserver(() => instance.invalidateSize());
    resize.observe(container.current);
    return () => { resize.disconnect(); instance.remove(); map.current = null; locationMarker.current = null; accuracyCircle.current = null; destinationMarker.current = null; routeLayer.current = null; };
  }, []);

  useEffect(() => {
    if (!ready || !location || !map.current) return;
    const L = window.L;
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
      destinationMarker.current = window.L.marker([destination.latitude, destination.longitude]).addTo(map.current).bindPopup(node);
      if (!location) map.current.setView([destination.latitude, destination.longitude], 15);
    }
  }, [ready, destination, location]);

  useEffect(() => {
    if (!ready || !map.current) return;
    if (routeLayer.current) { routeLayer.current.remove(); routeLayer.current = null; }
    if (geometry) {
      routeLayer.current = window.L.geoJSON(geometry, { style: { color: "#005eb8", weight: 6 } }).addTo(map.current);
      map.current.fitBounds(routeLayer.current.getBounds(), { padding: [25, 25] });
      queueMicrotask(() => setFollow(false));
    }
  }, [ready, geometry]);

  useEffect(() => {
    if (ready && focus && map.current) {
      queueMicrotask(() => setFollow(false));
      map.current.flyTo([focus[1], focus[0]], 17);
    }
  }, [ready, focus]);

  return <section aria-label="Journey map">
    <div className="gmap-wrapper"><div ref={container} className="gmap-canvas" aria-label="Map. Tap to choose a destination." /></div>
    {unavailable && <p role="alert">The map library could not load. Check your internet connection; written steps remain available.</p>}
    <div className="d-flex justify-content-between align-items-center gap-2 mt-2">
      <small>Tap the map to choose a destination. The blue circle shows GPS accuracy.</small>
      <button type="button" className="btn btn-outline-primary" disabled={!location} onClick={() => setFollow(true)}>{follow ? "Following you" : "Follow me"}</button>
    </div>
  </section>;
}
