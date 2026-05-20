// src/components/cardio/RouteMap.jsx
//
// Renders a vector-tile map with the user's GPS track as a polyline,
// start (green) and end (red) markers, and the camera fit to bounds.
// Used in both the cardio detail modal and Hub post cards.
//
// Stack:
//   - maplibre-gl    — open-source WebGL renderer (fork of Mapbox GL JS).
//                      Smooth vector pan/zoom; no API key for the
//                      library itself.
//   - OpenFreeMap    — community-hosted vector tile server. Free, no
//                      API key. Attribution required (collapses into a
//                      small ⓘ button in the corner by default).
//
// Previously this component used Leaflet + react-leaflet with raster
// OpenStreetMap tiles. The migration buys:
//   1. Vector tiles — pan/zoom is GPU-accelerated and silky instead
//      of pixelated mid-zoom.
//   2. Compact attribution control — OSM-via-Leaflet bakes the
//      "© OpenStreetMap" attribution string permanently into the
//      corner. MapLibre's AttributionControl in compact mode collapses
//      it into a single ⓘ icon that expands on tap. The data
//      attribution is still legally present, it just isn't visually
//      shouting at the user.
//
// Props:
//   track: Array<{ lat, lng, timestamp_ms? }>
//   height?: number — container height in px (default 240)
//   interactive?: boolean — when false, disables zoom/drag/rotate (default true)

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// OpenFreeMap "positron" — clean light-gray style that matches the
// app's neutral surface palette. The alternatives are "bright" (very
// saturated), "dark" (we'd need to flip based on theme), and "liberty"
// (more OSM-like). Positron is the safest default; it stays
// readable in both light and dark app themes because the polyline
// uses a high-contrast primary color.
const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

/** Read the app's --primary CSS variable and return a usable hsl() string. */
function getPrimaryColor() {
  if (typeof window === 'undefined') return '#f97316'; // SSR fallback (we're CSR but defensive)
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
  // --primary is stored as "H S% L%" (e.g. "26 90% 50%"). If for some
  // reason it's missing, fall back to orange-500.
  return raw ? `hsl(${raw})` : '#f97316';
}

export default function RouteMap({ track, height = 240, interactive = true }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!Array.isArray(track) || track.length < 2) return undefined;
    if (!containerRef.current) return undefined;

    // Compute geographic bounds for fit-to-track camera. MapLibre uses
    // [west, south, east, north] / [lng, lat] order (opposite of Leaflet).
    const lats = track.map((p) => p.lat);
    const lngs = track.map((p) => p.lng);
    const bounds = [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ];

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OPENFREEMAP_STYLE_URL,
      bounds,
      fitBoundsOptions: { padding: 24, animate: false },
      // Disable everything when non-interactive (hub post cards) so
      // the map behaves like a static thumbnail. Pinch-zoom on a feed
      // post is a usability anti-pattern.
      interactive,
      // Compact attribution — collapses to a single ⓘ button until tapped.
      attributionControl: { compact: true },
      // We don't expose tilt/rotation — flat overhead view matches the
      // mental model of a run/ride path.
      pitch: 0,
      bearing: 0,
      dragRotate: false,
      // Avoid the canvas accumulating focus when embedded in a feed.
      keyboard: interactive,
    });

    mapRef.current = map;

    const polylineColor = getPrimaryColor();
    const coords = track.map((p) => [p.lng, p.lat]);

    // Wait for the style to finish loading before adding sources/layers.
    // OpenFreeMap's vector tile schema is loaded on `load`.
    map.on('load', () => {
      // Polyline source
      map.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: coords },
        },
      });
      // Soft underlay — gives the line a subtle halo for legibility
      // over varied basemap content (parks, roads, water).
      map.addLayer({
        id: 'route-line-halo',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': 8,
          'line-opacity': 0.55,
        },
      });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': polylineColor,
          'line-width': 4,
          'line-opacity': 0.95,
        },
      });

      // Start marker (green) and end marker (red). maplibre-gl
      // Markers are real DOM, not WebGL, so they stay crisp at every
      // zoom and pick up CSS easily.
      new maplibregl.Marker({ color: '#10b981' })
        .setLngLat(coords[0])
        .addTo(map);
      new maplibregl.Marker({ color: '#ef4444' })
        .setLngLat(coords[coords.length - 1])
        .addTo(map);
    });

    // Cleanup: tear down the map + GL context. Critical — without
    // this, React StrictMode dev double-mounts will leak a second
    // canvas and the OpenFreeMap fetch will run twice on every mount.
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [track, interactive]);

  if (!Array.isArray(track) || track.length < 2) return null;

  return (
    <div
      ref={containerRef}
      className="rounded-xl overflow-hidden border border-border relative"
      style={{ height, isolation: 'isolate', zIndex: 0 }}
    />
  );
}
