// src/pages/GymMap.jsx
// Gym discovery map — static import of maplibre-gl (same pattern as RouteMap.jsx).
// Dynamic import caused chunk-load errors that triggered the ErrorBoundary reload
// loop; static import eliminates that failure mode entirely.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
// CSS is imported globally in main.jsx (same as RouteMap.jsx)
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Building2, MapPin, Users, X,
  Loader2, Search, Trophy, Map as MapIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getGymsInBbox } from '@/lib/data/gymBusinesses';
import GymLeaderboard from '@/components/gyms/GymLeaderboard';
import { useAuth } from '@/lib/AuthContext';

// ── Constants ──────────────────────────────────────────────────────────
const US_CENTER        = [-98.5795, 39.8283];
const US_ZOOM          = 3.6;
const MOVE_DEBOUNCE_MS = 400;
const OSM_ZOOM_MIN     = 5;

const MAPTILER_KEY = import.meta.env?.VITE_MAPTILER_KEY || '';
const STYLE_URL    = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
  : 'https://tiles.openfreemap.org/styles/liberty';

const SPECIAL_PIN_CODES = new Set(['WKF2QPWT']);

// ── Pin DOM builders ───────────────────────────────────────────────────

// IMPORTANT: MapLibre owns the OUTER element's `transform` — it sets
// `translate(...)` on the marker root every frame to position the pin
// at its lng/lat. If hover handlers wrote `transform: scale(...)` to
// the same element they CLOBBERED the translate and the pin jumped to
// the top-left corner of the map container (the reported bug).
// All hover scaling is now applied to an INNER wrapper so the outer
// transform stays MapLibre's exclusive property.
function buildFlexynPin({ gym, compact, onClick }) {
  const el = document.createElement('button');
  el.type  = 'button';
  el.title = gym.name;
  const sz = compact ? 20 : 34;
  Object.assign(el.style, {
    width: `${sz}px`, height: `${sz}px`,
    background: 'none', border: 'none', padding: '0',
    cursor: 'pointer', display: 'block',
  });
  // Inner wrapper carries the visual styling AND the hover transform.
  const inner = document.createElement('div');
  Object.assign(inner.style, {
    width: '100%', height: '100%', borderRadius: '50%',
    background: 'linear-gradient(135deg,#7c3aed,#4338ca)',
    border: '2.5px solid #fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', fontSize: `${compact ? 10 : 12}px`, fontWeight: '700',
    boxShadow: '0 3px 10px rgba(0,0,0,0.3)',
    transition: 'transform 120ms ease-out',
    transform: 'scale(1)',
    willChange: 'transform',
  });
  inner.textContent = compact ? '🏋' : (gym.member_count > 0 ? String(gym.member_count) : '🏋');
  el.appendChild(inner);
  el.addEventListener('mouseenter', () => { inner.style.transform = 'scale(1.2)'; });
  el.addEventListener('mouseleave', () => { inner.style.transform = 'scale(1)'; });
  el.addEventListener('click', e => { e.stopPropagation(); onClick(gym); });
  return el;
}

