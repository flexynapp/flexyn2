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
import { getGymsInBbox, listMyGyms } from '@/lib/data/gymBusinesses';
import { OSM_ZOOM_MIN, bboxAround } from '@/lib/osmGyms';
// Reads the Postgres cache (~19ms) instead of Overpass. The map was
// still calling Overpass directly from the browser after the picker
// moved off it, which is why its grey pins kept not appearing: that path
// takes 2-30s and fails about one run in three.
import { fetchOsmGymsInBboxCached } from '@/lib/data/osmGymCache';
// Extracted so it is testable without dragging maplibre-gl into jsdom;
// the head comment there records why the search was covering one layer.
import {
  matchesFlexynGym, matchesOsmGym, normalizeQuery,
} from '@/lib/gymSearch';
import { searchPlaces, PLACES_ATTRIBUTION } from '@/lib/geocode';
import { reportError } from '@/lib/reportError';
import {
  setHomeGym, setHomeGymFromOsm, resolveHomeGymId, getHomeGym,
} from '@/lib/data/homeGym';
import { toast } from '@/lib/toast';
import GymLeaderboard from '@/components/gyms/GymLeaderboard';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';

// ── Constants ──────────────────────────────────────────────────────────
const US_CENTER        = [-98.5795, 39.8283];
const US_ZOOM          = 3.6;
const MOVE_DEBOUNCE_MS = 400;

const MAPTILER_KEY = import.meta.env?.VITE_MAPTILER_KEY || '';
const STYLE_URL    = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
  : 'https://tiles.openfreemap.org/styles/liberty';

// One axis, three colours: how this gym relates to YOU.
//
//   orange — yours
//   blue   — someone else trains here, you don't
//   grey   — nobody has joined it yet
//
// That replaces a scheme built on a different axis (who owns the record:
// purple verified business, grey community, grey unclaimed OSM), which
// answered a question no one standing in front of the map was asking.
// Ownership still exists in the data and still shows on the gym card;
// it just stopped being what the pin is for.
//
// The ★ is gone with it. It marked the home gym because colour alone
// couldn't — grey meant two things, and "which pin is mine?" was
// answered wrong by eye three separate times. Orange now means exactly
// one thing, so the badge is redundant decoration on top of a signal
// that already works.
function pinGradient({ isMine, memberCount }) {
  if (isMine) return 'linear-gradient(135deg,#fb923c,#ea580c)';
  if ((memberCount ?? 0) > 0) return 'linear-gradient(135deg,#60a5fa,#2563eb)';
  return 'linear-gradient(135deg,#9ca3af,#6b7280)';
}

// The one-off orange teardrop for Camp Quannapowitt (5a62bb7) was
// retired when orange became "yours" — a colour meaning two things is
// the failure CLAUDE.md records for grey. A gym wanting to stand out
// again needs a signal that isn't colour.

// ── Pin DOM builders ───────────────────────────────────────────────────

