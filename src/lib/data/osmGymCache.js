// src/lib/data/osmGymCache.js
//
// Read OpenStreetMap gyms from our own Postgres instead of from a phone
// on cellular talking to a donated public service (migration 300).
//
// Measured from Sanford, Maine, three runs each, before this existed:
//
//   Overpass,  5 mi radius      4.3s   3.5s   2.3s
//   Overpass, 30 mi radius     30.0s✗  5.9s   4.6s
//   the same question, from our DB    19 ms
//
// Same answer, three orders of magnitude apart — and the wide query
// failed outright about one run in three, because Overpass mirrors 429
// and 504 under load. A user reported fifteen seconds and no gyms.
//
// ── Three cases, and only one of them is slow ────────────────────────
//
// The RPC returns coverage alongside the rows, because "we have no gyms
// here" and "we have never looked here" are different facts and the
// caller has to act differently on them. It is the same distinction the
// picker already draws in its empty state, for the same reason.
//
//   tiles_known < total   never looked. Fill first, then read. This is
//                         the only path that waits, and only the FIRST
//                         person in an area ever takes it.
//   tiles_fresh < known   looked, a while ago. Serve what we have NOW
//                         and refresh behind the user. Gyms open and
//                         close over months; a spinner that confirms
//                         last month's list is a spinner for nothing.
//   fully fresh           serve. ~19ms.
//
// ── Why not just keep calling Overpass ───────────────────────────────
//
// Considered: Photon is a geocoder, so "every gym in a radius" is not a
// query it answers well. Google Places forbids caching or storing its
// POI data — which is exactly what promoting a gym into gym_businesses
// does. Foursquare is a commercial key for coverage no better than OSM's
// in rural Maine. Self-hosting Overpass is a planet import and a server
// to babysit. Overture ships as a bulk dump, so you build this table
// anyway. Caching keeps the data, the licence and the zero vendor count,
// and stops caring whether Overpass is up.

import { supabase } from '@/api/supabaseClient';
import { bboxAround, distanceKm, DEFAULT_NEAR_RADIUS_KM } from '@/lib/osmGyms';
import { reportError } from '@/lib/reportError';

/** Matches TILE_DEG in the edge function and the RPC's tile arithmetic. */
const FILL_FUNCTION = 'osm-gyms-fill';

async function readCache(box, limit) {
  const { data, error } = await supabase.rpc('get_osm_gyms_cached', {
    p_min_lat: box.south, p_max_lat: box.north,
    p_min_lng: box.west,  p_max_lng: box.east,
    p_limit: limit,
  });
  if (error) throw error;
  return {
    gyms: Array.isArray(data?.gyms) ? data.gyms : [],
    total: Number(data?.tiles_total) || 0,
    known: Number(data?.tiles_known) || 0,
    fresh: Number(data?.tiles_fresh) || 0,
  };
}

async function fill(box, signal) {
  const { error } = await supabase.functions.invoke(FILL_FUNCTION, {
    body: {
      minLat: box.south, maxLat: box.north,
      minLng: box.west,  maxLng: box.east,
    },
    signal,
  });
  if (error) throw error;
}

/**
 * Gyms near a point, closest first, served from the cache.
 *
 * Throws only when there is nothing to show AND the fill failed — a
 * partial answer is always better than an error, because the picker
 * renders a failure state that tells the user to retry something we
 * could have just shown them.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {{radiusKm?: number, signal?: AbortSignal, limit?: number}} [opts]
 */
export async function fetchOsmGymsNearCached(
  lat, lng, { radiusKm = DEFAULT_NEAR_RADIUS_KM, signal, limit = 300 } = {},
) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const box = bboxAround(lat, lng, radiusKm);

  const sortByDistance = (gyms) => gyms
    .filter(g => Number.isFinite(g?.lat) && Number.isFinite(g?.lon))
    .sort((a, b) => distanceKm(lat, lng, a.lat, a.lon)
                  - distanceKm(lat, lng, b.lat, b.lon));

  let first;
  try {
    first = await readCache(box, limit);
  } catch (err) {
    // The cache is unreachable (RPC missing on a pre-300 host, network
    // down). Fall through to a fill attempt rather than reporting empty.
    reportError(err, { feature: 'osm-cache.read' });
    first = { gyms: [], total: 1, known: 0, fresh: 0 };
  }

  const covered = first.known >= first.total;

  // Fully covered and current: done, and this is the common case.
  if (covered && first.fresh >= first.total) return sortByDistance(first.gyms);

  // Covered but stale. Serve immediately, refresh behind the user. The
  // refresh is deliberately not awaited and its failure is not reported
  // as a user-visible error — nobody is waiting on it.
  if (covered) {
    fill(box, signal).catch(() => {});
    return sortByDistance(first.gyms);
  }

  // Never looked here. This is the one path that waits.
  try {
    await fill(box, signal);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    // The fill failed, but anything already cached still beats nothing.
    if (first.gyms.length > 0) return sortByDistance(first.gyms);
    throw err;
  }

  try {
    const second = await readCache(box, limit);
    return sortByDistance(second.gyms);
  } catch (err) {
    if (first.gyms.length > 0) return sortByDistance(first.gyms);
    throw err;
  }
}
