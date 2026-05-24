// src/pages/GymMap.jsx
//
// National "pinch-to-zoom" Flexyn Map.
//
// Tech: MapLibre GL JS + OpenFreeMap free tiles (or MapTiler when
// VITE_MAPTILER_KEY is set). Same pattern as the cardio RouteMap.
//
// UX:
//   • Initial view: contiguous-US center at zoom 3.6 for the macro
//     "wow" view.
//   • On every moveend (debounced 300ms), re-query gyms in the
//     current bbox. Cap 500 per query; viewport-driven so density
//     scales with zoom.
//   • Search bar at the top filters the loaded set by name / city.
//   • Pins are custom gradient circles with the member-count baked
//     in — at zoom < 5 the count is hidden and pins shrink so the
//     map doesn't become a sea of numbers.
//   • Tap a pin → bottom card with name, city, member count, and a
//     "View hub" CTA.
//   • Empty bbox (no gyms in view) shows a friendly hint to zoom out
//     or search, NOT a blank map.

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Building2, MapPin, Users, X, Loader2, Search, Trophy, Map } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getGymsInBbox } from '@/lib/data/gymBusinesses';
import GymLeaderboard from '@/components/gyms/GymLeaderboard';
import { useAuth } from '@/lib/AuthContext';

const US_CENTER = [-98.5795, 39.8283];
const US_ZOOM   = 3.6;
const MOVE_DEBOUNCE_MS = 300;

const MAPTILER_KEY = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAPTILER_KEY) || '';
const STYLE_URL = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
  : 'https://tiles.openfreemap.org/styles/liberty';

// Build a pin DOM element. Larger + count visible at city zoom,
// smaller + count hidden at country zoom so the visual stays clean.
function buildPinElement({ gym, compact, onClick }) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'gym-map-pin';
  el.title = gym.name;
  const size = compact ? 22 : 36;
  el.style.cssText = [
    `width:${size}px;height:${size}px;border-radius:50%;`,
    'background:linear-gradient(135deg,#7c3aed,#4338ca);',
    'border:2px solid #fff;cursor:pointer;display:flex;',
    'align-items:center;justify-content:center;color:#fff;',
    `font-size:${compact ? 11 : 13}px;font-weight:700;`,
    'box-shadow:0 4px 12px rgba(0,0,0,0.25);',
    'transition:transform 120ms ease-out;',
  ].join('');
  el.textContent = compact ? '🏋' : (gym.member_count > 0 ? String(gym.member_count) : '🏋');
  el.onmouseenter = () => { el.style.transform = 'scale(1.18)'; };
  el.onmouseleave = () => { el.style.transform = 'scale(1)'; };
  el.onclick = (e) => { e.stopPropagation(); onClick?.(gym); };
  return el;
}

