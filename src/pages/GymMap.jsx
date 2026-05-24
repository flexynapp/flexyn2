// src/pages/GymMap.jsx
//
// National "pinch-to-zoom" Flexyn Map.
// MapLibre GL JS + OpenFreeMap free tiles (or MapTiler when VITE_MAPTILER_KEY is set).
//
// Architecture notes:
//   • maplibreglRef  — stores the maplibre-gl module after one dynamic import.
//     Pin render effects read from this ref (synchronously, no async needed).
//   • refreshRef     — updated every render so map event listeners always call
//     the latest version of refreshFromBounds (avoids stale-closure bugs).
//   • mapRef         — the live Map instance; set AFTER all event listeners so
//     the load callback can safely call refreshRef.current().

import React, { useEffect, useRef, useState, useCallback } from 'react';
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

// ── Constants ─────────────────────────────────────────────────────────
const US_CENTER        = [-98.5795, 39.8283];
const US_ZOOM          = 3.6;
const MOVE_DEBOUNCE_MS = 400;
const OSM_ZOOM_MIN     = 5; // don't query OSM at country view

const MAPTILER_KEY = import.meta.env?.VITE_MAPTILER_KEY || '';
const STYLE_URL    = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
  : 'https://tiles.openfreemap.org/styles/liberty';

// Gyms whose flexyn_code gets the special orange-teardrop pin.
const SPECIAL_PIN_CODES = new Set(['WKF2QPWT']);

// ── Pin builders (pure DOM, no React) ─────────────────────────────────

function buildFlexynPin({ gym, compact, onClick }) {
  const el  = document.createElement('button');
  el.type   = 'button';
  el.title  = gym.name;
  const sz  = compact ? 20 : 34;
  Object.assign(el.style, {
    width: `${sz}px`, height: `${sz}px`, borderRadius: '50%',
    background: 'linear-gradient(135deg,#7c3aed,#4338ca)',
    border: '2px solid #fff', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', fontSize: `${compact ? 10 : 12}px`, fontWeight: '700',
    boxShadow: '0 3px 10px rgba(0,0,0,0.28)',
    transition: 'transform 120ms ease-out',
    padding: '0',
  });
  el.textContent = compact ? '🏋' : (gym.member_count > 0 ? String(gym.member_count) : '🏋');
  el.addEventListener('mouseenter', () => { el.style.transform = 'scale(1.2)'; });
  el.addEventListener('mouseleave', () => { el.style.transform = 'scale(1)'; });
  el.addEventListener('click', (e) => { e.stopPropagation(); onClick(gym); });
  return el;
}

function buildOrangePin({ gym, onClick }) {
  const el = document.createElement('button');
  el.type  = 'button';
  el.title = gym.name;
  Object.assign(el.style, {
    background: 'none', border: 'none', padding: '0',
    cursor: 'pointer', display: 'block',
    transition: 'transform 140ms ease-out',
  });
  el.innerHTML = `<svg width="32" height="46" viewBox="0 0 32 46" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 1C7.72 1 1 7.72 1 16c0 12 15 29 15 29S31 28 31 16C31 7.72 24.28 1 16 1z"
      fill="#f97316" stroke="#fff" stroke-width="2"
      style="filter:drop-shadow(0 3px 4px rgba(0,0,0,0.35))"/>
    <circle cx="16" cy="15" r="7" fill="rgba(255,255,255,0.25)"/>
    <circle cx="16" cy="15" r="4" fill="rgba(255,255,255,0.55)"/>
  </svg>`;
  el.addEventListener('mouseenter', () => { el.style.transform = 'scale(1.2) translateY(-3px)'; });
  el.addEventListener('mouseleave', () => { el.style.transform = 'scale(1)'; });
  el.addEventListener('click', (e) => { e.stopPropagation(); onClick(gym); });
  return el;
}

