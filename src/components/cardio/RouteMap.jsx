// src/components/cardio/RouteMap.jsx
//
// Renders a Leaflet polyline of a GPS track with start (green) and
// end (red) markers, fit to bounds. Used in both the cardio detail
// modal and Hub post cards.
//
// Props:
//   track: Array<{ lat, lng, timestamp_ms? }>
//   height?: number — container height in px (default 240)
//   interactive?: boolean — when false, disables zoom/drag (default true)

// Bundle the leaflet stylesheet via JS. Previously this CSS was loaded
// synchronously from unpkg.com in index.html — a single-point-of-failure
// that took the cardio map down whenever unpkg blipped. The npm package
// ships the CSS and Vite handles it through the asset pipeline now, so
// it lands in our own /assets/ chunk and gets the same long-cache
// headers as everything else.
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Polyline, CircleMarker } from 'react-leaflet';

export default function RouteMap({ track, height = 240, interactive = true }) {
  if (!Array.isArray(track) || track.length < 2) return null;

  const points = track.map(p => [p.lat, p.lng]);
  const lats = track.map(p => p.lat);
  const lngs = track.map(p => p.lng);
  const center = [
    (Math.min(...lats) + Math.max(...lats)) / 2,
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
  ];
  const bounds = [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];

  return (
    <div
      className="rounded-xl overflow-hidden border border-border relative"
      style={{ height, isolation: 'isolate', zIndex: 0 }}
    >
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [16, 16] }}
        center={center}
        zoom={14}
        scrollWheelZoom={false}
        dragging={interactive}
        zoomControl={interactive}
        doubleClickZoom={interactive}
        touchZoom={interactive}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline positions={points} pathOptions={{
          color: 'hsl(var(--primary))', weight: 4, opacity: 0.9
        }} />
        <CircleMarker center={points[0]} radius={6} pathOptions={{
          color: 'white', fillColor: '#10b981', fillOpacity: 1, weight: 2
        }} />
        <CircleMarker center={points[points.length - 1]} radius={6} pathOptions={{
          color: 'white', fillColor: '#ef4444', fillOpacity: 1, weight: 2
        }} />
      </MapContainer>
    </div>
  );
}