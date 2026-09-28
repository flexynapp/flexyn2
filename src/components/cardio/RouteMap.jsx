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

import { useEffect, useRef, useState } from 'react';
import maplibregl, { silenceMissingSpriteIcons } from '@/lib/maplibre';
import { useLanguage } from '@/lib/LanguageContext';
// maplibre-gl/dist/maplibre-gl.css is imported globally in main.jsx

// Tile source resolution — two providers, picked at build time:
//
//   1. MapTiler "streets-v2" (preferred)
//      Highest-quality vector tiles available without enterprise
//      tooling. Full label hierarchy, multi-stop road styling, POI
//      icons, terrain shading. Requires a free API key from
//      maptiler.com/cloud (free tier: 100k tile requests/month —
//      plenty for a fitness app at this stage).
//
//   2. OpenFreeMap "liberty" (fallback, no key)
//      Community-hosted, MIT-licensed vector tiles. Visually
//      reasonable but noticeably less detailed than MapTiler.
//      Used when VITE_MAPTILER_KEY is unset so the app still
//      renders a map for contributors who haven't pulled the env
//      var yet.
//
// Both render via the same MapLibre GL JS engine — only the style
// JSON URL changes.
//
// To switch to MapTiler:
//   1. Sign up at https://www.maptiler.com/cloud/ (30 seconds, free).
//   2. Copy your Default API Key from the Account → Keys page.
//   3. Add to .env.local:  VITE_MAPTILER_KEY=your_key_here
//   4. Restart `npm run dev` (or rebuild for prod).
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;
const STYLE_URL = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
  : 'https://tiles.openfreemap.org/styles/liberty';

/** Read the app's --primary CSS variable and return a usable hsl() string. */
function getPrimaryColor() {
  if (typeof window === 'undefined') return '#f97316'; // SSR fallback (we're CSR but defensive)
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
  // --primary is stored as "H S% L%" (e.g. "26 90% 50%"). If for some
  // reason it's missing, fall back to orange-500.
  return raw ? `hsl(${raw})` : '#f97316';
}