// IMPORTANT: MapLibre owns the OUTER element's `transform` — it sets
// `translate(...)` on the marker root every frame to position the pin
// at its lng/lat. If hover handlers wrote `transform: scale(...)` to
// the same element they CLOBBERED the translate and the pin jumped to
// the top-left corner of the map container (the reported bug).
// All hover scaling is now applied to an INNER wrapper so the outer
// transform stays MapLibre's exclusive property.
function buildFlexynPin({ gym, compact, onClick, signal, isMine = false }) {
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
    background: pinGradient({ isMine, memberCount: gym.member_count }),
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
// their home gym, promoted from an OpenStreetMap entry. Same bubble
// SHAPE as a verified business, because it is an equally real place with
// real members and a real leaderboard; only the colour differs, and that
// now comes from pinGradient rather than from who owns the record.
function buildCommunityPin({ gym, compact, onClick, signal, isMine = false }) {
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
    background: pinGradient({ isMine, memberCount: gym.member_count }),
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
  const opts = signal ? { signal } : undefined;
  el.addEventListener('mouseenter', () => { inner.style.transform = 'scale(1.2)'; }, opts);
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
/**
 * @param {Function} [onClose] when present, the Back button calls this
 *   instead of navigating. Onboarding mounts this as a full-screen
 *   overlay: App.jsx forces an incomplete-onboarding user back onto the
 *   onboarding route, so a real navigation to /gym-map bounces — and only
 *   `data` is persisted, not `stepIdx`, so it would also drop the user at
 *   the start of the flow with their answers intact but ten steps to
 *   re-click. An overlay avoids both.
 * @param {Function} [onContinue] onboarding mode. The gym card's second
 *   action is "View Hub", which routes to /gym/:id — a destination a user
 *   who has not finished onboarding cannot reach, because App.jsx sends
 *   them straight back to the onboarding route. Passing this swaps that
 *   button for a Continue that returns to the flow, and only once the gym
 *   is actually theirs: before that there is nothing to continue FROM.
 */
export default function GymMap({ onClose, onContinue }) {
  const { tFallback } = useLanguage();
  // No useBodyScrollLock here, deliberately. This is a ROUTE (/gym-map) as
  // well as an onboarding overlay, and it is `fixed inset-0` either way —
  // there is no page behind it to hold. Taking the lock would hold it for
  // the whole time the user is on the map, and the lock's touch handling
  // would be arbitrating gestures against maplibre's canvas for every pan.
  const navigate = useNavigate();
  const { user } = useAuth();

  const containerRef  = useRef(null);
  const mapRef        = useRef(null);
  const markersRef    = useRef([]);
  const osmMarkersRef = useRef([]);
  const osmAbortRef   = useRef(null);
  const placeAbortRef = useRef(null);
  const debounceRef   = useRef(null);
  const refreshRef    = useRef(null); // always → latest refreshFromBounds

  const [view,        setView]        = useState('map');
  const [gyms,        setGyms]        = useState([]);
  const [osmGyms,     setOsmGyms]     = useState([]);
  const [selected,    setSelected]    = useState(null);
  const [selectedOsm, setSelectedOsm] = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [mapError,    setMapError]    = useState(null);
  const [osmError,    setOsmError]    = useState(null);   // last OSM-cache read failure
  const [osmLoading,  setOsmLoading]  = useState(false);  // grey-pin fetch in flight
  const [search,      setSearch]      = useState('');
  const [searchOpen,  setSearchOpen]  = useState(false);
  // Place lookup (Nominatim) — only ever fired on an explicit submit.
  const [places,      setPlaces]      = useState([]);
  const [placeStatus, setPlaceStatus] = useState('idle'); // idle | searching | done | error
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
  // Every gym the viewer is a member of, which is what paints a pin
  // orange. Broader than homeGymId on purpose: gym_members is the
  // many-gyms junction, so you can belong to several floors while only
  // one of them is the home gym that carries the ★.
  const [myGymIds, setMyGymIds] = useState(() => new Set());
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

  // Loaded once per viewer rather than per viewport: membership doesn't
  // change as the map pans, and re-reading it on every moveend would put
  // a query behind a gesture for an answer that cannot have changed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id) { setMyGymIds(new Set()); return; }
      const rows = await listMyGyms(user.id);
      if (cancelled) return;
      setMyGymIds(new Set((rows || []).map(r => r.gym?.id || r.id).filter(Boolean)));
    })();
    return () => { cancelled = true; };
  }, [user?.id, homeGymId]);

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
      toast.success(tFallback('gymMap.nowYourGym', '{name} is now your gym.', { name: gym.name }), {
        action: {
          label: tFallback('common.undo', 'Undo'),
          onClick: async () => {
            await setHomeGym(null);
            setHomeGymId(null);
            setHomeGymName(null);
          },
        },
      });
    } else {
      toast.error(tFallback('gymMap.setGymFailed', "Couldn't set your gym. Try again."));
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
      toast.success(tFallback('gymMap.nowYourGym', '{name} is now your gym.', { name: osm.name }), {
        action: {
          label: tFallback('common.undo', 'Undo'),
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
      toast.error(msg || tFallback('gym.setGymFailed', "Couldn't set your gym. Try again."));
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
        // Plain numbers rather than a MapLibre LngLatBounds, so the
        // cache module stays usable by callers without a map.
        const box = {
          south: b.getSouth(), west: b.getWest(),
          north: b.getNorth(), east: b.getEast(),
        };

        // `background: true` is what stops a pan into a cold area from
        // freezing. The read returns immediately with whatever is
        // cached, and hands back a promise for the fill still running
        // behind it — so the previous area's pins come off the map at
        // once instead of sitting there for up to a minute while a
        // spinner ran and nothing on screen belonged to where the user
        // had actually panned to.
        const { gyms: dots, filling } = await fetchOsmGymsInBboxCached(
          box, { signal: ctrl.signal, limit: 1000, background: true },
        );
        if (ctrl.signal.aborted) return;
        setOsmGyms(dots);
        setOsmError(null);
        setHasMovedSinceFetch(false);

        if (filling) {
          // Still loading, honestly: the pill keeps spinning until the
          // fill lands, then the area is re-read once and the new pins
          // appear. A failed fill leaves the cached view standing.
          try {
            await filling;
            if (ctrl.signal.aborted) return;
            const second = await fetchOsmGymsInBboxCached(
              box, { signal: ctrl.signal, limit: 1000 },
            );
            if (!ctrl.signal.aborted) setOsmGyms(second.gyms);
          } catch (fillErr) {
            if (fillErr?.name !== 'AbortError' && !ctrl.signal.aborted) {
              setOsmError('Could not load gyms for this area');
            }
          }
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

      // Open on the user's own area, whichever button got them here.
      //
      // This was onboarding-only, on the theory that a standalone map
      // should start neutral. That made the same page behave two ways:
      // arrive from onboarding and you get your neighbourhood, arrive
      // from My Gyms and you get the continent — same button label,
      // same destination, different answer. Every entry point to this
      // map is someone looking for a gym they could actually train at,
      // and none of them are asking about Nebraska.
      //
      // Nothing is hijacked: on denial or timeout the US view stands,
      // and the GeolocateControl is still there.
      if (typeof navigator === 'undefined' || !navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          // 25 miles. fitBounds rather than a zoom number so the radius
          // is the same distance on every screen size, instead of the
          // same zoom level covering a different area on each.
          const b = bboxAround(pos.coords.latitude, pos.coords.longitude, 40.23);
          map.fitBounds(
            [[b.west, b.south], [b.east, b.north]],
            { padding: 24, duration: 0 },
          );
        },
        () => { /* denied or timed out — the US view is a fine fallback */ },
        { timeout: 8_000, maximumAge: 600_000 },
      );
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
    // Mount-once, and `[]` is honestly empty: everything this effect
    // touches is a ref, a module constant or a setState setter, all of
    // which React guarantees stable. exhaustive-deps agrees and reports
    // nothing.
    //
    // It carried an `eslint-disable-line react-hooks/exhaustive-deps`
    // that suppressed a warning the rule wasn't raising. Left in place it
    // would have gone on pre-suppressing the rule for whatever this
    // effect grows to reference next — a reactive value read here and
    // missing from the deps is a real bug (a map initialised from a stale
    // prop, never rebuilt), and the rule catching it is the point.
  }, []);

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
      const mine = myGymIds.has(g.id);
      const el   = g.source === 'community'
        ? buildCommunityPin({ gym: g, compact, onClick: setSelected, signal: ac.signal, isMine: mine })
        : buildFlexynPin({ gym: g, compact, onClick: setSelected, signal: ac.signal, isMine: mine });
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([g.longitude, g.latitude])
        .addTo(map);
      markersRef.current.push(marker);
    }
    return () => { ac.abort(); };
  }, [gyms, currentZoom, search, homeGymId, myGymIds]);

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

  // ── Go to a place ──────────────────────────────────────────────────────
  //
  // Clearing the query is not tidying-up, it is the point. The text was
  // a DESTINATION, and it is also the pin filter — leaving "chicago" in
  // the box after flying to Chicago filters the gyms that just loaded
  // down to the ones called "chicago", which is none of them. You would
  // arrive at an empty map.
  const goToPlace = useCallback((place) => {
    const map = mapRef.current;
    if (!map || !place) return;
    setSearch('');
    setPlaces([]);
    setPlaceStatus('idle');
    if (place.bbox) {
      map.fitBounds(
        [[place.bbox.west, place.bbox.south], [place.bbox.east, place.bbox.north]],
        // A whole city fitted exactly is zoom ~10, below the level where
        // gyms are worth drawing. Cap it so you land somewhere useful.
        { maxZoom: 13, padding: 40, duration: 1200 },
      );
    } else {
      map.flyTo({ center: [place.lon, place.lat], zoom: 13, duration: 1200 });
    }
    // The moveend handler refreshes both pin layers for wherever we land.
  }, []);

  // ── Submit ─────────────────────────────────────────────────────────────
  //
  // Two different questions share one box, and which one you meant is
  // answered by what's on screen. A gym in view wins — Flexyn rows first,
  // since a registered gym is the more useful destination, then OSM,
  // where nearly every real gym actually lives. Only when nothing in view
  // matches do we go and ask where the place is.
  //
  // Deliberately on SUBMIT, never on a keystroke: Nominatim's usage
  // policy forbids client-side autocomplete against it. Typing keeps
  // doing the local filter, which is free.
  const runSearch = useCallback(async () => {
    const map = mapRef.current;
    const q = normalizeQuery(search);
    if (!map || !q) return;

    const flexynHit = gyms.find(g => matchesFlexynGym(q, g));
    if (flexynHit) {
      map.flyTo({ center: [flexynHit.longitude, flexynHit.latitude], zoom: 13, duration: 1200 });
      return;
    }
    const osmHit = osmGyms.find(g => matchesOsmGym(q, g));
    if (osmHit) {
      map.flyTo({ center: [osmHit.lon, osmHit.lat], zoom: 13, duration: 1200 });
      return;
    }

    placeAbortRef.current?.abort();
    const ctrl = new AbortController();
    placeAbortRef.current = ctrl;
    setPlaceStatus('searching');
    setPlaces([]);
    try {
      const found = await searchPlaces(q, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      setPlaces(found);
      setPlaceStatus('done');
      // One unambiguous answer needs no menu. Several — the three
      // Springfields — do, and that is exactly when the full label
      // earns its space.
      if (found.length === 1) goToPlace(found[0]);
    } catch (err) {
      if (ctrl.signal.aborted || err?.name === 'AbortError') return;
      // "We couldn't ask" and "there is no such place" are different
      // sentences, and only this one gets a retry.
      setPlaceStatus('error');
      reportError(err, { feature: 'gym-map.place-search' });
    }
  }, [search, gyms, osmGyms, goToPlace]);

  // Drop stale place results the moment the query changes — they answer
  // a question the user has moved on from.
  useEffect(() => {
    setPlaces([]);
    setPlaceStatus('idle');
    return () => placeAbortRef.current?.abort();
  }, [search]);

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
        <button type="button" onClick={() => (onClose ? onClose() : navigate(-1))}
          className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center"
          aria-label={tFallback("achievements.vault.back", "Back")}>
          <ArrowLeft className="w-4 h-4" />
        </button>

        <h1 className="font-heading font-bold text-base flex items-center gap-1.5">
          <MapPin className="w-4 h-4 text-primary" />
          {tFallback("gymMap.flexynGymMap", "Flexyn Gym Map")}
        </h1>

        <div className="flex items-center gap-1">
          <button type="button"
            onClick={() => setView(v => v === 'leaderboard' ? 'map' : 'leaderboard')}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
              view === 'leaderboard' ? 'bg-yellow-500 text-white' : 'bg-secondary text-foreground'
            }`} aria-label={tFallback("gymMap.toggleLeaderboard", "Toggle leaderboard")}>
            <Trophy className="w-4 h-4" />
          </button>
          {view === 'map' && (
            <button type="button" onClick={() => setSearchOpen(o => !o)}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                searchOpen ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'
              }`} aria-label={tFallback("gymMap.searchGyms", "Search gyms")}>
              <Search className="w-4 h-4" />
            </button>
          )}
          {view === 'leaderboard' && (
            <button type="button" onClick={() => setView('map')}
              className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center"
              aria-label={tFallback("gymMap.backToMap", "Back to map")}>
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
              {/* Typing filters the pins in view — free, instant, no
                  network. Go searches for a PLACE, and only on submit,
                  because Nominatim's usage policy forbids client-side
                  autocomplete against it. */}
              <Input
                placeholder={tFallback("gymMap.filterGymsOrGo", "Filter gyms, or go to a place…")}
                value={search} onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
                enterKeyHint="search"
                autoFocus className="h-9" />
              {search && (
                <>
                  {/* The label stays "Go" in both states rather than
                      being swapped for a spinner. A button whose
                      accessible name changes under it — or vanishes into
                      an icon — is one a screen reader user can't refer
                      to (WCAG 2.5.3, label in name). */}
                  <Button
                    size="sm"
                    onClick={runSearch}
                    disabled={placeStatus === 'searching'}
                    className="shrink-0 gap-1"
                  >
                    {placeStatus === 'searching' && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    )}
                    Go
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setSearch('')}>{tFallback("implement.clear", "Clear")}</Button>
                </>
              )}
            </div>

            {/* Place results. Only ever populated by an explicit Go. */}
            {placeStatus !== 'idle' && (
              <div className="px-3 pb-2">
                {placeStatus === 'searching' && (
                  <p className="text-micro text-muted-foreground py-1">Looking up places…</p>
                )}

                {placeStatus === 'error' && (
                  <p className="text-micro text-muted-foreground py-1">
                    Couldn&apos;t look up places right now.{' '}
                    <button
                      type="button"
                      onClick={runSearch}
                      className="font-semibold text-primary underline underline-offset-2"
                    >
                      {tFallback("gymMap.retry", "Retry")}
                    </button>
                  </p>
                )}

                {placeStatus === 'done' && places.length === 0 && (
                  <p className="text-micro text-muted-foreground py-1">
                    No gym in view matches “{search.trim()}”, and no place by that name either.
                  </p>
                )}

                {places.length > 1 && (
                  <>
                    {/* Only shown when there's a genuine choice to make —
                        a single hit flies straight there. The full label
                        is what tells three Springfields apart, so it is
                        the reason this list exists at all. */}
                    <div className="space-y-1">
                      {places.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => goToPlace(p)}
                          className="w-full text-start rounded-xl border border-border bg-card px-3 py-2 hover:border-primary/40 active:border-primary/40 transition-colors"
                        >
                          <p className="text-sm font-semibold truncate">{p.name}</p>
                          <p className="text-micro text-muted-foreground truncate">{p.label}</p>
                        </button>
                      ))}
                    </div>
                    {/* ODbL requires this wherever the results are shown.
                        The map's own attribution control covers the
                        tiles, not this. */}
                    <p className="text-micro text-muted-foreground pt-1.5">{PLACES_ATTRIBUTION}</p>
                  </>
                )}
              </div>
            )}
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
              <p className="font-heading font-bold text-base mb-1">{tFallback("gymMap.mapCouldnTLoad", "Map couldn't load")}</p>
              <p className="text-xs text-muted-foreground mb-1">{mapError}</p>
              <p className="text-xs text-muted-foreground">{tFallback('notifications.error.desc', 'Check your connection and try again.')}</p>
            </div>
            <Button onClick={() => { setMapError(null); window.location.reload(); }}>
              {tFallback("gymMap.retry", "Retry")}
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
            aria-label={tFallback("gymMap.searchThisAreaForGyms", "Search this area for gyms")}
          >
            {osmLoading || loading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />}
            {osmLoading || loading ? 'Searching…' : 'Search this area'}
          </motion.button>
        )}

        {/* Onboarding mode: once a home gym exists there is always a way
            forward, without having to find the pin again and re-tap it.
            Adopting an OSM gym closes its card (the entry is promoted to
            a community row and the pin is rebuilt), so relying on the
            card alone would strand the user on a map with no exit but
            Back. */}
        {onContinue && homeGymId && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute bottom-4 start-3 end-3 z-30"
          >
            <Button className="w-full h-12 text-base font-bold" onClick={onContinue}>
              {tFallback("levelUp.continue", "Continue")}
            </Button>
          </motion.div>
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
                aria-label={tFallback("gymMap.retryLoadingNearbyGyms", "Retry loading nearby gyms")}
              >
                {tFallback("gymMap.retry", "Retry")}
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
                aria-label={tFallback("common.close", "Close")}>
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
                {onContinue ? (
                  isHome(selected.id) && (
                    <Button className="flex-1" onClick={onContinue}>
                      {tFallback("levelUp.continue", "Continue")}
                    </Button>
                  )
                ) : myGymIds.has(selected.id) ? (
                  // ?members=1 opens the directory on arrival, because
                  // the gym page has no members TAB — it opens on Feed
                  // and the roster is a modal behind the header. A
                  // button called "View Members" that lands two taps
                  // short of members is the same lie "View Hub" told
                  // onboarding about a route it couldn't reach.
                  <Button variant="outline" className="flex-1"
                    onClick={() => navigate(`/gym/${selected.id}?members=1`)}>
                    {tFallback("gymMap.viewMembers", "View Members")}
                  </Button>
                ) : (
                  // The roster is members-only (mig 301), so for a gym
                  // you haven't joined this cannot promise members. The
                  // page still has something to show — the anonymised
                  // activity preview and a Join.
                  <Button variant="outline" className="flex-1"
                    onClick={() => navigate(`/gym/${selected.id}`)}>
                    {tFallback("gymMap.viewGym", "View Gym")}
                  </Button>
                )}
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
                aria-label={tFallback("common.close", "Close")}>
                <X className="w-3.5 h-3.5" />
              </button>
              <div className="flex items-start gap-3 pe-6 mb-3">
                <div className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center shrink-0 text-xl">🏋</div>
                <div className="flex-1 min-w-0">
                  <p className="font-heading font-bold text-base truncate">{selectedOsm.name}</p>
                  <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground">
                    {tFallback("gymMap.notOnFlexynYet", "Not on Flexyn yet")}
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
              {/* Hidden in onboarding mode for the same reason as View
                  Hub: /register-gym is behind the same gate that sends an
                  unfinished user back to the flow. */}
              {!onContinue && (
                <Button variant="outline" className="w-full"
                  onClick={() => { setSelectedOsm(null); navigate('/register-gym'); }}>
                  I own this gym — register it 🚀
                </Button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