function buildOrangePin({ gym, onClick }) {
  const el = document.createElement('button');
  el.type  = 'button';
  el.title = gym.name;
  // Explicit width/height + line-height:0/font-size:0 so the SVG sits
  // flush in the button without baseline-alignment gaps. MapLibre uses
  // the marker's offsetWidth/Height to anchor; deterministic dims
  // guarantee correct geo-anchor positioning.
  Object.assign(el.style, {
    width: '32px', height: '46px',
    background: 'none', border: 'none', padding: '0',
    cursor: 'pointer', display: 'block',
    lineHeight: '0', fontSize: '0',
  });
  // Inner wrapper carries the hover transform — see buildFlexynPin
  // for the rationale (MapLibre owns the outer element's transform).
  const inner = document.createElement('div');
  Object.assign(inner.style, {
    width: '100%', height: '100%', display: 'block',
    transition: 'transform 140ms ease-out',
    transform: 'scale(1)',
    transformOrigin: 'center bottom',
    willChange: 'transform',
  });
  inner.innerHTML = `<svg width="32" height="46" viewBox="0 0 32 46" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <path d="M16 1C7.72 1 1 7.72 1 16c0 12 15 29 15 29S31 28 31 16C31 7.72 24.28 1 16 1z"
      fill="#f97316" stroke="#fff" stroke-width="2"
      style="filter:drop-shadow(0 3px 4px rgba(0,0,0,0.35))"/>
    <circle cx="16" cy="15" r="7" fill="rgba(255,255,255,0.25)"/>
    <circle cx="16" cy="15" r="4" fill="rgba(255,255,255,0.55)"/>
  </svg>`;
  el.appendChild(inner);
  el.addEventListener('mouseenter', () => { inner.style.transform = 'scale(1.2) translateY(-3px)'; });
  el.addEventListener('mouseleave', () => { inner.style.transform = 'scale(1)'; });
  el.addEventListener('click', e => { e.stopPropagation(); onClick(gym); });
  return el;
}

function buildOsmPin({ gym, onClick }) {
  const el = document.createElement('button');
  el.type  = 'button';
  el.title = gym.name;
  // Explicit dimensions match the SVG so MapLibre's marker anchor math
  // resolves to a deterministic geo-anchor. Without explicit width/
  // height the button was sized by content with potential baseline
  // gaps from the inline <svg>, which on some browsers gave the
  // marker an offsetHeight of 0 — meaning the marker rendered
  // off-anchor or invisible. The user reported "used to see grey
  // pins, now I don't" after wave 37's pin refactor — restoring
  // explicit dimensions removes that ambiguity.
  Object.assign(el.style, {
    width: '12px', height: '17px',
    background: 'none', border: 'none', padding: '0',
    cursor: 'pointer', display: 'block',
    lineHeight: '0', fontSize: '0',
    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.25))',
  });
  // Inner wrapper for hover transform — MapLibre owns el.style.transform.
  const inner = document.createElement('div');
  Object.assign(inner.style, {
    width: '100%', height: '100%', display: 'block',
    transition: 'transform 120ms ease-out',
    transform: 'scale(1)',
    transformOrigin: 'center bottom',
    willChange: 'transform',
  });
  inner.innerHTML = `<svg width="12" height="17" viewBox="0 0 32 46" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <path d="M16 1C7.72 1 1 7.72 1 16c0 12 15 29 15 29S31 28 31 16C31 7.72 24.28 1 16 1z"
      fill="#9ca3af" stroke="#fff" stroke-width="3"/>
    <circle cx="16" cy="15" r="5" fill="rgba(255,255,255,0.4)"/>
  </svg>`;
  el.appendChild(inner);
  const path = inner.querySelector('path');
  el.addEventListener('mouseenter', () => {
    inner.style.transform = 'scale(1.6) translateY(-2px)';
    if (path) path.setAttribute('fill', '#6b7280');
  });
  el.addEventListener('mouseleave', () => {
    inner.style.transform = 'scale(1)';
    if (path) path.setAttribute('fill', '#9ca3af');
  });
  el.addEventListener('click', e => { e.stopPropagation(); onClick(gym); });
  return el;
}

