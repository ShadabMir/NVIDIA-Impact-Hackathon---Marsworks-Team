export const MODE_STYLE = {
  walk: { color: "#005eb8", icon: "♿", label: "Walk / wheel" },
  roll: { color: "#005eb8", icon: "♿", label: "Walk / wheel" },
  bus: { color: "#007c66", icon: "🚌", label: "Bus" },
  tram: { color: "#7c3aed", icon: "🚊", label: "Tram" },
  taxi: { color: "#b45309", icon: "🚕", label: "Taxi" },
  transfer: { color: "#64748b", icon: "⇄", label: "Change" },
};

export function distanceMetres(a, b) {
  const rad = Math.PI / 180;
  const dlat = (b.latitude - a.latitude) * rad;
  const dlon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

// Project the GPS fix onto the route, rather than decrementing distance by a timer.
export function routeProgress(geometry, position) {
  const points = geometry?.type === "LineString" ? geometry.coordinates : [];
  if (!position || points.length < 2) return { fraction: 0, distanceFromRoute: 0 };
  const scaleX = 111195 * Math.cos(position.latitude * Math.PI / 180);
  const scaleY = 111195;
  let total = 0, travelled = 0, closest = Infinity, bestAlong = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i];
    const ax = (a[0] - position.longitude) * scaleX, ay = (a[1] - position.latitude) * scaleY;
    const dx = (b[0] - a[0]) * scaleX, dy = (b[1] - a[1]) * scaleY;
    const length = Math.hypot(dx, dy);
    const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (length * length))) : 0;
    const away = Math.hypot(ax + t * dx, ay + t * dy);
    if (away < closest) { closest = away; bestAlong = travelled + t * length; }
    travelled += length; total += length;
  }
  return { fraction: total ? Math.max(0, Math.min(1, bestAlong / total)) : 0, distanceFromRoute: closest };
}

export function remainingJourney(navigation, position) {
  if (!navigation) return null;
  const progress = routeProgress(navigation.geometry, position?.accuracy > 100 ? null : position);
  const fraction = progress.distanceFromRoute > Math.max(75, (position?.accuracy || 0) * 2) ? 0 : progress.fraction;
  return {
    distance: Math.max(0, navigation.distance_m * (1 - fraction)),
    seconds: Math.max(0, navigation.duration_seconds * (1 - fraction)),
    distanceFromRoute: progress.distanceFromRoute,
  };
}

export function shouldUpdateRoute({ location, navigation, lastOrigin, requestedAt, now = Date.now(), busy }) {
  if (busy || !location || (location.accuracy || 0) > 75 || now - requestedAt < 30000) return false;
  const moved = lastOrigin ? distanceMetres(lastOrigin, location) : Infinity;
  if (!navigation) return now - requestedAt >= 60000 && moved >= 30;
  const away = routeProgress(navigation.geometry, location).distanceFromRoute;
  return (away > Math.max(60, (location.accuracy || 0) * 2) && moved >= 30)
    || (now - requestedAt >= 120000 && moved >= 100);
}

function validGeometry(value) {
  const shape = value?.type === "Feature" ? value.geometry : value;
  return shape?.type === "LineString" && Array.isArray(shape.coordinates) && shape.coordinates.length >= 2
    && shape.coordinates.every(point => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])
      && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90) ? shape : null;
}

export function transitRecommendations(plan) {
  let options = [];
  if (plan?.options) {
    const id = plan.recommendation?.option_id;
    options = plan.options.filter(item => item.id === id);
  } else if (plan?.assessments) {
    options = plan.assessments.filter(item => item.route.id === plan.recommended_route_id).map(item => item.route);
  }
  return options.flatMap(option => (option.legs || []).map((leg, index) => ({
    ...leg, id: `${option.id}-${index}`, optionId: option.id,
    title: option.title, style: MODE_STYLE[leg.mode] || MODE_STYLE.walk,
    geometry: validGeometry(leg.geometry), map_stops: leg.map_stops || [],
    simulated: option.data_status === "simulated" || plan.data_status === "simulated" || plan.data_status === "demo_mixed",
  }))).filter(leg => ["bus", "tram", "taxi"].includes(leg.mode));
}

export function formatDistance(metres) {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres / 10) * 10} m`;
}
