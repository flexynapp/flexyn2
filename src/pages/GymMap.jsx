// src/pages/GymMap.jsx
// Gym discovery map — static import of maplibre-gl (same pattern as RouteMap.jsx).
// Dynamic import caused chunk-load errors that triggered the ErrorBoundary reload
// loop; static import eliminates that failure mode entirely.

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
// CSS is imported globally in main.jsx (same as RouteMap.jsx)
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Building2, MapPin, Users, X,
  Loader2, Search, Trophy, Map as MapIcon, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getGymsInBbox } from '@/lib/data/gymBusinesses';
import { fetchOsmGyms, OSM_ZOOM_MIN } from '@/lib/osmGyms';
// Extracted so it is testable without dragging maplibre-gl into jsdom;
// the head comment there records why the search was covering one layer.
import {
  matchesFlexynGym, matchesOsmGym, normalizeQuery,
} from '@/lib/gymSearch';
import {
  setHomeGym, setHomeGymFromOsm, resolveHomeGymId, getHomeGym,
} from '@/lib/data/homeGym';
import { toast } from '@/lib/toast';
import GymLeaderboard from '@/components/gyms/GymLeaderboard';
import { useAuth } from '@/lib/AuthContext';

// ── Constants ──────────────────────────────────────────────────────────
const US_CENTER        = [-98.5795, 39.8283];
const US_ZOOM          = 3.6;
const MOVE_DEBOUNCE_MS = 400;

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
function buildFlexynPin({ gym, compact, onClick, signal, isHome = false }) {
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
  // The user's OWN gym gets a star. Colour alone can't carry this —
  // grey already means two things here — and "which pin is mine?" was
  // repeatedly answered wrong by eye.
  if (isHome) {
    const badge = document.createElement('div');
    Object.assign(badge.style, {
      position: 'absolute', top: '-6px', insetInlineEnd: '-6px',
      width: '16px', height: '16px', borderRadius: '50%',
      background: '#f59e0b', border: '2px solid #fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '9px', lineHeight: '1', color: '#fff',
      boxShadow: '0 1px 3px rgba(0,0,0,0.35)', pointerEvents: 'none',
    });
    badge.textContent = '★';
    el.style.position = 'relative';
    el.appendChild(badge);
  }
  // signal: an AbortSignal from the caller's effect so all listeners
  // tear down together when the marker (or the parent map) unmounts.
  // Without this, removed markers' closures kept onClick + the gym
  // object pinned in memory after the map cleared.
  const opts = signal ? { signal } : undefined;
  el.addEventListener('mouseenter', () => { inner.style.transform = 'scale(1.2)'; }, opts);
  el.addEventListener('mouseleave', () => { inner.style.transform = 'scale(1)'; }, opts);
  el.addEventListener('click', e => { e.stopPropagation(); onClick(gym); }, opts);
  return el;
}

