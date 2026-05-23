// src/pages/GymMap.jsx
//
// National "pinch-to-zoom" Flexyn Map.
//
// Tech: MapLibre GL JS with the free OpenFreeMap (or MapTiler if a
// key is provided) tile source — same pattern as the cardio RouteMap.
// Pin layer is rendered as a Markers cluster — on every moveend we
// re-query `get_gyms_in_bbox` for the current viewport and rebuild
// the pin set.
//
// Initial view: centered on the geographic center of the contiguous
// US at zoom 3.5 — frames the whole country so the "wow factor"
// macro view lands.
//
// Tapping a pin opens a card with the gym name + city + member count
// + a "View hub" CTA that routes to /gym/:id. The user can join the
// gym from inside the hub after navigating there.

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Building2, MapPin, Users, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getGymsInBbox } from '@/lib/data/gymBusinesses';

// US contiguous center (Lebanon, KS area)
const US_CENTER = [-98.5795, 39.8283];
const US_ZOOM   = 3.6;

// MapTiler key reuse: same env var as RouteMap so users only configure once.
const MAPTILER_KEY = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAPTILER_KEY) || '';
const STYLE_URL = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
  : 'https://tiles.openfreemap.org/styles/liberty';

export default function GymMap() {
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]); // keep refs so we can clean on rebuild

  const [gyms, setGyms] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState(null);

  // Set up the map ONCE on mount. Pin re-rendering happens in a
  // separate effect that depends on `gyms`.
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

        // Try to geolocate the user once on first load — if they
        // grant, pan to their area at city zoom. Soft-fails on
        // denial / unsupported.
        map.addControl(
          new maplibregl.GeolocateControl({
            positionOptions: { enableHighAccuracy: true },
            trackUserLocation: false,
            showUserHeading: false,
            fitBoundsOptions: { maxZoom: 11 },
          }),
          'top-right',
        );

        map.on('moveend', refreshFromBounds);
        map.on('load', refreshFromBounds);

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
      try { map?.remove(); } catch { /* ignore */ }
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Whenever the map moves, re-query gyms in the new bounding box.
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

  // Render markers whenever `gyms` changes. Clean up old markers
  // first so we don't leak DOM nodes on pan-heavy sessions.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    (async () => {
      const maplibregl = (await import('maplibre-gl')).default;
      // Clear old
      markersRef.current.forEach(m => { try { m.remove(); } catch {} });
      markersRef.current = [];
      // Build new
      for (const g of gyms) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'gym-map-pin';
        el.title = g.name;
        // Inline styles so this works without a Tailwind/postcss pass
        // touching the maplibre-injected DOM node.
        el.style.cssText = [
          'width:34px;height:34px;border-radius:50%;',
          'background:linear-gradient(135deg,#7c3aed,#4338ca);',
          'border:2px solid #fff;cursor:pointer;display:flex;',
          'align-items:center;justify-content:center;color:#fff;',
          'font-size:14px;font-weight:700;',
          'box-shadow:0 4px 12px rgba(0,0,0,0.25);',
        ].join('');
        // Tiny dumbbell glyph (emoji is lazier than an SVG)
        el.textContent = '🏋';
        el.onclick = (e) => { e.stopPropagation(); setSelected(g); };
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([g.longitude, g.latitude])
          .addTo(map);
        markersRef.current.push(marker);
      }
    })();
  }, [gyms]);

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
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="font-heading font-bold text-base flex items-center gap-1.5">
          <MapPin className="w-4 h-4 text-primary" />
          Flexyn Gym Map
        </h1>
        <div className="w-8 flex items-center justify-center">
          {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* Map container */}
      <div className="flex-1 relative">
        {mapError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            <p className="text-sm text-muted-foreground">Map failed to load.</p>
            <p className="text-xs text-muted-foreground mt-1">{mapError}</p>
          </div>
        ) : (
          <div ref={containerRef} className="absolute inset-0" />
        )}

        {/* Count pill — bottom-left */}
        {!loading && gyms.length > 0 && (
          <div className="absolute bottom-24 left-3 px-2.5 py-1 rounded-full bg-card border border-border shadow-md text-xs font-bold tabular-nums">
            <span className="text-primary">{gyms.length}</span> gym{gyms.length === 1 ? '' : 's'} in view
          </div>
        )}

        {/* Selected pin card */}
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
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-start gap-3 mb-3">
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0 pr-6">
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
      </div>
    </motion.div>
  );
}