export default function GymMap() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const debounceRef = useRef(null);

  const [view, setView] = useState('map'); // 'map' | 'leaderboard'
  const [gyms, setGyms] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [mapError, setMapError] = useState(null);
  const [currentZoom, setCurrentZoom] = useState(US_ZOOM);

  // ── Map init (once on mount) ───────────────────────────────────────
  useEffect(() => {
    let map = null;
    let cancelled = false;

    (async () => {
      try {
        const maplibregl = (await import('maplibre-gl')).default;
        if (cancelled || !containerRef.current) return;

        map = new maplibregl.Map({
          container: containerRef.current,
          style: STYLE_URL,
          center: US_CENTER,
          zoom:   US_ZOOM,
          minZoom: 2,
          maxZoom: 18,
          attributionControl: { compact: true },
        });

        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
        map.addControl(
          new maplibregl.GeolocateControl({
            positionOptions: { enableHighAccuracy: true },
            trackUserLocation: false,
            showUserHeading: false,
            fitBoundsOptions: { maxZoom: 11 },
          }),
          'top-right',
        );

        // Debounced refresh so a sustained pan doesn't fire 30 RPCs.
        const scheduleRefresh = () => {
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(refreshFromBounds, MOVE_DEBOUNCE_MS);
        };
        map.on('moveend', scheduleRefresh);
        map.on('zoomend', () => setCurrentZoom(map.getZoom()));
        map.on('load',    refreshFromBounds);
        map.on('load',    () => setCurrentZoom(map.getZoom()));

        mapRef.current = map;
      } catch (err) {
        if (!cancelled) {
          console.error('[GymMap] init failed:', err);
          setMapError(err?.message || 'Map failed to load');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      try { map?.remove(); } catch { /* ignore */ }
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshFromBounds = async () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    setLoading(true);
    const rows = await getGymsInBbox({
      minLat: b.getSouth(), maxLat: b.getNorth(),
      minLng: b.getWest(),  maxLng: b.getEast(),
      limit: 500,
    });
    setGyms(rows);
    setLoading(false);
  };

  // ── Pin rendering (on gyms / zoom change) ──────────────────────────
  // At zoom < 5 (~ country view), pins shrink + drop the member count
  // so the map doesn't look like a sea of small numbers. At zoom ≥ 5
  // (city view), pins are full-size with the count baked in.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    (async () => {
      const maplibregl = (await import('maplibre-gl')).default;
      markersRef.current.forEach(m => { try { m.remove(); } catch {} });
      markersRef.current = [];
      const compact = currentZoom < 5;
      // Apply search filter if present
      const filter = search.trim().toLowerCase();
      const visible = filter
        ? gyms.filter(g => (g.name || '').toLowerCase().includes(filter) ||
                            (g.city || '').toLowerCase().includes(filter))
        : gyms;
      for (const g of visible) {
        const el = buildPinElement({ gym: g, compact, onClick: setSelected });
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([g.longitude, g.latitude])
          .addTo(map);
        markersRef.current.push(marker);
      }
    })();
  }, [gyms, currentZoom, search]);

  // When a search match exists, smooth-pan to it.
  const flyToSearchMatch = () => {
    const map = mapRef.current;
    if (!map || !search.trim()) return;
    const filter = search.trim().toLowerCase();
    const match = gyms.find(g =>
      (g.name || '').toLowerCase().includes(filter) ||
      (g.city || '').toLowerCase().includes(filter));
    if (match) {
      map.flyTo({ center: [match.longitude, match.latitude], zoom: 13, duration: 1200 });
    }
  };

  const visibleCount = (() => {
    const filter = search.trim().toLowerCase();
    if (!filter) return gyms.length;
    return gyms.filter(g => (g.name || '').toLowerCase().includes(filter) ||
                             (g.city || '').toLowerCase().includes(filter)).length;
  })();

  const isCountryView = currentZoom < 5;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-card flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card z-10">
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
          {/* Leaderboard toggle */}
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
          {/* Search (only relevant in map view) */}
          {view === 'map' && (
            <button
              type="button"
              onClick={() => setSearchOpen(o => !o)}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                searchOpen ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'
              }`}
              aria-label="Search"
            >
              <Search className="w-4 h-4" />
            </button>
          )}
          {view === 'leaderboard' && (
            <button
              type="button"
              onClick={() => setView('map')}
              className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center transition-colors"
              aria-label="Back to map"
            >
              <Map className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Search bar — slides in when toggled */}
      <AnimatePresence>
        {searchOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-border bg-card overflow-hidden z-10"
          >
            <div className="px-3 py-2 flex gap-2">
              <Input
                placeholder="Search by gym name or city…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') flyToSearchMatch(); }}
                autoFocus
                className="h-9"
              />
              {search && (
                <Button variant="outline" size="sm" onClick={() => setSearch('')}>Clear</Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Leaderboard panel — slides over the map */}
      <AnimatePresence>
        {view === 'leaderboard' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="flex-1 overflow-y-auto bg-background"
          >
              <GymLeaderboard
                isAuthed={!!user}
                onGymPress={(gymId) => navigate(`/gym/${gymId}`)}
              />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Map container */}
      <div className={`flex-1 relative ${view === 'leaderboard' ? 'hidden' : ''}`}>
        {mapError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            <p className="text-sm text-muted-foreground">Map failed to load.</p>
            <p className="text-xs text-muted-foreground mt-1">{mapError}</p>
          </div>
        ) : (
          <div ref={containerRef} className="absolute inset-0" />
        )}

        {/* Count pill — bottom-left. Adapts copy to zoom level. */}
        <div className="absolute bottom-24 left-3 px-3 py-1.5 rounded-full bg-card border border-border shadow-md text-xs font-bold tabular-nums flex items-center gap-1.5">
          {loading ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Loading…</span>
            </>
          ) : visibleCount === 0 ? (
            <span className="text-muted-foreground">
              {search ? 'No matches — try a different city' : 'No gyms here — pinch out to find some'}
            </span>
          ) : (
            <>
              <span className="text-primary text-sm">{visibleCount}</span>
              <span className="text-muted-foreground">
                gym{visibleCount === 1 ? '' : 's'} {isCountryView ? 'nationwide' : 'in view'}
              </span>
            </>
          )}
        </div>

        {/* Selected pin card */}
        <AnimatePresence>
          {selected && (
            <motion.div
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              className="absolute bottom-20 left-3 right-3 rounded-2xl border border-border bg-card shadow-2xl p-4"
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
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                    <Users className="w-3 h-3" />
                    <span className="tabular-nums">{selected.member_count ?? 0}</span> members
                  </p>
                </div>
              </div>
              <Button onClick={() => navigate(`/gym/${selected.id}`)} className="w-full">
                View hub
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