// ── OSM fetcher ────────────────────────────────────────────────────────
//
// Overpass-api.de is the most popular Overpass mirror and is rate-limited
// + occasionally returns 504 Gateway Timeout. When it does, the previous
// code threw and the catch in the caller silently logged — the grey
// pins simply never appeared. That was the user-reported "I used to see
// grey gym pins, now I don't" symptom.
//
// We now try multiple mirrors in order and return the first success.
// kumi.systems is community-run and historically the most reliable
// secondary; overpass.private.coffee is a CF-fronted mirror.
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function fetchOsmGyms(bounds, zoom, signal) {
  const s   = bounds.getSouth().toFixed(4);
  const w   = bounds.getWest().toFixed(4);
  const n   = bounds.getNorth().toFixed(4);
  const e   = bounds.getEast().toFixed(4);
  // Higher cap on closer zooms so dense international cities (Tokyo,
  // London, Berlin, São Paulo, Seoul) aren't truncated to the first
  // ~1000 results. At zoom >= 11 (neighborhood level) we expect to
  // see every gym in view.
  const cap = zoom >= 11 ? 2500 : zoom >= 7 ? 1000 : 500;
  // Multi-tag query covers the variations international mappers use:
  //   leisure=fitness_centre — the OSM canonical tag (most common)
  //   amenity=gym            — historical / American convention
  //   sport=fitness          — used in parts of Europe + Latin America
  //   leisure=sports_centre + sport=fitness — combo used in Germany,
  //                                            Netherlands, Scandinavia
  //   leisure=fitness_station — outdoor calisthenics parks (visible
  //                              at higher zoom only to avoid clutter)
  // Increased timeout to 25s — dense urban queries (central Tokyo,
  // Manhattan) frequently exceeded the previous 20s on overpass-api.de.
  const includeOutdoor = zoom >= 13;
  const q   =
    `[out:json][timeout:25];(` +
    `node["leisure"="fitness_centre"](${s},${w},${n},${e});` +
    `way["leisure"="fitness_centre"](${s},${w},${n},${e});` +
    `node["amenity"="gym"](${s},${w},${n},${e});` +
    `way["amenity"="gym"](${s},${w},${n},${e});` +
    `node["sport"="fitness"]["leisure"!="fitness_station"](${s},${w},${n},${e});` +
    `way["sport"="fitness"]["leisure"!="fitness_station"](${s},${w},${n},${e});` +
    `node["leisure"="sports_centre"]["sport"~"fitness"](${s},${w},${n},${e});` +
    `way["leisure"="sports_centre"]["sport"~"fitness"](${s},${w},${n},${e});` +
    (includeOutdoor
      ? `node["leisure"="fitness_station"](${s},${w},${n},${e});`
      : '') +
    `);out center ${cap};`;

  let lastErr = null;
  for (const mirror of OVERPASS_MIRRORS) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const res = await fetch(
        `${mirror}?data=${encodeURIComponent(q)}`,
        { signal },
      );
      if (!res.ok) throw new Error(`OSM ${res.status}`);
      const json = await res.json();
      // Dedupe by `osmId` — a single gym tagged with BOTH
      // leisure=fitness_centre AND amenity=gym (common pattern) would
      // otherwise return as two records and render two overlapping
      // pins. Use the first occurrence so the most-canonical tag wins.
      const seenIds = new Set();
      return (json.elements || []).map(el => ({
        osmId:   el.id,
        name:    el.tags?.name || 'Gym',
        lat:     el.type === 'node' ? el.lat : el.center?.lat,
        lon:     el.type === 'node' ? el.lon : el.center?.lon,
        brand:   el.tags?.brand   || null,
        website: el.tags?.website || null,
      })).filter(g => {
        if (!g.lat || !g.lon) return false;
        if (seenIds.has(g.osmId)) return false;
        seenIds.add(g.osmId);
        return true;
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      lastErr = err;
      // Try the next mirror
    }
  }
  throw lastErr || new Error('All Overpass mirrors failed');
}