function buildOsmPin({ gym, onClick }) {
  const el = document.createElement('button');
  el.type  = 'button';
  el.title = gym.name;
  Object.assign(el.style, {
    background: 'none', border: 'none', padding: '0',
    cursor: 'pointer', display: 'block',
    transition: 'transform 120ms ease-out',
    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.25))',
  });
  el.innerHTML = `<svg width="12" height="17" viewBox="0 0 32 46" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path class="osm-path" d="M16 1C7.72 1 1 7.72 1 16c0 12 15 29 15 29S31 28 31 16C31 7.72 24.28 1 16 1z"
      fill="#9ca3af" stroke="#fff" stroke-width="3"/>
    <circle cx="16" cy="15" r="5" fill="rgba(255,255,255,0.4)"/>
  </svg>`;
  const path = el.querySelector('path');
  el.addEventListener('mouseenter', () => {
    el.style.transform = 'scale(1.6) translateY(-2px)';
    if (path) path.setAttribute('fill', '#6b7280');
  });
  el.addEventListener('mouseleave', () => {
    el.style.transform = 'scale(1)';
    if (path) path.setAttribute('fill', '#9ca3af');
  });
  el.addEventListener('click', (e) => { e.stopPropagation(); onClick(gym); });
  return el;
}

// ── OSM fetcher ────────────────────────────────────────────────────────
async function fetchOsmGyms(bounds, zoom, signal) {
  const s   = bounds.getSouth().toFixed(4);
  const w   = bounds.getWest().toFixed(4);
  const n   = bounds.getNorth().toFixed(4);
  const e   = bounds.getEast().toFixed(4);
  const cap = zoom >= 7 ? 1000 : 500;
  const q   =
    `[out:json][timeout:20];` +
    `(node["leisure"="fitness_centre"](${s},${w},${n},${e});` +
    ` node["amenity"="gym"](${s},${w},${n},${e});` +
    ` way["leisure"="fitness_centre"](${s},${w},${n},${e});` +
    ` way["amenity"="gym"](${s},${w},${n},${e}););` +
    `out center ${cap};`;

  const res  = await fetch(
    `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`,
    { signal },
  );
  if (!res.ok) throw new Error(`OSM ${res.status}`);
  const json = await res.json();
  return (json.elements || []).map(el => ({
    osmId:   el.id,
    name:    el.tags?.name || 'Gym',
    lat:     el.type === 'node' ? el.lat : el.center?.lat,
    lon:     el.type === 'node' ? el.lon : el.center?.lon,
    brand:   el.tags?.brand   || null,
    website: el.tags?.website || null,
  })).filter(g => g.lat && g.lon);
}

