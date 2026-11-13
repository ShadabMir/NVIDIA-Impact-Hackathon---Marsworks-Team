# Navigation map

The appointment hospital and starting address supply the default route. Leaflet is bundled through npm, so the map no longer depends on a separate Leaflet CDN download.

The portrait map shows a blue outdoor wheelchair route, live location, an estimated remaining distance/time and arrival time. Remaining distance is estimated by projecting the GPS fix onto the route; it is not a live public-transport arrival prediction. Detailed street turns are omitted. Weather and roads open using the button below the map.

GPS rerouting ignores fixes with accuracy worse than 75 m and requests less than 30 seconds apart. It reroutes after meaningful deviation (at least 60 m, adjusted for GPS accuracy) or after two minutes and 100 m of movement. Reconnection also retries navigation. The browser still needs location permission and a secure context for GPS.

## Transport data contract

Agent legs optionally accept the following mapping fields alongside their existing `minutes` and other fields:

```json
{
  "mode": "bus",
  "line": "95",
  "instruction": "Board the bus at the confirmed stop",
  "geometry": { "type": "LineString", "coordinates": [[-1.48, 53.38], [-1.47, 53.39]] },
  "map_stops": [{ "name": "Example stop", "coordinate": [-1.48, 53.38] }]
}
```

Coordinates use GeoJSON longitude, latitude order. The example is a schema illustration, not a real service route. Bus geometry is green with a bus symbol; tram geometry is purple with a tram symbol. Demonstration geometry is dashed. Supplied stops receive matching pins. Only the recommended option is displayed.

The current Sheffield demonstration recommendations contain transport instructions but no transport geometry or stop coordinates. The UI labels missing shapes rather than generating a fictional service path. A real transit provider must supply those shapes/stops to draw actual bus/tram routes. The outdoor wheelchair route remains a separate estimate.

## Code reviewed

- Existing project: `LiveJourneyMap`, agent leg rendering, Sheffield journey fixtures and legacy QGIS reference layers. The QGIS bus reference is fictional and is not used as a live service shape.
- [Leaflet GeoJSON and custom icon documentation](https://leafletjs.com/reference.html): used for mode colours, route layers and transport symbols.
- [SkedGo TripKit Leaflet](https://github.com/skedgo/tripkit-leaflet): multimodal mapping integration; requires a separate routing provider/API key.
- [Leaflet Routing Machine](https://github.com/perliedman/leaflet-routing-machine): routing/map integration reference; does not supply this project's missing transit data.

Run `npm run test:navigation`, `npm run build`, `npm run lint`, and the backend pytest suite to verify these changes.
