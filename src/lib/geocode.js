// src/lib/geocode.js
//
// Place search for the Gym Locator — "take me to Chicago", as opposed to
// gymSearch.js which filters the pins already on screen.
//
// Backed by Nominatim, the OpenStreetMap project's own geocoder. It pairs
// with the Overpass lookup in osmGyms.js: same dataset, so a place found
// here always has the gyms found there sitting inside it.
//
// ── Nominatim's usage policy is a hard constraint, not advice ──────────
//
// https://operations.osmfoundation.org/policies/nominatim/ — it is a
// donated service and it blocks abusers by IP, which for us would mean
// the feature dying for every user at once. Three rules shape this file:
//
//   1. NO AUTOCOMPLETE. The policy forbids implementing type-ahead
//      against this API from a client. So `searchPlaces` is never called
//      on a keystroke — GymMap calls it on an explicit submit only, and
//      typing keeps doing the free local filter. This is why there is no
//      debounce helper here to reach for: a debounce would still be
//      autocomplete, just a politer one.
//   2. AT MOST 1 REQUEST PER SECOND, across the whole app. Enforced by a
//      module-level gate below rather than by each caller remembering.
//   3. CACHE RESULTS. Repeat searches — and "I typed it, went back, typed
//      it again" is the common case — must not re-hit the service.
//
// We cannot send a User-Agent from a browser (the header is forbidden to
// fetch), so identification rides on the Referer the browser sends. In a
// Capacitor WebView that Referer may be `capacitor://localhost`, which
// Nominatim may refuse — so every failure path here has to degrade to a
// visible, retryable error rather than an empty result. "No place called
// that" and "we couldn't ask" are different sentences.
//
// Attribution is required (ODbL). See PLACES_ATTRIBUTION and
// ATTRIBUTIONS.md.

const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';

/** Required credit wherever these results are shown. */
export const PLACES_ATTRIBUTION = 'Places © OpenStreetMap contributors';

/** Policy ceiling is 1/s; 1.1s leaves room for clock jitter. */
const MIN_INTERVAL_MS = 1100;

/** A lookup nobody is waiting for any more is not worth waiting for. */
const REQUEST_TIMEOUT_MS = 10_000;

const CACHE_MAX = 60;
const cache = new Map();

let lastRequestAt = 0;
// Serialises the interval check. Without a gate, two calls landing in the
// same tick both measure the same gap, both decide they may go, and both
// go — which is exactly the burst the policy is about.
let gate = Promise.resolve();

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function acquireSlot(signal) {
  const mine = gate.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait, signal);
    lastRequestAt = Date.now();
  });
  // The chain must survive a rejected link — an aborted search must not
  // poison every later one.
  gate = mine.catch(() => {});
  return mine;
}

/**
 * Nominatim's boundingbox is `[minLat, maxLat, minLon, maxLon]` as
 * STRINGS, which is neither the order nor the type anything else here
 * uses. Normalise once.
 */
function toBbox(raw) {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const [south, north, west, east] = raw.map(Number);
  if (![south, north, west, east].every(Number.isFinite)) return null;
  return { south, north, west, east };
}

function toPlace(row) {
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const label = row.display_name || row.name || '';
  return {
    id: String(row.place_id ?? `${row.osm_type}/${row.osm_id}`),
    // `name` is the bare place ("Chicago"); display_name is the full
    // "Chicago, Cook County, Illinois, United States". Show both — the
    // bare name alone can't tell two Springfields apart.
    name: row.name || label.split(',')[0] || 'Place',
    label,
    lat,
    lon,
    bbox: toBbox(row.boundingbox),
  };
}

/**
 * Look up places matching a free-text query.
 *
 * Call this on an explicit user submit ONLY — see the policy note above.
 *
 * @param {string} query
 * @param {{signal?:AbortSignal, limit?:number}} [opts]
 * @returns {Promise<Array<{id:string,name:string,label:string,lat:number,
 *   lon:number,bbox:{south:number,west:number,north:number,east:number}|null}>>}
 * @throws on network / HTTP failure, so callers can say "we couldn't ask"
 *   rather than "there is no such place".
 */
export async function searchPlaces(query, { signal, limit = 5 } = {}) {
  const q = (query || '').trim();
  if (q.length < 2) return [];

  const key = `${q.toLowerCase()}|${limit}`;
  if (cache.has(key)) return cache.get(key);

  await acquireSlot(signal);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(new Error('Place search timed out')),
    REQUEST_TIMEOUT_MS,
  );
  const forwardAbort = () => ctrl.abort(new DOMException('Aborted', 'AbortError'));
  signal?.addEventListener?.('abort', forwardAbort);

  try {
    const url =
      `${NOMINATIM_SEARCH}?format=jsonv2&addressdetails=0` +
      `&limit=${encodeURIComponent(limit)}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Place search failed (${res.status})`);
    const json = await res.json();
    const places = (Array.isArray(json) ? json : []).map(toPlace).filter(Boolean);

    // Cache the empty answer too — "there is no such place" is a stable
    // fact and re-asking for it is exactly the traffic the policy is
    // about.
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, places);
    return places;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', forwardAbort);
  }
}

/** Test seam — the module-level cache and gate outlive a single test. */
export function __resetGeocodeState() {
  cache.clear();
  lastRequestAt = 0;
  gate = Promise.resolve();
}