// Community gym bubble (migration 275) — a gym somebody declared as
// their home gym during onboarding, promoted from an OpenStreetMap
// entry. Same bubble SHAPE as a Flexyn business pin because it is a real
// place with real members and a real leaderboard, but grey rather than
// purple because nobody has proven they own it.
//
// The three map tiers read at a glance:
//   purple bubble  — verified Flexyn business
//   grey bubble    — community gym, members train here (this one)
//   grey teardrop  — an OSM gym nobody has picked yet
//
// Grey is shared with the OSM teardrop deliberately: both mean
// "unclaimed". Shape is what separates "has a community" from "just
// exists on a map".
function buildCommunityPin({ gym, compact, onClick, signal, isHome = false }) {
  const el = document.createElement('button');
  el.type = 'button';
  el.title = gym.name;
  const sz = compact ? 18 : 30;
  Object.assign(el.style, {
    width: `${sz}px`, height: `${sz}px`,
    background: 'none', border: 'none', padding: '0',
    cursor: 'pointer', display: 'block',
  });
  // Inner wrapper carries the hover transform — MapLibre owns the outer
  // element's transform (see buildFlexynPin).
  const inner = document.createElement('div');
  Object.assign(inner.style, {
    width: '100%', height: '100%', borderRadius: '50%',
    background: 'linear-gradient(135deg,#9ca3af,#6b7280)',
    border: '2.5px solid #fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', fontSize: `${compact ? 9 : 11}px`, fontWeight: '700',
    boxShadow: '0 3px 10px rgba(0,0,0,0.28)',
    transition: 'transform 120ms ease-out',
    transform: 'scale(1)',
    willChange: 'transform',
  });
  inner.textContent = compact ? '' : (gym.member_count > 0 ? String(gym.member_count) : '🏋');
  el.appendChild(inner);
  // The user's OWN gym gets a star. Colour alone can't carry this —
  // grey already means two things here — and "which pin is mine?" was
  // repeatedly answered wrong by eye.
  if (isHome) {
    const badge = document.createElement('div');
    Object.assign(badge.style, {
      position: 'absolute', top: '-6px', insetInlineEnd: '-6px',
      width: '16px', height: '16px', borderRadius: '50%',
      background: '#f59e0b', border: '2px solid #fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '9px', lineHeight: '1', color: '#fff',
      boxShadow: '0 1px 3px rgba(0,0,0,0.35)', pointerEvents: 'none',
    });
    badge.textContent = '★';
    el.style.position = 'relative';
    el.appendChild(badge);
  }
  const opts = signal ? { signal } : undefined;
  el.addEventListener('mouseenter', () => { inner.style.transform = 'scale(1.2)'; }, opts);
  el.addEventListener('mouseleave', () => { inner.style.transform = 'scale(1)'; }, opts);
  el.addEventListener('click', e => { e.stopPropagation(); onClick(gym); }, opts);
  return el;
}

function buildOrangePin({ gym, onClick, signal }) {
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
  const opts = signal ? { signal } : undefined;
  el.addEventListener('mouseenter', () => { inner.style.transform = 'scale(1.2) translateY(-3px)'; }, opts);
  el.addEventListener('mouseleave', () => { inner.style.transform = 'scale(1)'; }, opts);
  el.addEventListener('click', e => { e.stopPropagation(); onClick(gym); }, opts);
  return el;
}