// ── Component ──────────────────────────────────────────────────────────
export default function GymMap() {
  const navigate   = useNavigate();
  const { user }   = useAuth();

  // DOM / map refs
  const containerRef   = useRef(null);
  const mapRef         = useRef(null);   // MapLibre Map instance
  const mglRef         = useRef(null);   // maplibre-gl module (imported once)
  const markersRef     = useRef([]);     // Flexyn pin markers
  const osmMarkersRef  = useRef([]);     // OSM dot markers
  const osmAbortRef    = useRef(null);   // AbortController for in-flight OSM fetch
  const debounceRef    = useRef(null);   // moveend debounce timer
  const refreshRef     = useRef(null);   // always → latest refreshFromBounds fn

  // UI state
  const [view,        setView]        = useState('map'); // 'map' | 'leaderboard'
  const [gyms,        setGyms]        = useState([]);
  const [osmGyms,     setOsmGyms]     = useState([]);
  const [selected,    setSelected]    = useState(null);
  const [selectedOsm, setSelectedOsm] = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [mapError,    setMapError]    = useState(null);
  const [search,      setSearch]      = useState('');
  const [searchOpen,  setSearchOpen]  = useState(false);
  const [currentZoom, setCurrentZoom] = useState(US_ZOOM);

  // ── Keep refreshRef always pointing to the freshest function ──────────
  // No dependency array → runs after every render. Cheap (just sets a ref).
  useEffect(() => {
    refreshRef.current = async () => {
      const map = mapRef.current;
      if (!map) return;

      const b    = map.getBounds();
      const zoom = map.getZoom();

      // Flexyn gyms
      setLoading(true);
      try {
        const rows = await getGymsInBbox({
          minLat: b.getSouth(), maxLat: b.getNorth(),
          minLng: b.getWest(),  maxLng: b.getEast(),
          limit:  500,
        });
        setGyms(rows ?? []);
      } catch {
        setGyms([]);
      } finally {
        setLoading(false);
      }

      // OSM gyms — only at city / region zoom
      if (zoom < OSM_ZOOM_MIN) {
        setOsmGyms([]);
        return;
      }
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

  // ── Map init (once on mount) ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let map       = null;

    (async () => {
      try {
        const mgl = (await import('maplibre-gl')).default;
        if (cancelled || !containerRef.current) return;

        mglRef.current = mgl;

        map = new mgl.Map({
          container: containerRef.current,
          style:     STYLE_URL,
          center:    US_CENTER,
          zoom:      US_ZOOM,
          minZoom:   2,
          maxZoom:   18,
          attributionControl: { compact: true },
        });

        map.addControl(new mgl.NavigationControl({ showCompass: false }), 'top-right');
        map.addControl(
          new mgl.GeolocateControl({
            positionOptions:  { enableHighAccuracy: true },
            trackUserLocation: false,
            fitBoundsOptions:  { maxZoom: 12 },
          }),
          'top-right',
        );

        const scheduleRefresh = () => {
          clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => refreshRef.current?.(), MOVE_DEBOUNCE_MS);
        };

        map.on('moveend', scheduleRefresh);
        map.on('zoomend', () => setCurrentZoom(map.getZoom()));
        map.on('load', () => {
          if (cancelled) return;
          setCurrentZoom(map.getZoom());
          refreshRef.current?.();   // safe: map is fully ready here
        });

        // Store AFTER event listeners so the load callback finds a live ref
        mapRef.current = map;

      } catch (err) {
        if (!cancelled) {
          console.error('[GymMap] init error:', err);
          setMapError(err?.message ?? 'Map failed to load');
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(debounceRef.current);
      osmAbortRef.current?.abort();
      try { map?.remove(); } catch { /* ignore */ }
      mapRef.current  = null;
      mglRef.current  = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Flexyn pin rendering ─────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const mgl = mglRef.current;
    if (!map || !mgl) return;

    // Remove old markers
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
      const isSpecial = SPECIAL_PIN_CODES.has(g.flexyn_code);
      const el        = isSpecial
        ? buildOrangePin({ gym: g, onClick: setSelected })
        : buildFlexynPin({ gym: g, compact, onClick: setSelected });

      const marker = new mgl.Marker({ element: el, anchor: isSpecial ? 'bottom' : 'center' })
        .setLngLat([g.longitude, g.latitude])
        .addTo(map);
      markersRef.current.push(marker);
    }
  }, [gyms, currentZoom, search]);

  // ── OSM dot rendering ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const mgl = mglRef.current;
    if (!map || !mgl) return;

    osmMarkersRef.current.forEach(m => { try { m.remove(); } catch { /* ignore */ } });
    osmMarkersRef.current = [];

    for (const g of osmGyms) {
      const el     = buildOsmPin({ gym: g, onClick: setSelectedOsm });
      const marker = new mgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([g.lon, g.lat])
        .addTo(map);
      osmMarkersRef.current.push(marker);
    }
  }, [osmGyms]);

  // ── Search fly-to ────────────────────────────────────────────────────
  const flyToMatch = useCallback(() => {
    const map = mapRef.current;
    if (!map || !search.trim()) return;
    const q   = search.trim().toLowerCase();
    const hit = gyms.find(g =>
      (g.name || '').toLowerCase().includes(q) ||
      (g.city || '').toLowerCase().includes(q));
    if (hit) map.flyTo({ center: [hit.longitude, hit.latitude], zoom: 13, duration: 1200 });
  }, [gyms, search]);

  // ── Derived values ───────────────────────────────────────────────────
  const q            = search.trim().toLowerCase();
  const visibleCount = q
    ? gyms.filter(g =>
        (g.name || '').toLowerCase().includes(q) ||
        (g.city || '').toLowerCase().includes(q)).length
    : gyms.length;

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-card flex flex-col"
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card z-10 shrink-0">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <h1 className="font-heading font-bold text-base flex items-center gap-1.5">
          <MapPin className="w-4 h-4 text-primary" />
          Flexyn Gym Map
        </h1>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setView(v => v === 'leaderboard' ? 'map' : 'leaderboard')}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
              view === 'leaderboard' ? 'bg-yellow-500 text-white' : 'bg-secondary text-foreground'
            }`}
            aria-label="Toggle leaderboard"
          >
            <Trophy className="w-4 h-4" />
          </button>

          {view === 'map' && (
            <button
              type="button"
              onClick={() => setSearchOpen(o => !o)}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                searchOpen ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'
              }`}
              aria-label="Search gyms"
            >
              <Search className="w-4 h-4" />
            </button>
          )}

          {view === 'leaderboard' && (
            <button
              type="button"
              onClick={() => setView('map')}
              className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center"
              aria-label="Back to map"
            >
              <MapIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── Search bar ── */}
      <AnimatePresence>
        {searchOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-border bg-card overflow-hidden shrink-0"
          >
            <div className="px-3 py-2 flex gap-2">
              <Input
                placeholder="Search gym name or city…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') flyToMatch(); }}
                autoFocus
                className="h-9"
              />
              {search && (
                <Button variant="outline" size="sm" onClick={() => setSearch('')}>
                  Clear
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Leaderboard panel ── */}
      <AnimatePresence>
        {view === 'leaderboard' && (
          <motion.div
            key="leaderboard"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="flex-1 overflow-y-auto bg-background"
          >
            <GymLeaderboard
              isAuthed={!!user}
              onGymPress={gymId => navigate(`/gym/${gymId}`)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Map container ── */}
      <div className={`flex-1 relative overflow-hidden ${view === 'leaderboard' ? 'hidden' : ''}`}>

        {/* Map error state */}
        {mapError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10">
            <MapPin className="w-8 h-8 text-muted-foreground mb-3" />
            <p className="text-sm font-medium mb-1">Map failed to load</p>
            <p className="text-xs text-muted-foreground">{mapError}</p>
          </div>
        )}

        {/* The MapLibre canvas fills this div */}
        <div ref={containerRef} className="absolute inset-0" />

        {/* ── Count pill ── */}
        <div className="absolute bottom-24 left-3 z-10 px-3 py-1.5 rounded-full bg-card/90 backdrop-blur border border-border shadow-md text-xs font-medium flex items-center gap-1.5">
          {loading ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Loading…</span>
            </>
          ) : visibleCount === 0 && osmGyms.length === 0 ? (
            <span className="text-muted-foreground">
              {search ? 'No matches' : 'No gyms in view — zoom out'}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {visibleCount > 0 && (
                <span><span className="text-primary font-bold">{visibleCount}</span> on Flexyn</span>
              )}
              {visibleCount > 0 && osmGyms.length > 0 && ' · '}
              {osmGyms.length > 0 && (
                <span><span className="font-bold">{osmGyms.length}</span> nearby</span>
              )}
            </span>
          )}
        </div>

        {/* ── Flexyn gym card ── */}
        <AnimatePresence>
          {selected && (
            <motion.div
              key="flexyn-card"
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              className="absolute bottom-20 left-3 right-3 z-10 rounded-2xl border border-border bg-card shadow-2xl p-4"
            >
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-secondary text-muted-foreground flex items-center justify-center"
                aria-label="Close"
              >
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
                    <Users className="w-3 h-3" />
                    {selected.member_count ?? 0} members
                  </p>
                </div>
              </div>

              <Button className="w-full" onClick={() => navigate(`/gym/${selected.id}`)}>
                View Hub
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── OSM gym card ── */}
        <AnimatePresence>
          {selectedOsm && !selected && (
            <motion.div
              key="osm-card"
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              className="absolute bottom-20 left-3 right-3 z-10 rounded-2xl border border-border bg-card shadow-2xl p-4"
            >
              <button
                type="button"
                onClick={() => setSelectedOsm(null)}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-secondary text-muted-foreground flex items-center justify-center"
                aria-label="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>

              <div className="flex items-start gap-3 pr-6 mb-3">
                <div className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center shrink-0 text-xl">
                  🏋
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-heading font-bold text-base truncate">{selectedOsm.name}</p>
                  <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground">
                    Not on Flexyn yet
                  </span>
                  {selectedOsm.brand && (
                    <p className="text-xs text-muted-foreground mt-1 truncate">{selectedOsm.brand}</p>
                  )}
                  {selectedOsm.website && (
                    <a
                      href={selectedOsm.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary underline-offset-2 underline mt-1 block truncate"
                    >
                      {selectedOsm.website.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => { setSelectedOsm(null); navigate('/register-gym'); }}
              >
                Add this gym to Flexyn 🚀
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