// ── Component ──────────────────────────────────────────────────────────
export default function GymMap() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const containerRef  = useRef(null);
  const mapRef        = useRef(null);
  const markersRef    = useRef([]);
  const osmMarkersRef = useRef([]);
  const osmAbortRef   = useRef(null);
  const debounceRef   = useRef(null);
  const refreshRef    = useRef(null); // always → latest refreshFromBounds

  const [view,        setView]        = useState('map');
  const [gyms,        setGyms]        = useState([]);
  const [osmGyms,     setOsmGyms]     = useState([]);
  const [selected,    setSelected]    = useState(null);
  const [selectedOsm, setSelectedOsm] = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [mapError,    setMapError]    = useState(null);
  const [search,      setSearch]      = useState('');
  const [searchOpen,  setSearchOpen]  = useState(false);
  const [currentZoom, setCurrentZoom] = useState(US_ZOOM);

  // Keep refreshRef pointing at the latest closure every render.
  // No dep array — cheap ref assignment, runs after every render.
  useEffect(() => {
    refreshRef.current = async () => {
      const map = mapRef.current;
      if (!map) return;
      const b    = map.getBounds();
      const zoom = map.getZoom();

      setLoading(true);
      try {
        const rows = await getGymsInBbox({
          minLat: b.getSouth(), maxLat: b.getNorth(),
          minLng: b.getWest(),  maxLng: b.getEast(),
          limit: 500,
        });
        setGyms(rows ?? []);
      } catch { setGyms([]); }
      finally  { setLoading(false); }

      if (zoom < OSM_ZOOM_MIN) { setOsmGyms([]); return; }

      osmAbortRef.current?.abort();
      const ctrl = new AbortController();
      osmAbortRef.current = ctrl;
      try {
        const dots = await fetchOsmGyms(b, zoom, ctrl.signal);
        if (!ctrl.signal.aborted) setOsmGyms(dots);
      } catch (err) {
        if (err.name !== 'AbortError') console.warn('[GymMap] OSM:', err.message);
      }
    };
  });

  // ── Map init — ONE time on mount ──────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    let map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style:     STYLE_URL,
        center:    US_CENTER,
        zoom:      US_ZOOM,
        minZoom:   2,
        maxZoom:   18,
        attributionControl: { compact: true },
      });
    } catch (err) {
      setMapError(err?.message ?? 'Map failed to initialise');
      return;
    }

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions:   { enableHighAccuracy: true },
        trackUserLocation: false,
        fitBoundsOptions:  { maxZoom: 12 },
      }),
      'top-right',
    );

    // Mirror RouteMap.jsx's error/missing-image handling — OpenFreeMap's
    // Liberty style fires a known-noisy "Expected value to be of type
    // number" warning and references sprite icons that don't exist in
    // the served sheet. Filter the warning and stub the icons so the
    // console stays clean and the map keeps rendering.
    map.on('error', e => {
      const msg = e?.error?.message || String(e?.error || e);
      if (msg.includes('Expected value to be of type number')) return;
      console.warn('[GymMap] map error:', e?.error || e);
    });

    map.on('styleimagemissing', ({ id }) => {
      if (map.hasImage(id)) return;
      map.addImage(id, { width: 1, height: 1, data: new Uint8ClampedArray(4) });
    });

    const scheduleRefresh = () => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => refreshRef.current?.(), MOVE_DEBOUNCE_MS);
    };

    map.on('moveend', scheduleRefresh);
    map.on('zoomend', () => { if (!cancelled) setCurrentZoom(map.getZoom()); });
    map.on('load',    () => {
      if (cancelled) return;
      setCurrentZoom(map.getZoom());
      refreshRef.current?.();
    });

    mapRef.current = map;

    return () => {
      cancelled = true;
      clearTimeout(debounceRef.current);
      osmAbortRef.current?.abort();
      try { map.remove(); } catch { /* ignore */ }
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Flexyn pin rendering ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach(m => { try { m.remove(); } catch { /* ignore */ } });
    markersRef.current = [];

    const compact = currentZoom < 5;
    const q       = search.trim().toLowerCase();
    const visible = q
      ? gyms.filter(g =>
          (g.name || '').toLowerCase().includes(q) ||
          (g.city || '').toLowerCase().includes(q))
      : gyms;

    for (const g of visible) {
      const special = SPECIAL_PIN_CODES.has(g.flexyn_code);
      const el      = special
        ? buildOrangePin({ gym: g, onClick: setSelected })
        : buildFlexynPin({ gym: g, compact, onClick: setSelected });
      const marker  = new maplibregl.Marker({ element: el, anchor: special ? 'bottom' : 'center' })
        .setLngLat([g.longitude, g.latitude])
        .addTo(map);
      markersRef.current.push(marker);
    }
  }, [gyms, currentZoom, search]);

  // ── OSM pin rendering ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    osmMarkersRef.current.forEach(m => { try { m.remove(); } catch { /* ignore */ } });
    osmMarkersRef.current = [];

    for (const g of osmGyms) {
      const el     = buildOsmPin({ gym: g, onClick: setSelectedOsm });
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([g.lon, g.lat])
        .addTo(map);
      osmMarkersRef.current.push(marker);
    }
  }, [osmGyms]);

  // ── Search fly-to ──────────────────────────────────────────────────────
  const flyToMatch = useCallback(() => {
    const map = mapRef.current;
    if (!map || !search.trim()) return;
    const q   = search.trim().toLowerCase();
    const hit = gyms.find(g =>
      (g.name || '').toLowerCase().includes(q) ||
      (g.city || '').toLowerCase().includes(q));
    if (hit) map.flyTo({ center: [hit.longitude, hit.latitude], zoom: 13, duration: 1200 });
  }, [gyms, search]);

  // ── Derived UI values ──────────────────────────────────────────────────
  const q            = search.trim().toLowerCase();
  const visibleCount = q
    ? gyms.filter(g =>
        (g.name || '').toLowerCase().includes(q) ||
        (g.city || '').toLowerCase().includes(q)).length
    : gyms.length;

  // ── Render ─────────────────────────────────────────────────────────────
  // Layout: explicit 100dvh height on the outer wrapper, then header
  // (auto height) + map area with `flex: 1 1 0` AND a hard min-height
  // so the container never collapses to zero if the flex chain
  // mis-resolves (the bug that gave a blank screen on Netlify).
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-background flex flex-col"
      style={{ height: '100dvh', zIndex: 50 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card z-10 shrink-0">
        <button type="button" onClick={() => navigate(-1)}
          className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center"
          aria-label="Back">
          <ArrowLeft className="w-4 h-4" />
        </button>

        <h1 className="font-heading font-bold text-base flex items-center gap-1.5">
          <MapPin className="w-4 h-4 text-primary" />
          Flexyn Gym Map
        </h1>

        <div className="flex items-center gap-1">
          <button type="button"
            onClick={() => setView(v => v === 'leaderboard' ? 'map' : 'leaderboard')}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
              view === 'leaderboard' ? 'bg-yellow-500 text-white' : 'bg-secondary text-foreground'
            }`} aria-label="Toggle leaderboard">
            <Trophy className="w-4 h-4" />
          </button>
          {view === 'map' && (
            <button type="button" onClick={() => setSearchOpen(o => !o)}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                searchOpen ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'
              }`} aria-label="Search gyms">
              <Search className="w-4 h-4" />
            </button>
          )}
          {view === 'leaderboard' && (
            <button type="button" onClick={() => setView('map')}
              className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center"
              aria-label="Back to map">
              <MapIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Search bar */}
      <AnimatePresence>
        {searchOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-border bg-card overflow-hidden shrink-0">
            <div className="px-3 py-2 flex gap-2">
              <Input
                placeholder="Search gym name or city…"
                value={search} onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') flyToMatch(); }}
                autoFocus className="h-9" />
              {search && <Button variant="outline" size="sm" onClick={() => setSearch('')}>Clear</Button>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Leaderboard panel */}
      <AnimatePresence>
        {view === 'leaderboard' && (
          <motion.div key="board"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="flex-1 overflow-y-auto bg-background">
            <GymLeaderboard isAuthed={!!user} onGymPress={id => navigate(`/gym/${id}`)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Map area —
          Explicit min-height + flex:1 belt-and-suspenders. RouteMap.jsx
          ships an inline-style `height` because the absolute-inset-0
          pattern collapsed to 0×0 in some flex contexts; we mirror that
          here: the container element itself carries dimensions, so the
          map renders even if the parent chain mis-resolves. */}
      <div
        className={`relative overflow-hidden ${view === 'leaderboard' ? 'hidden' : ''}`}
        style={{ flex: '1 1 0', minHeight: '300px', isolation: 'isolate', zIndex: 0 }}
      >

        {/* Error state — with retry */}
        {mapError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center z-20 bg-background">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center text-3xl">🗺️</div>
            <div>
              <p className="font-heading font-bold text-base mb-1">Map couldn't load</p>
              <p className="text-xs text-muted-foreground mb-1">{mapError}</p>
              <p className="text-xs text-muted-foreground">Check your connection and try again.</p>
            </div>
            <Button onClick={() => { setMapError(null); window.location.reload(); }}>
              Retry
            </Button>
          </div>
        )}

        {/* MapLibre canvas — explicit width:100% height:100% on the
            ref'd element itself so MapLibre's ResizeObserver always
            sees real dimensions, even before the parent flex resolves. */}
        <div
          ref={containerRef}
          className="absolute inset-0"
          style={{ width: '100%', height: '100%' }}
        />

        {/* Count pill */}
        {!mapError && (
          <div className="absolute bottom-24 left-3 z-10 px-3 py-1.5 rounded-full bg-card/90 backdrop-blur border border-border shadow-md text-xs font-medium flex items-center gap-1.5">
            {loading ? (
              <><Loader2 className="w-3 h-3 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Loading…</span></>
            ) : visibleCount === 0 && osmGyms.length === 0 ? (
              <span className="text-muted-foreground">{search ? 'No matches' : 'Zoom in to find gyms'}</span>
            ) : (
              <span className="text-muted-foreground">
                {visibleCount > 0 && <><span className="text-primary font-bold">{visibleCount}</span> on Flexyn</>}
                {visibleCount > 0 && osmGyms.length > 0 && ' · '}
                {osmGyms.length > 0 && <><span className="font-bold">{osmGyms.length}</span> nearby</>}
              </span>
            )}
          </div>
        )}

        {/* Flexyn gym card */}
        <AnimatePresence>
          {selected && (
            <motion.div key="fcard"
              initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              className="absolute bottom-20 left-3 right-3 z-10 rounded-2xl border border-border bg-card shadow-2xl p-4">
              <button type="button" onClick={() => setSelected(null)}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-secondary text-muted-foreground flex items-center justify-center"
                aria-label="Close">
                <X className="w-3.5 h-3.5" />
              </button>
              <div className="flex items-start gap-3 mb-3 pr-6">
                <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Building2 className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-heading font-bold text-base truncate">{selected.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[selected.city, selected.state_code].filter(Boolean).join(', ')}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Users className="w-3 h-3" />{selected.member_count ?? 0} members
                  </p>
                </div>
              </div>
              <Button className="w-full" onClick={() => navigate(`/gym/${selected.id}`)}>
                View Hub
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* OSM gym card */}
        <AnimatePresence>
          {selectedOsm && !selected && (
            <motion.div key="osmcard"
              initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              className="absolute bottom-20 left-3 right-3 z-10 rounded-2xl border border-border bg-card shadow-2xl p-4">
              <button type="button" onClick={() => setSelectedOsm(null)}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-secondary text-muted-foreground flex items-center justify-center"
                aria-label="Close">
                <X className="w-3.5 h-3.5" />
              </button>
              <div className="flex items-start gap-3 pr-6 mb-3">
                <div className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center shrink-0 text-xl">🏋</div>
                <div className="flex-1 min-w-0">
                  <p className="font-heading font-bold text-base truncate">{selectedOsm.name}</p>
                  <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground">
                    Not on Flexyn yet
                  </span>
                  {selectedOsm.brand && (
                    <p className="text-xs text-muted-foreground mt-1 truncate">{selectedOsm.brand}</p>
                  )}
                  {selectedOsm.website && (
                    <a href={selectedOsm.website} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-primary underline-offset-2 underline mt-1 block truncate">
                      {selectedOsm.website.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </div>
              </div>
              <Button variant="outline" className="w-full"
                onClick={() => { setSelectedOsm(null); navigate('/register-gym'); }}>
                Add this gym to Flexyn 🚀
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
