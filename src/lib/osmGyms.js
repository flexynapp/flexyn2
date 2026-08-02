// src/lib/osmGyms.js
//
// OpenStreetMap gym lookup via Overpass.
//
// Extracted from GymMap.jsx so the onboarding gym picker can reach it
// too. It has to live outside that page: GymMap statically imports
// maplibre-gl, and importing anything from it would drag the whole map
// engine into the onboarding chunk. vite.config keeps maplibre-gl out of
// vendor-misc precisely so it stays a lazy chunk — don't undo that by
// importing GymMap from a non-map surface.
//
// The bbox argument is plain numbers rather than a MapLibre LngLatBounds
// for the same reason: callers without a map must be able to use it.
//
// Behaviour carried over from GymMap unchanged: mirrors race in
// parallel via Promise.any (sequential fallback used to take 36s
// worst-case before reporting failure), losers are aborted once one
// wins so their responses stop downloading, each mirror gets a hard 20s
// cap, and the outer AbortSignal cancels everything so a map pan or an
// unmounting picker doesn't leave fetches running.

// Mirror order matters, and this order is measured rather than guessed
// (audited 2026-08-01 from a browser Origin with a browser User-Agent):
//
//   private.coffee   200 + `Access-Control-Allow-Origin: *`   most reliable
//   kumi.systems     200 + CORS, but frequently times out
//   overpass-api.de  406 Not Acceptable, and NO CORS header
//
// overpass-api.de rejects browser User-Agents outright — it answers curl
// fine and 406s Chrome — and sends no CORS header even on the error, so
// from the app it can never succeed. It stays last purely as a racer for
// non-browser callers (tests, node probes) where it does work.
//
// It used to be FIRST, which had a second, sneakier cost: Promise.any's
// AggregateError lists errors in call order, so every total failure was
// reported as "OSM 406" — this mirror's error — no matter what actually
// went wrong on the other two. See pickError below.
const OVERPASS_MIRRORS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

/**
 * Choose the most informative error out of a failed mirror race.
 *
 * Prefers a real HTTP/network failure from a mirror that *could* have
 * worked over overpass-api.de's guaranteed 406, so the message a caller
 * logs or shows describes the actual outage.
 */
function pickError(errors) {
  const list = Array.isArray(errors) ? errors.filter(Boolean) : [];
  if (list.length === 0) return new Error('Overpass unavailable');
  const informative = list.find(e => !/406/.test(e?.message || ''));
  return informative || list[0];
}

/** Zoom below which grey OSM pins are not fetched at all. */
export const OSM_ZOOM_MIN = 5;

/**
 * Fetch gyms from OpenStreetMap inside a bounding box.
 *
 * @param {{south:number, west:number, north:number, east:number}} bbox
 * @param {{zoom?:number, signal?:AbortSignal}} [opts]
 *   zoom tunes the result cap and whether outdoor fitness stations are
 *   included (they're noise until you're zoomed right in).
 * @returns {Promise<Array<{osmId:number, osmType:string, name:string,
 *   lat:number, lon:number, brand:string|null, website:string|null}>>}
 */
export async function fetchOsmGyms(bbox, { zoom = 13, signal } = {}) {
  const s = Number(bbox.south).toFixed(4);
  const w = Number(bbox.west).toFixed(4);
  const n = Number(bbox.north).toFixed(4);
  const e = Number(bbox.east).toFixed(4);

  const cap = zoom >= 11 ? 2500 : zoom >= 7 ? 1000 : 500;
  const includeOutdoor = zoom >= 13;

  const q =
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

  const ctrls = [];
  const tryMirror = async (mirror) => {
    const ctrl = new AbortController();
    ctrls.push(ctrl);
    const timer = setTimeout(() => ctrl.abort('timeout'), 20_000);
    const forwardAbort = () => ctrl.abort('outer-aborted');
    if (signal?.aborted) {
      clearTimeout(timer);
      throw new DOMException('Aborted', 'AbortError');
    }
    signal?.addEventListener?.('abort', forwardAbort);
    try {
      const res = await fetch(
        `${mirror}?data=${encodeURIComponent(q)}`,
        { signal: ctrl.signal },
      );
      if (!res.ok) throw new Error(`OSM ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', forwardAbort);
    }
  };

  let json;
  try {
    json = await Promise.any(OVERPASS_MIRRORS.map(tryMirror));
    for (const c of ctrls) {
      try { c.abort('won'); } catch { /* ignore */ }
    }
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    throw err?.errors ? pickError(err.errors) : err;
  }

  // Dedupe by osmId — a gym tagged BOTH leisure=fitness_centre AND
  // amenity=gym (common) would otherwise appear twice.
  //
  // osmType is carried through because migration 275 keys community
  // gyms on (osm_type, osm_id): OSM ids are only unique WITHIN a type,
  // so node/123 and way/123 are different places. Dropping the type
  // here would let two unrelated gyms collide on one database row.
  const seenIds = new Set();
  return (json.elements || []).map(el => ({
    osmId: el.id,
    osmType: el.type || 'node',
    name: el.tags?.name || 'Gym',
    lat: el.type === 'node' ? el.lat : el.center?.lat,
    lon: el.type === 'node' ? el.lon : el.center?.lon,
    brand: el.tags?.brand || null,
    website: el.tags?.website || null,
  })).filter(g => {
    if (!g.lat || !g.lon) return false;
    const key = `${g.osmType}/${g.osmId}`;
    if (seenIds.has(key)) return false;
    seenIds.add(key);
    return true;
  });
}

/**
 * Convenience for "gyms near this point" — used by the onboarding
 * picker, which has a geolocation fix rather than a map viewport.
 *
 * radiusDeg 0.05° ≈ 5.5 km of latitude; longitude narrows with
 * latitude, which is fine — it biases the box toward the user's own
 * neighbourhood, and picking your gym is a walking-distance decision.
 */
export async function fetchOsmGymsNear(lat, lng, { radiusDeg = 0.05, signal } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  return fetchOsmGyms(
    {
      south: lat - radiusDeg, north: lat + radiusDeg,
      west: lng - radiusDeg, east: lng + radiusDeg,
    },
    { zoom: 13, signal },
  );
}

/** Great-circle-ish distance in km. Good enough for sorting a picker. */
export function distanceKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLng = (bLng - aLng) * Math.PI / 180;
  const m = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(m)));
}
