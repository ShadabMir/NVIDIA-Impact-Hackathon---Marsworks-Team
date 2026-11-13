import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Visual-first map for live guidance: route coloured by mode, travelled part greyed,
// a large moving wheelchair marker, stop / entrance / problem icons. No text labels.
const COLORS = { roll: "#005eb8", bus: "#007c66", tram: "#7c3aed", taxi: "#b45309" };
const icon = (html, className, size = 44) => L.divIcon({ html, className, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

export default function GuidanceMap({ timeline, position, problems = [], follow = true }) {
  const container = useRef(null);
  const map = useRef(null);
  const routeLayer = useRef(null);
  const problemLayer = useRef(null);
  const marker = useRef(null);
  const travelled = useRef(null);

  useEffect(() => {
    const instance = L.map(container.current, { zoomControl: false, attributionControl: true, fadeAnimation: false, zoomAnimation: false, markerZoomAnimation: false }).setView([53.388, -1.493], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(instance);
    map.current = instance;
    const resize = new ResizeObserver(() => instance.invalidateSize());
    resize.observe(container.current);
    return () => { resize.disconnect(); instance.stop(); instance._animatingZoom = false; instance.off(); instance.remove(); map.current = null; marker.current = null; routeLayer.current = null; problemLayer.current = null; travelled.current = null; };
  }, []);

  // Route, stops and entrance whenever the timeline changes (start or re-plan).
  useEffect(() => {
    if (!map.current || !timeline) return;
    routeLayer.current?.remove();
    const group = L.featureGroup().addTo(map.current);
    routeLayer.current = group;
    for (const segment of timeline.segments) {
      if (segment.kind === "move" && segment.coords.length >= 2) {
        const latlngs = segment.coords.map(([lon, lat]) => [lat, lon]);
        L.polyline(latlngs, { color: "#ffffff", weight: 12, opacity: 0.9 }).addTo(group);
        L.polyline(latlngs, { color: COLORS[segment.mode] || COLORS.roll, weight: 8, dashArray: segment.mode === "roll" ? "2,10" : undefined, lineCap: "round" }).addTo(group);
      }
      if (segment.kind === "wait" && !segment.delay) {
        const [lon, lat] = segment.coords[0];
        const html = `<span class="gm-pin" style="background:${COLORS[segment.mode] || COLORS.bus}">${segment.mode === "taxi" ? "🚕" : "🚏"}${segment.line ? `<b>${segment.line}</b>` : ""}</span>`;
        L.marker([lat, lon], { icon: icon(html, "gm-icon", 48), keyboard: false }).addTo(group);
      }
    }
    const last = timeline.segments[timeline.segments.length - 1];
    const goal = last ? last.coords[last.coords.length - 1] : timeline.goal;
    L.marker([goal[1], goal[0]], { icon: icon('<span class="gm-goal">🏥</span>', "gm-icon", 52), keyboard: false }).addTo(group);
    if (!travelled.current) travelled.current = L.polyline([], { color: "#9aa5b1", weight: 8, opacity: 0.9 }).addTo(map.current);
    travelled.current.bringToFront(); // trail is kept across re-plans; a restart remounts the map
    try { map.current.fitBounds(group.getBounds(), { padding: [40, 40], maxZoom: 17, animate: false }); } catch { /* map not sized yet */ }
  }, [timeline]);

  // Problem markers (e.g. blocked pavement).
  useEffect(() => {
    if (!map.current) return;
    problemLayer.current?.remove();
    problemLayer.current = L.featureGroup().addTo(map.current);
    for (const p of problems) {
      L.marker([p.point[1], p.point[0]], { icon: icon(`<span class="gm-problem">${p.icon}</span>`, "gm-icon", 46), keyboard: false }).addTo(problemLayer.current);
    }
  }, [problems]);

  // Moving marker and travelled trail.
  useEffect(() => {
    if (!map.current || !position) return;
    const latlng = [position[1], position[0]];
    if (!marker.current) {
      marker.current = L.marker(latlng, { icon: icon('<span class="gm-me">♿</span>', "gm-icon gm-me-wrap", 56), zIndexOffset: 1000, keyboard: false }).addTo(map.current);
    } else {
      marker.current.setLatLng(latlng);
    }
    travelled.current?.addLatLng(latlng);
    if (follow) { try { map.current.panTo(latlng, { animate: false }); } catch { /* map closing */ } }
  }, [position, follow]);

  return <div ref={container} className="gm-canvas" role="img" aria-label="Live map of your route" />;
}