function buildOsmPin({ gym, onClick, signal }) {
  const el = document.createElement('button');
  el.type  = 'button';
  el.title = gym.name;
  // Explicit dimensions match the SVG so MapLibre's marker anchor math
  // resolves to a deterministic geo-anchor. Wave 37/38 history aside,
  // the touch target is now 18×24 (was 12×17). 12px wide pins are
  // brutally hard to tap on a phone (Apple HIG recommends 44pt
  // minimum; we get closer with this size + the surrounding inline
  // SVG's effective halo from the drop-shadow filter).
  Object.assign(el.style, {
    width: '18px', height: '24px',
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
  inner.innerHTML = `<svg width="18" height="24" viewBox="0 0 32 46" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <path d="M16 1C7.72 1 1 7.72 1 16c0 12 15 29 15 29S31 28 31 16C31 7.72 24.28 1 16 1z"
      fill="#9ca3af" stroke="#fff" stroke-width="3"/>
    <circle cx="16" cy="15" r="5" fill="rgba(255,255,255,0.4)"/>
  </svg>`;
  el.appendChild(inner);
  const path = inner.querySelector('path');
  const opts = signal ? { signal } : undefined;
  el.addEventListener('mouseenter', () => {
    inner.style.transform = 'scale(1.6) translateY(-2px)';
    if (path) path.setAttribute('fill', '#6b7280');
  }, opts);
  el.addEventListener('mouseleave', () => {
    inner.style.transform = 'scale(1)';
    if (path) path.setAttribute('fill', '#9ca3af');
  }, opts);
  el.addEventListener('click', e => { e.stopPropagation(); onClick(gym); }, opts);
  return el;
}

// ── OSM fetcher ────────────────────────────────────────────────────────
//
// Moved to src/lib/osmGyms.js so the onboarding gym picker can share it
// without importing this page (and with it, all of maplibre-gl). The
// mirror-racing / abort behaviour is unchanged — see that file for why
// it races rather than falls back sequentially.

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
  const [osmError,    setOsmError]    = useState(null);   // last fetchOsmGyms error message
  const [osmLoading,  setOsmLoading]  = useState(false);  // grey-pin fetch in flight
  const [search,      setSearch]      = useState('');
  const [searchOpen,  setSearchOpen]  = useState(false);
  const [currentZoom, setCurrentZoom] = useState(US_ZOOM);
  // "Search this area" button — Google Maps / Yelp pattern. Shows
  // when the user has moved the map since the last fetch. Tap to
  // force a refresh, which is more reliable than waiting on the
  // moveend auto-debounce + acts as a manual retry when the previous
  // auto-fetch silently failed (rate-limit, transient timeout).
  const [hasMovedSinceFetch, setHasMovedSinceFetch] = useState(false);

  // Home gym (mig 275). Tracked locally as well as on the profile so the
  // card flips to "My gym ✓" the moment the RPC returns — AuthContext
  // snapshots the profile and won't reflect the write until it reloads.
  const [homeGymId, setHomeGymId] = useState(user?.home_gym_id || null);
  const [homeGymName, setHomeGymName] = useState(null);
  const [settingHome, setSettingHome] = useState(false);

  // Resolve from the profile, not from AuthContext alone — see
  // resolveHomeGymId. The context snapshot is stale straight after a
  // pick made in onboarding or on another device, and this chip is
  // supposed to be the authoritative answer to "is my gym set?", so it
  // must not be the thing repeating a stale null.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = await resolveHomeGymId(user?.home_gym_id);
      if (cancelled) return;
      setHomeGymId(id);
      if (!id) { setHomeGymName(null); return; }
      const g = await getHomeGym(id);
      if (!cancelled) setHomeGymName(g?.name || null);
    })();
    return () => { cancelled = true; };
  }, [user?.home_gym_id]);

  const isHome = useCallback(
    (gymId) => !!gymId && homeGymId === gymId,
    [homeGymId],
  );

  const adoptGym = useCallback(async (gym) => {
    if (!gym?.id || settingHome) return;
    setSettingHome(true);
    const res = await setHomeGym(gym.id);
    setSettingHome(false);
    if (res.ok) {
      setHomeGymId(res.gymId);
      setHomeGymName(gym.name);
      // The `action` is load-bearing: src/lib/toast.js suppresses every
      // non-error toast that doesn't carry one, so a plain toast.success
      // here renders nothing at all and a successful save looks
      // identical to a no-op.
      toast.success(`${gym.name} is now your gym.`, {
        action: {
          label: 'Undo',
          onClick: async () => {
            await setHomeGym(null);
            setHomeGymId(null);
            setHomeGymName(null);
          },
        },
      });
    } else {
      toast.error("Couldn't set your gym — try again.");
    }
  }, [settingHome]);

  const adoptOsmGym = useCallback(async (osm) => {
    if (!osm?.osmId || settingHome) return;
    setSettingHome(true);
    const res = await setHomeGymFromOsm(osm);
    setSettingHome(false);
    if (res.ok) {
      setHomeGymId(res.gymId);
      setSelectedOsm(null);
      setHomeGymName(osm.name);
      // See adoptGym — a success toast without an action is silenced.
      toast.success(`${osm.name} is now your gym.`, {
        action: {
          label: 'Undo',
          onClick: async () => {
            await setHomeGym(null);
            setHomeGymId(null);
            setHomeGymName(null);
            refreshRef.current?.();
          },
        },
      });
      // The gym exists in gym_businesses now, so re-read the viewport to
      // swap its live OSM teardrop for a real community bubble.
      refreshRef.current?.();
    } else {
      const msg = {
        NAME_REJECTED: "That gym's name can't be added automatically.",
        CREATE_LIMIT: "You've added a lot of gyms already — pick an existing one.",
      }[res.error];
      toast.error(msg || "Couldn't set your gym — try again.");
    }
  }, [settingHome]);

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

      if (zoom < OSM_ZOOM_MIN) {
        setOsmGyms([]); setOsmError(null); setOsmLoading(false);
        // We DID fetch (for the Flexyn pins); clear the "has moved"
        // banner even though we skipped OSM at this zoom level.
        setHasMovedSinceFetch(false);
        return;
      }

      osmAbortRef.current?.abort();
      const ctrl = new AbortController();
      osmAbortRef.current = ctrl;
      setOsmLoading(true);
      setOsmError(null);
      try {
        // fetchOsmGyms now takes plain numbers rather than a MapLibre
        // LngLatBounds, so callers without a map (the onboarding gym
        // picker) can use it too.
        const dots = await fetchOsmGyms(
          {
            south: b.getSouth(), west: b.getWest(),
            north: b.getNorth(), east: b.getEast(),
          },
          { zoom, signal: ctrl.signal },
        );
        if (!ctrl.signal.aborted) {
          setOsmGyms(dots);
          setOsmError(null);
          setHasMovedSinceFetch(false);
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('[GymMap] OSM:', err.message);
          if (!ctrl.signal.aborted) setOsmError(err.message || 'Could not load nearby gyms');
        }
      } finally {
        // ALWAYS clear loading, abort or not. The previous version
        // only cleared when ctrl wasn't aborted, on the theory that
        // an in-flight superseding fetch would clear it later. But
        // if the superseding fetch never resolved (timeout, network
        // dead, code crash), the user was stuck on "Finding nearby
        // gyms…" forever. Only the LATEST fetch's value actually
        // gets applied to the UI; clearing loading from an aborted
        // earlier fetch is harmless because the next fetch
        // immediately sets it true again before the user sees the
        // transition.
        //
        // Sequence-guard via the `osmAbortRef === ctrl` check: only
        // clear loading if THIS invocation is still the active one.
        // If a newer fetch took over, IT owns the loading state now.
        if (osmAbortRef.current === ctrl) {
          setOsmLoading(false);
        }
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
    // Fire `hasMovedSinceFetch` immediately on user input so the
    // "Search this area" pill is visible during the pan/zoom itself,
    // not just after they let go. The auto-debounce still kicks off
    // a fetch on moveend; the button is a parallel manual path.
    // Filter to user-originated moves (originalEvent present) so the
    // map's own programmatic moves (flyTo, GeolocateControl) don't
    // trigger the button.
    map.on('movestart', (e) => {
      if (!cancelled && e.originalEvent) setHasMovedSinceFetch(true);
    });
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
      // Abort any in-flight OSM fetch + null the ref so the fetch's
      // `finally` doesn't try to setOsmLoading(false) on an unmounted
      // component (React 18 swallows the warning but it's a leak
      // signal). The sequence-guard at line 359 checks
      // `osmAbortRef.current === ctrl`; nulling here makes that check
      // false, so the unmounted-setState path is skipped. Wave 56
      // (GymMap audit) flagged this.
      osmAbortRef.current?.abort();
      osmAbortRef.current = null;
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

    // AbortController + signal passed to every pin builder so all
    // hover + click listeners tear down in one shot on effect cleanup.
    // Without this, removed markers' onClick closures pinned the gym
    // objects in memory after re-rendering the pin set (re-search,
    // re-zoom, re-load).
    const ac = new AbortController();
    const compact = currentZoom < 5;
    const q       = normalizeQuery(search);
    const visible = gyms.filter(g => matchesFlexynGym(q, g));

    for (const g of visible) {
      const special = SPECIAL_PIN_CODES.has(g.flexyn_code);
      const el      = special
        ? buildOrangePin({ gym: g, onClick: setSelected, signal: ac.signal })
        : g.source === 'community'
          ? buildCommunityPin({ gym: g, compact, onClick: setSelected, signal: ac.signal, isHome: g.id === homeGymId })
          : buildFlexynPin({ gym: g, compact, onClick: setSelected, signal: ac.signal, isHome: g.id === homeGymId });
      const marker  = new maplibregl.Marker({ element: el, anchor: special ? 'bottom' : 'center' })
        .setLngLat([g.longitude, g.latitude])
        .addTo(map);
      markersRef.current.push(marker);
    }
    return () => { ac.abort(); };
  }, [gyms, currentZoom, search, homeGymId]);

  // Suppress the live Overpass teardrop for any gym already promoted to
  // a community gym (mig 275). Both layers describe the same physical
  // place — the database row came FROM this OSM feature — so without
  // this the promoted gym renders twice: a grey community bubble from
  // `gyms` and a grey OSM teardrop from `osmGyms`, metres apart, only
  // one of which is tappable into a leaderboard.
  //
  // Keyed on type/id together because OSM ids are only unique within a
  // type; node/123 and way/123 are different places.
  //
  // Declared HERE, above the effect that reads it, because a deps array
  // is evaluated synchronously when useEffect is called — a const
  // declared further down is still in TDZ at that point. See the TDZ
  // section in CLAUDE.md.
  const claimedOsmKeys = useMemo(() => new Set(
    gyms.filter(g => g.osm_id != null).map(g => `${g.osm_type || 'node'}/${g.osm_id}`),
  ), [gyms]);

  // ── OSM pin rendering ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    osmMarkersRef.current.forEach(m => { try { m.remove(); } catch { /* ignore */ } });
    osmMarkersRef.current = [];

    const ac = new AbortController();
    // `search` is in the deps now. Without it this effect never re-ran on
    // a keystroke, so every teardrop survived every query.
    const q = normalizeQuery(search);
    for (const g of osmGyms) {
      if (claimedOsmKeys.has(`${g.osmType || 'node'}/${g.osmId}`)) continue;
      if (!matchesOsmGym(q, g)) continue;
      const el     = buildOsmPin({ gym: g, onClick: setSelectedOsm, signal: ac.signal });
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([g.lon, g.lat])
        .addTo(map);
      osmMarkersRef.current.push(marker);
    }
    return () => { ac.abort(); };
  }, [osmGyms, claimedOsmKeys, search]);

  // ── Search fly-to ──────────────────────────────────────────────────────
  //
  // Flexyn rows first — a registered gym is the more useful destination
  // when both layers match — then OSM, which is where nearly every real
  // gym actually lives.
  const flyToMatch = useCallback(() => {
    const map = mapRef.current;
    if (!map || !search.trim()) return;
    const q = normalizeQuery(search);

    const flexynHit = gyms.find(g => matchesFlexynGym(q, g));
    if (flexynHit) {
      map.flyTo({ center: [flexynHit.longitude, flexynHit.latitude], zoom: 13, duration: 1200 });
      return;
    }
    const osmHit = osmGyms.find(g => matchesOsmGym(q, g));
    if (osmHit) map.flyTo({ center: [osmHit.lon, osmHit.lat], zoom: 13, duration: 1200 });
  }, [gyms, osmGyms, search]);

  // ── Derived UI values ──────────────────────────────────────────────────
  const q             = normalizeQuery(search);
  const visibleCount  = gyms.filter(g => matchesFlexynGym(q, g)).length;
  // Counted through the SAME two predicates the pin loop uses, off the
  // same claimed-key set. The pill read `osmGyms.length` raw, so it
  // reported "47 nearby" while a search had hidden all 47 — and that
  // also kept its "No matches" branch permanently unreachable.
  const visibleOsmCount = useMemo(() => osmGyms.filter(g =>
    !claimedOsmKeys.has(`${g.osmType || 'node'}/${g.osmId}`) && matchesOsmGym(q, g),
  ).length, [osmGyms, claimedOsmKeys, q]);

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
              {/* Was "Search gym name or city…". There is no geocoder
                  here: `gyms` is whatever get_gyms_in_bbox returned for
                  the CURRENT viewport, so typing a city you aren't
                  looking at could never match anything. Promise what the
                  control does — filter this view — rather than a
                  place search it can't perform. */}
              <Input
                placeholder="Filter gyms in view…"
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

        {/* "Search this area" pill — the Google Maps / Yelp pattern.
            Centered at the top of the map, shown whenever the user has
            moved the map since the last successful fetch. Hides on
            successful fetch. The auto-debounce on moveend still fires,
            but this gives the user explicit control + a reliable
            manual retry when an auto-fetch silently failed. */}
        {!mapError && hasMovedSinceFetch && view === 'map' && (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: -8, scale: 0.94 }}
            animate={{ opacity: 1, y: 0,  scale: 1 }}
            exit={{    opacity: 0, y: -8, scale: 0.94 }}
            onClick={() => {
              clearTimeout(debounceRef.current);
              refreshRef.current?.();
            }}
            disabled={osmLoading || loading}
            className="absolute top-3 start-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-primary text-primary-foreground text-xs font-bold shadow-lg shadow-primary/30 hover:opacity-95 active:scale-[0.97] transition-all disabled:opacity-60 disabled:cursor-wait"
            aria-label="Search this area for gyms"
          >
            {osmLoading || loading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />}
            {osmLoading || loading ? 'Searching…' : 'Search this area'}
          </motion.button>
        )}

        {/* Home-gym status chip.
            Grey means two different things on this map — a community gym
            (bubble) and an unclaimed OpenStreetMap entry (teardrop) — and
            at phone size that distinction is far too subtle to carry the
            answer to "is my gym set?". Three separate times a grey pin
            was read as a saved home gym when nothing had been written.
            This chip states the fact outright, sourced from the profile
            rather than inferred from what's on screen. */}
        {!mapError && (
          <div className="absolute bottom-32 start-3 z-10 max-w-[70%] px-3 py-1.5 rounded-full bg-card/90 backdrop-blur border border-border shadow-md text-xs font-medium flex items-center gap-1.5">
            {homeGymId ? (
              <>
                <span className="text-amber-500 leading-none">★</span>
                <span className="truncate">
                  My gym: {homeGymName || 'set'}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">
                No home gym set — tap a gym to set one
              </span>
            )}
          </div>
        )}

        {/* Count pill */}
        {!mapError && (
          <div className="absolute bottom-24 start-3 z-10 px-3 py-1.5 rounded-full bg-card/90 backdrop-blur border border-border shadow-md text-xs font-medium flex items-center gap-1.5">
            {loading ? (
              <><Loader2 className="w-3 h-3 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Loading…</span></>
            ) : visibleCount === 0 && visibleOsmCount === 0 ? (
              <span className="text-muted-foreground">
                {/* Both branches used to read `osmGyms.length`, so a
                    search matching nothing still reported "47 nearby"
                    and never reached "No matches" at all. */}
                {q
                  // The search only ever covers what is loaded for this
                  // viewport, so say which area came up empty rather
                  // than implying we checked everywhere.
                  ? 'No matches in this area'
                  : osmLoading
                    ? 'Finding nearby gyms…'
                    : osmError
                      ? 'Nearby gyms unavailable'
                      : currentZoom < OSM_ZOOM_MIN
                        ? 'Zoom in to find gyms'
                        // Zoomed in but nothing found — distinguish
                        // from "didn't even try" so the user knows
                        // to try a different area. Tapping the
                        // "Search this area" button at top is the
                        // recovery path.
                        : 'No gyms in view — pan to another area'}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {visibleCount > 0 && <><span className="text-primary font-bold">{visibleCount}</span> on Flexyn</>}
                {visibleCount > 0 && visibleOsmCount > 0 && ' · '}
                {visibleOsmCount > 0 && <><span className="font-bold">{visibleOsmCount}</span> nearby</>}
                {osmLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground inline ms-1" />}
              </span>
            )}
            {osmError && !osmLoading && (
              <button
                type="button"
                onClick={() => refreshRef.current?.()}
                className="ms-2 text-primary font-semibold hover:underline"
                aria-label="Retry loading nearby gyms"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {/* Flexyn gym card */}
        <AnimatePresence>
          {selected && (
            <motion.div key="fcard"
              initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              className="absolute bottom-20 start-3 end-3 z-10 rounded-2xl border border-border bg-card shadow-2xl p-4">
              <button type="button" onClick={() => setSelected(null)}
                className="absolute top-2 end-2 w-7 h-7 rounded-full bg-secondary text-muted-foreground flex items-center justify-center"
                aria-label="Close">
                <X className="w-3.5 h-3.5" />
              </button>
              <div className="flex items-start gap-3 mb-3 pe-6">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                  selected.source === 'community' ? 'bg-muted' : 'bg-primary/10'
                }`}>
                  <Building2 className={`w-5 h-5 ${
                    selected.source === 'community' ? 'text-muted-foreground' : 'text-primary'
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-heading font-bold text-base truncate">{selected.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[selected.city, selected.state_code].filter(Boolean).join(', ')}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Users className="w-3 h-3" />{selected.member_count ?? 0} members
                  </p>
                  {/* A grey bubble is a real gym with a real leaderboard
                      but no verified owner. Saying so here is what stops
                      it reading as a half-broken business listing. */}
                  {selected.source === 'community' && (
                    <span className="inline-flex items-center gap-1 mt-1.5 rounded-full bg-secondary px-2 py-0.5 text-micro font-semibold text-muted-foreground">
                      Community gym · added by members
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant={isHome(selected.id) ? 'secondary' : 'default'}
                  className="flex-1"
                  disabled={settingHome || isHome(selected.id)}
                  onClick={() => adoptGym(selected)}
                >
                  {settingHome
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : isHome(selected.id) ? 'My gym ✓' : 'Set as my gym'}
                </Button>
                <Button variant="outline" className="flex-1"
                  onClick={() => navigate(`/gym/${selected.id}`)}>
                  View Hub
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* OSM gym card */}
        <AnimatePresence>
          {selectedOsm && !selected && (
            <motion.div key="osmcard"
              initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              className="absolute bottom-20 start-3 end-3 z-10 rounded-2xl border border-border bg-card shadow-2xl p-4">
              <button type="button" onClick={() => setSelectedOsm(null)}
                className="absolute top-2 end-2 w-7 h-7 rounded-full bg-secondary text-muted-foreground flex items-center justify-center"
                aria-label="Close">
                <X className="w-3.5 h-3.5" />
              </button>
              <div className="flex items-start gap-3 pe-6 mb-3">
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
              {/* Picking an unlisted gym is the common case — almost no
                  real gym has registered a business account — so "set as
                  my gym" is the primary action here and registering the
                  business is the secondary one. Choosing it promotes this
                  OSM entry into a community gym (mig 275). */}
              <Button
                className="w-full mb-2"
                disabled={settingHome}
                onClick={() => adoptOsmGym(selectedOsm)}
              >
                {settingHome
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : 'Set as my gym'}
              </Button>
              <Button variant="outline" className="w-full"
                onClick={() => { setSelectedOsm(null); navigate('/register-gym'); }}>
                I own this gym — register it 🚀
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
