import { useEffect, useMemo, useState } from "react";
import LiveJourneyMap from "./LiveJourneyMap";
import { formatDistance, journeySummary, MODE_STYLE, remainingJourney, transitRecommendations } from "./navigationPresentation";
import "./journeySummary.css";

export default function JourneyNavigation({ navigation, plan, arriveBy, location, destination, roadOverlay, tracking, loading, error, hospitalName, onDestination, onToggleTracking }) {
  const [focus, setFocus] = useState(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const remaining = remainingJourney(navigation, location);
  const transit = useMemo(() => transitRecommendations(plan), [plan]);
  const minutes = remaining ? Math.max(1, Math.ceil(remaining.seconds / 60)) : null;
  const arrived = remaining && remaining.distance < 15;
  // Times come from the appointment and plan; a live estimate only while tracking on the day (see journeySummary).
  const summary = journeySummary({ plan, arriveBy, remaining, tracking, now });

  return <section className="navigation-shell" aria-label="Navigation">
    <div className="navigation-map-surface">
      <LiveJourneyMap location={location} destination={destination} geometry={navigation?.geometry}
        onDestination={onDestination} focus={focus} roadOverlay={roadOverlay} transitLegs={transit} portrait />
      <div className="navigation-heading">
        <span className="navigation-heading-icon" aria-hidden="true">♿</span>
        <div><small>To your appointment</small><strong>{hospitalName || "Hospital"}</strong></div>
        <button className={`tracking-toggle ${tracking ? "is-tracking" : ""}`} onClick={onToggleTracking} aria-label={tracking ? "Stop live location" : "Start live location"} title={tracking ? "Stop live location" : "Start live location"}>{tracking ? "● Live" : "◎ Locate"}</button>
      </div>
      {loading && <div className="navigation-map-status" role="status">Updating route…</div>}
      {error && <div className="navigation-map-status navigation-map-error" role="alert">{error}</div>}
      <div className="transport-legend" aria-label="Route colours">
        {["walk", "bus", "tram"].map(mode => <span key={mode}><i style={{ background: MODE_STYLE[mode].color }} />{MODE_STYLE[mode].icon} {MODE_STYLE[mode].label}</span>)}
      </div>
    </div>

    <div className="navigation-bottom-sheet">
      <div className="navigation-sheet-handle" />
      <div className="navigation-arrival-summary" aria-live="polite">
        {summary.leaveAt ? <strong>Leave {summary.leaveAt}</strong>
          : summary.arriveBy ? <strong>Arrive by {summary.arriveBy}</strong>
          : <strong>{arrived ? "Near destination" : minutes ? `${minutes} min` : "— min"}</strong>}
        {summary.leaveAt && <span>Arrive by {summary.arriveBy}</span>}
        {summary.day && <span>{summary.day}</span>}
        {summary.journeyMinutes != null && <span>{summary.journeyMinutes} min journey</span>}
      </div>
      {summary.live
        ? <p className={`navigation-live${summary.live.late ? " is-late" : ""}`} aria-live="polite">
            Live: {arrived ? "near the entrance" : `${minutes} min, ${formatDistance(remaining.distance)} left`} · arrive about {summary.live.eta} · <strong>{summary.live.status}</strong>
          </p>
        : remaining && summary.arriveBy && <p className="navigation-live-note">
            Outdoor stretch: {formatDistance(remaining.distance)}, about {minutes} min. On the day, press Locate for a live arrival estimate.
          </p>}
      <div className="navigation-next-leg"><span className="mode-symbol" style={{ background: MODE_STYLE.walk.color }}>♿</span><div>
        <small>Outdoor route · estimated</small>
        <strong>{arrived ? "Check your hospital entrance" : `Continue towards ${hospitalName || "the hospital"}`}</strong>
        {remaining && <span>{formatDistance(remaining.distance)} remaining</span>}
      </div></div>

      {transit.length > 0 && <div className="navigation-transit-options"><h3>Suggested transport</h3>
        {transit.map((leg, index) => <button className="transit-leg-card" key={leg.id} onClick={() => {
          if (leg.geometry) setFocus(leg.geometry.coordinates[0]);
          else if (leg.map_stops[0]?.coordinate) setFocus(leg.map_stops[0].coordinate);
        }} style={{ borderLeftColor: leg.style.color }}>
          <span className="mode-symbol" style={{ background: leg.style.color }}>{leg.style.icon}</span>
          <span><small>{index === 0 ? "Next suggestion" : "Then"}{leg.simulated ? " · demo" : ""}</small>
            <strong>{leg.style.label}{leg.line ? ` ${leg.line}` : ""}</strong><span>{leg.instruction}</span>
            {!leg.geometry && <small>Route shape unavailable{leg.map_stops.length ? " · stops shown" : ""}</small>}
          </span>
        </button>)}
      </div>}

      {navigation?.warnings?.map((warning, index) => <p className="navigation-warning" key={index}>{warning}</p>)}
      {navigation?.provider_warnings?.length > 0 && <p className="navigation-warning">{navigation.provider_warnings.map(item => typeof item === "string" ? item : item.message || "The provider returned a route warning.").join(" ")}</p>}
      {navigation && <small className="navigation-access-note">Entrance and accessibility details need confirmation.</small>}
    </div>
  </section>;
}