export default function RouteMap({ track, height = 240, interactive = true }) {
  const { tFallback } = useLanguage();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  // Controls the expanded state of the custom attribution overlay.
  // Default false → only the tiny ⓘ button is visible. Tap reveals
  // the OSM + OpenFreeMap credit (legally required).
  const [attribOpen, setAttribOpen] = useState(false);
  // If MapLibre or the tile fetch fails outright, we set this so the
  // component still renders SOMETHING (a tinted box) instead of
  // throwing or showing a broken canvas. The post card around us
  // doesn't have its own ErrorBoundary, so a thrown error here would
  // blank the whole post — which is exactly the regression a user
  // reported. Local error capture is the load-bearing defense.
  const [mapError, setMapError] = useState(null);

  useEffect(() => {
    if (!Array.isArray(track) || track.length < 2) return undefined;
    if (!containerRef.current) return undefined;

    // Defensive: validate every point before passing to maplibre.
    // A malformed gps_track row (e.g. a legacy point with .latitude
    // instead of .lat, or null entries) would have produced NaN
    // bounds and a silently failed map. Sniff and bail to the
    // error fallback if the data is unusable.
    const validTrack = track.filter(
      (p) =>
        p &&
        typeof p.lat === 'number' &&
        Number.isFinite(p.lat) &&
        typeof p.lng === 'number' &&
        Number.isFinite(p.lng)
    );
    if (validTrack.length < 2) {
      setMapError('invalid_track');
      return undefined;
    }

    // Compute geographic bounds for fit-to-track camera. MapLibre uses
    // [west, south, east, north] / [lng, lat] order (opposite of Leaflet).
    const lats = validTrack.map((p) => p.lat);
    const lngs = validTrack.map((p) => p.lng);
    const bounds = [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ];

    let map;
    try {
      map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      bounds,
      fitBoundsOptions: { padding: 24, animate: false },
      // Disable everything when non-interactive (hub post cards) so
      // the map behaves like a static thumbnail. Pinch-zoom on a feed
      // post is a usability anti-pattern.
      interactive,
      // ATTRIBUTION
      // ───────────
      // Disable MapLibre's default control entirely. Setting it to
      // false prevents both the source-derived "© OpenStreetMap"
      // text AND the OpenFreeMap credit from rendering on the map.
      // We then mount our own minimal custom overlay (rendered in
      // JSX below) — a single small ⓘ button in the bottom-right
      // corner that reveals the required credit ONLY on tap.
      //
      // NOTE on legality: the attribution CANNOT be removed entirely.
      // OpenFreeMap's basemap data is OpenStreetMap, and the OSM
      // ODbL license legally requires "© OpenStreetMap contributors"
      // to be visible OR clearly accessible via UI affordance
      // wherever the tiles are shown. The same rule applies to
      // every free OSM-derived provider (Mapbox Streets, MapTiler,
      // Stadia, Carto, Stamen). Removing it entirely would mean
      // swapping in Apple MapKit JS or Google Maps Platform — both
      // require accounts/billing and come with their own mandatory
      // logo. We've reduced the visual footprint to the smallest
      // legally-compliant form: a 20×20px ⓘ button that expands
      // the credit on tap.
      attributionControl: false,
      // We don't expose tilt/rotation — flat overhead view matches the
      // mental model of a run/ride path.
      pitch: 0,
      bearing: 0,
      dragRotate: false,
      // Avoid the canvas accumulating focus when embedded in a feed.
      keyboard: interactive,
    });
    } catch (err) {
      // maplibregl.Map() can throw synchronously if the container is
      // detached, WebGL is unavailable, or the env is otherwise hostile.
      // Catch and degrade so the surrounding post still renders.
      console.warn('[RouteMap] map init failed:', err);
      setMapError('init_failed');
      return undefined;
    }

    // Listen for runtime errors (e.g. tile fetch 401 from a bad
    // MapTiler key, network failure, unsupported style spec). We
    // log them but don't tear down the canvas — MapLibre keeps
    // rendering whatever it has, and the user at least sees a
    // partial map instead of nothing.
    //
    // "Expected value to be of type number, but found null" is a
    // MapLibre style-validation warning fired when the OpenFreeMap
    // Liberty tile data contains null values in properties that a
    // style expression expects to be numeric (e.g. POI rank fields).
    // We don't own the style JSON so we can't fix the expression;
    // filtering it here keeps the console clean without hiding real errors.
    map.on('error', (e) => {
      const msg = e?.error?.message || String(e?.error || e);
      if (msg.includes('Expected value to be of type number')) return;
      console.warn('[RouteMap] map error:', e?.error || e);
    });

    // OpenFreeMap Liberty's sprite sheet lacks some POI icons the style
    // references; see silenceMissingSpriteIcons.
    silenceMissingSpriteIcons(map);

    mapRef.current = map;

    const polylineColor = getPrimaryColor();
    const coords = validTrack.map((p) => [p.lng, p.lat]);

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
      try { map.remove(); } catch { /* swallow — already torn down */ }
      mapRef.current = null;
    };
  }, [track, interactive]);

  if (!Array.isArray(track) || track.length < 2) return null;

  // Hard error fallback — map init or track data unusable. Still
  // render the bordered box so the post card layout doesn't jump,
  // but show a small label instead of an empty canvas.
  if (mapError) {
    return (
      <div
        className="rounded-xl overflow-hidden border border-border bg-secondary/30 flex items-center justify-center text-xs text-muted-foreground"
        style={{ height }}
      >
        {tFallback("routeMap.mapUnavailable", "Map unavailable")}
      </div>
    );
  }

  // Container layout — `ref={containerRef}` MUST be on the element
  // that has explicit dimensions (height inline, width via flex
  // parent). A previous iteration moved the ref onto an inner
  // absolutely-positioned div, which collapsed to 0×0 in some Hub
  // feed contexts where the outer parent didn't pass width down to
  // its absolute children correctly. That made the post card render
  // as an empty void. The attribution overlay below uses absolute
  // positioning to sit on top of the canvas — it doesn't need to
  // share the ref.
  return (
    <div
      ref={containerRef}
      className="rounded-xl overflow-hidden border border-border relative"
      style={{ height, isolation: 'isolate', zIndex: 0 }}
    >
      {/* Custom attribution — a single 18px ⓘ button bottom-right.
          Tap to reveal the credit (legally required but visually
          unobtrusive). The exact links shown depend on which tile
          provider is active: MapTiler swaps in their credit, OFM
          falls back to OSM-only. Default state shows only the icon. */}
      <div className="absolute bottom-1.5 end-1.5 flex items-end gap-1 pointer-events-none">
        {attribOpen && (
          <div
            className="pointer-events-auto bg-white/85 dark:bg-black/70 backdrop-blur-sm text-micro leading-tight px-1.5 py-0.5 rounded text-gray-700 dark:text-gray-200"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            {MAPTILER_KEY ? (
              <>
                <a
                  href="https://www.maptiler.com/copyright/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {tFallback("routeMap.maptiler", "MapTiler")}
                </a>
                {' · '}
                <a
                  href="https://openstreetmap.org/copyright"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  OSM
                </a>
              </>
            ) : (
              <>
                <a
                  href="https://openfreemap.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  OFM
                </a>
                {' · '}
                <a
                  href="https://openstreetmap.org/copyright"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  OSM
                </a>
              </>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => setAttribOpen((v) => !v)}
          aria-label={tFallback("routeMap.mapDataAttribution", "Map data attribution")}
          className="pointer-events-auto w-[18px] h-[18px] rounded-full bg-white/85 dark:bg-black/70 backdrop-blur-sm text-gray-700 dark:text-gray-200 text-micro font-bold flex items-center justify-center hover:bg-white dark:hover:bg-black dark:active:bg-black transition-colors shadow-sm"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          ⓘ
        </button>
      </div>
    </div>
  );
}
