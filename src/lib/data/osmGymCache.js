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
 * Matches MAX_SPAN_DEG in the edge function. A box wider than this is a
 * map viewport, not a "gyms near me" query, and the function refuses to
 * fill it — asking anyway just spends a round trip to be told 413.
 */
const MAX_FILL_SPAN_DEG = 2.0;

/**
 * The cached-read core, in bbox terms. `fetchOsmGymsNearCached` is this
 * with a radius; GymMap uses it directly with the map's own bounds.
 */
async function readBox(box, { signal, limit = 300, sort } = {}) {
  const clean = (gyms) => gyms.filter(
    g => Number.isFinite(g?.lat) && Number.isFinite(g?.lon),
  );
  const done = (gyms, partial = false) => ({
    gyms: sort ? sort(clean(gyms)) : clean(gyms),
    partial,
  });

  let first;
  try {
    first = await readCache(box, limit);
  } catch (err) {
    reportError(err, { feature: 'osm-cache.read' });
    first = { gyms: [], total: 1, known: 0, fresh: 0 };
  }

  const covered = first.known >= first.total;
  if (covered && first.fresh >= first.total) return done(first.gyms);

  // Too big to fill. The map at low zoom lands here constantly, and the
  // right answer is "show what we have" rather than a round trip that
  // comes back 413 and puts an error banner over a working cache.
  const tooBig = (box.north - box.south) > MAX_FILL_SPAN_DEG
              || (box.east - box.west) > MAX_FILL_SPAN_DEG;
  if (tooBig) return done(first.gyms, true);

  if (covered) {
    fill(box, signal).catch(() => {});
    return done(first.gyms);
  }

  try {
    await fill(box, signal);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    if (first.gyms.length > 0) return done(first.gyms, true);
    throw err;
  }

  try {
    return done((await readCache(box, limit)).gyms);
  } catch (err) {
    if (first.gyms.length > 0) return done(first.gyms, true);
    throw err;
  }
}

/**
 * Gyms inside a bounding box — the map's shape of the question.
 *
 * GymMap called Overpass directly until now, which is why its grey pins
 * kept not appearing: that is the 2-30s path failing about one run in
 * three, and it was still doing it after the picker moved off it.
 */
export async function fetchOsmGymsInBboxCached(box, opts = {}) {
  if (!box || ![box.south, box.north, box.west, box.east].every(Number.isFinite)) {
    return { gyms: [], partial: false };
  }
  return readBox(box, opts);
}

/**
 * Gyms near a point, closest first, served from the cache.
 *
 * Returns `{ gyms, partial }`. `partial` means a fill was needed and
 * failed, so what came back is whatever was already cached — narrower
 * than asked for, and the caller must SAY so.
 *
 * That flag exists because of a real bug: this used to return the stale
 * rows and nothing else, so tapping "Search wider" over a failed fill
 * re-rendered the identical list with no error. The user asked for more,
 * got the same, and was told nothing. A silent fallback is fine when
 * nobody asked; it is a lie when they did.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {{radiusKm?: number, signal?: AbortSignal, limit?: number}} [opts]
 */
export async function fetchOsmGymsNearCached(
  lat, lng, { radiusKm = DEFAULT_NEAR_RADIUS_KM, signal, limit = 300 } = {},
) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { gyms: [], partial: false };
  return readBox(bboxAround(lat, lng, radiusKm), {
    signal,
    limit,
    sort: (gyms) => gyms.sort(
      (a, b) => distanceKm(lat, lng, a.lat, a.lon) - distanceKm(lat, lng, b.lat, b.lon),
    ),
  });
}
