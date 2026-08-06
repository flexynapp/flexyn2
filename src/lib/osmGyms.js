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
// The lookup is two halves and the split is load-bearing (see
// GYM_SELECTORS): a cheap all-exact-match Overpass query that over-fetches,
// then a free client-side classifier that decides what a gym is. Anything
// clever pushed into the query costs seconds and 504s; the same rule
// applied to tags in hand costs nothing and is testable.
//
// Behaviour carried over from GymMap unchanged: mirrors race in
// parallel via Promise.any (sequential fallback used to take 36s
// worst-case before reporting failure), losers are aborted once one
// wins so their responses stop downloading, each mirror gets a hard 20s
// cap, and the outer AbortSignal cancels everything so a map pan or an
// unmounting picker doesn't leave fetches running.

// Mirror order matters, and this order is measured rather than guessed
// (audited 2026-08-01, re-measured 2026-08-06, both from a browser Origin
// with a browser User-Agent):
//
//   private.coffee   200 + `Access-Control-Allow-Origin: *`   most reliable
//   kumi.systems     200 + CORS; healthy on 2026-08-06 (4.2s)
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
//
// Two more were measured and rejected on 2026-08-06:
//   overpass.osm.ch  fast + CORS, but it serves a SWITZERLAND extract —
//                    it answers a Houston bbox with zero elements, which
//                    would win the race and report "no gyms near you".
//                    A regional mirror is worse than a dead one here.
//   maps.mail.ru     full planet + CORS, but every racer receives the
//                    user's bounding box, so adding a mirror means
//                    broadcasting their approximate location to one more
//                    operator. Not worth it for a third healthy mirror.
const OVERPASS_MIRRORS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

// Server-side compute budget in the query header, and the client-side
// hard cap on a single mirror. The client cap MUST be the larger of the
// two: it was 20s against a `[timeout:25]` header, so the app hung up on
// every query the server was still legitimately working on. A widened
// 16 km box measured 17.3s on a healthy mirror — inside the old cap only
// by luck.
const OVERPASS_SERVER_TIMEOUT_S = 25;
const MIRROR_ABORT_MS = 30_000;

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

// ── What counts as a gym ───────────────────────────────────────────────
//
// Split deliberately into a CHEAP Overpass query and a FREE client-side
// classifier, because those two have opposite cost curves.
//
// Overpass can only use its index for exact `key=value` lookups. Anything
// clever — a case-insensitive regex, a negative match like
// `["sport"!~"tennis|swimming"]` — degrades into a scan of the bbox.
// Measured on 2026-08-06 over a 27 km box: the exact-match query answered
// in 27s; the same query with one `!~` clause 504'd three times in a row
// at 58s, 57s and 82s before finally landing. So every selector below is
// an exact match, and the judgement happens on tags we already have in
// hand.
//
// `nwr` (node/way/relation) replaces the old `node` + `way` pairs.
// Relations were never queried, so a gym mapped as a multipolygon — which
// is normal for anything inside a larger building — was invisible.
const GYM_SELECTORS = [
  '["leisure"="fitness_centre"]',
  '["amenity"="gym"]',
  '["club"="fitness"]',
  '["sport"="fitness"]',
  // Both are frequently the ONLY tag on a real gym: CrossFit boxes and
  // boxing gyms are routinely mapped `sport=gymnastics` with no leisure
  // tag, and bouldering gyms as `sport=climbing`.
  '["sport"="gymnastics"]',
  '["sport"="climbing"]',
];

/**
 * Zoom at or above which the broad `leisure=sports_centre` sweep runs.
 *
 * Not filtered to `["sport"~"fitness"]` any more — that filter was the
 * single biggest source of misses, because YMCAs, council rec centres,
 * boxing gyms and climbing gyms carry no sport tag at all or one that
 * isn't the string "fitness". But it is also the broadest selector here,
 * and cost scales with viewport: measured on a phone-shaped bbox, zoom 9
 * answered in 3.1s, zoom 7 in 10.1s and zoom 5 in 27.0s against a 30s
 * cap. Below a metro-sized view the individual names aren't legible
 * anyway, so the recall this buys can't be used — it just makes the pin
 * refresh the slowest thing on the page.
 *
 * The near-me picker calls fetchOsmGyms at zoom 13, so it always gets
 * the sweep.
 */
const SPORTS_CENTRE_SWEEP_ZOOM_MIN = 9;

/** Sports whose presence means "this is somewhere you train". */
const GYM_SPORTS = new Set([
  'fitness', 'gym', 'exercise', 'multi', 'weightlifting', 'crossfit',
  'bodybuilding', 'calisthenics', 'climbing', 'bouldering', 'boxing',
  'kickboxing', 'muay_thai', 'martial_arts', 'judo', 'karate', 'taekwondo',
  'wrestling', 'gymnastics', 'yoga', 'pilates', 'dance',
]);

/**
 * Sports whose presence means "this is NOT somewhere you lift".
 *
 * Only consulted when NO gym sport is also present, so a sports centre
 * tagged `swimming;fitness` still counts.
 */
const NON_GYM_SPORTS = new Set([
  'tennis', 'padel', 'squash', 'badminton', 'table_tennis', 'swimming',
  'diving', 'scuba_diving', 'surfing', 'sailing', 'canoe', 'rowing',
  'golf', 'soccer', 'football', 'american_football', 'rugby',
  'rugby_union', 'rugby_league', 'baseball', 'softball', 'basketball',
  'volleyball', 'beachvolleyball', 'handball', 'netball', 'lacrosse',
  'cricket', 'field_hockey', 'ice_hockey', 'hockey', 'curling',
  'skating', 'ice_skating', 'roller_skating', 'skiing', 'snowboard',
  'bowling', 'billiards', 'darts', 'archery', 'shooting', 'paintball',
  'laser_tag', 'axe_throwing', 'equestrian', 'horse_riding',
  'horse_racing', 'polo', 'motor', 'motocross', 'karting', 'cycling',
  'bmx', 'skateboard', 'athletics', 'running', 'chess', 'fishing',
]);

/** Last resort: the name says gym even when the tags don't. */
const GYM_NAME_RE =
  /\b(gyms?|fitness|crossfit|barbell|strength|health club|athletic club|ymca|ywca|jcc|recreation cent(er|re)|rec cent(er|re)|boxing|jiu[-\s]?jitsu|mma|pilates|yoga)\b/i;

/**
 * Is this OSM feature somewhere a person trains?
 *
 * Exported for tests — this is the half of the lookup that decides what
 * a user sees, and it is far cheaper to assert on than a live Overpass
 * response.
 *
 * @param {Record<string,string>} tags raw OSM tags
 */
export function isGymLike(tags = {}) {
  // Unambiguous: the tag exists to mean exactly this.
  if (tags.leisure === 'fitness_centre') return true;
  if (tags.leisure === 'fitness_station') return true;
  if (tags.amenity === 'gym') return true;
  if (tags.club === 'fitness') return true;

  // `sport` is a semicolon list — `athletics;boxing` is one real gym.
  const sports = String(tags.sport || '')
    .split(';')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  if (sports.some(s => GYM_SPORTS.has(s))) return true;
  // Every listed sport is something else. A tennis centre and a public
  // pool are the two things this rule exists to keep off the list.
  if (sports.length > 0 && sports.every(s => NON_GYM_SPORTS.has(s))) return false;

  if (GYM_NAME_RE.test(tags.name || '')) return true;

  // A sports centre with no sport tag at all is, overwhelmingly, a
  // municipal rec centre or an unclassified commercial gym. Keep it —
  // a stray leisure centre in the list costs a user one glance; a
  // missing gym costs them the feature.
  return tags.leisure === 'sports_centre' && sports.length === 0;
}

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

  const box = `(${s},${w},${n},${e})`;
  const selectors = [
    ...GYM_SELECTORS,
    ...(zoom >= SPORTS_CENTRE_SWEEP_ZOOM_MIN ? ['["leisure"="sports_centre"]'] : []),
    ...(includeOutdoor ? ['["leisure"="fitness_station"]'] : []),
  ];

  const q =
    `[out:json][timeout:${OVERPASS_SERVER_TIMEOUT_S}];(` +
    selectors.map(sel => `nwr${sel}${box};`).join('') +
    `);out center ${cap};`;

  let ctrls = [];
  const tryMirror = async (mirror) => {
    const ctrl = new AbortController();
    ctrls.push(ctrl);
    // Abort with an Error, not a string. `AbortSignal.abort(reason)`
    // rejects the fetch with the reason VERBATIM, so `abort('timeout')`
    // threw a bare string all the way out to callers — `err.message` was
    // undefined and GymMap's status pill fell back to the generic
    // "Could not load nearby gyms" for what is really a timeout.
    const timer = setTimeout(
      () => ctrl.abort(new Error(`OSM timed out after ${MIRROR_ABORT_MS / 1000}s`)),
      MIRROR_ABORT_MS,
    );
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

  // Race all mirrors, and if the whole race loses, run it once more.
  //
  // A mirror answering 429 or 504 is the common failure and it is
  // usually momentary — measured repeatedly against private.coffee while
  // building this. One retry turns most of those into a result instead
  // of "we couldn't search for gyms", which is a dead end on a screen
  // whose whole job is to show you a list.
  //
  // NOT retried on a timeout. A timeout means the mirrors are grinding,
  // and a second 30s race just doubles the wait before the same answer.
  // Fast failures get a second chance; slow ones don't.
  const raceMirrors = async () => {
    ctrls = [];
    try {
      const result = await Promise.any(OVERPASS_MIRRORS.map(tryMirror));
      for (const c of ctrls) {
        try { c.abort('won'); } catch { /* ignore */ }
      }
      return result;
    } catch (err) {
      throw err?.errors ? pickError(err.errors) : err;
    }
  };

  let json;
  try {
    json = await raceMirrors();
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (/timed out/i.test(err?.message || '')) throw err;
    try {
      json = await raceMirrors();
    } catch (retryErr) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      throw retryErr;
    }
  }

  // Dedupe by osmId — a gym tagged BOTH leisure=fitness_centre AND
  // amenity=gym (common) would otherwise appear twice.
  //
  // osmType is carried through because migration 275 keys community
  // gyms on (osm_type, osm_id): OSM ids are only unique WITHIN a type,
  // so node/123 and way/123 are different places. Dropping the type
  // here would let two unrelated gyms collide on one database row.
  const seenIds = new Set();
  return (json.elements || [])
    // The classifier runs BEFORE the mapping so it can see the whole tag
    // set. `leisure=sports_centre` is fetched wholesale now, which is
    // what recovers YMCAs and rec centres — and also what drags in
    // tennis courts and public pools, so this is where they leave again.
    .filter(el => isGymLike(el.tags || {}))
    // Outdoor pull-up bars swamp anything wider than a neighbourhood.
    // Enforced here as well as in the query because a fitness_station
    // also tagged `sport=fitness` comes back from that selector at any
    // zoom.
    .filter(el => includeOutdoor || el.tags?.leisure !== 'fitness_station')
    .map(el => ({
      osmId: el.id,
      osmType: el.type || 'node',
      name: el.tags?.name || 'Gym',
      lat: el.type === 'node' ? el.lat : el.center?.lat,
      lon: el.type === 'node' ? el.lon : el.center?.lon,
      brand: el.tags?.brand || null,
      website: el.tags?.website || null,
    }))
    .filter(g => {
      if (!g.lat || !g.lon) return false;
      const key = `${g.osmType}/${g.osmId}`;
      if (seenIds.has(key)) return false;
      seenIds.add(key);
      return true;
    });
}

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_AT_EQUATOR = 111.320;

/**
 * A bounding box that actually contains a circle of `radiusKm` around a
 * point, in BOTH axes.
 *
 * The old code took a single `radiusDeg` and applied it to latitude and
 * longitude alike, which is only true on the equator. A degree of
 * longitude shrinks by cos(latitude), so 0.05° reached 5.56 km north-south
 * but only:
 *
 *     29.8°N (Houston)   4.83 km  — 3.00 mi
 *     40.7°N (New York)  4.22 km  — 2.62 mi
 *     47.6°N (Seattle)   3.75 km  — 2.33 mi
 *
 * east-west. So anywhere north of about 30° the "search radius" was
 * under three miles in the direction it mattered, and a gym three miles
 * down the road was outside the query — not ranked low, not fetched at
 * all. That is the bug this function exists to fix, and it is why the
 * radius is now stated in km rather than in degrees: a caller cannot
 * express the broken thing any more.
 *
 * Exported for tests.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusKm
 */
export function bboxAround(lat, lng, radiusKm) {
  const dLat = radiusKm / KM_PER_DEG_LAT;
  // cos() floors at 0.05 (≈87°) so a fix near a pole widens to roughly a
  // hemisphere instead of dividing by zero.
  const cosLat = Math.max(0.05, Math.cos(lat * Math.PI / 180));
  const dLng = Math.min(180, radiusKm / (KM_PER_DEG_LON_AT_EQUATOR * cosLat));
  return {
    south: Math.max(-90, lat - dLat),
    north: Math.min(90, lat + dLat),
    // Clamped rather than wrapped: Overpass rejects a bbox outside
    // ±180, and truncating the box at the antimeridian loses a sliver of
    // ocean. Wrapping would mean issuing two queries for a case nobody
    // in this app has.
    west: Math.max(-180, lng - dLng),
    east: Math.min(180, lng + dLng),
  };
}

/** Default "near me" radius, in km. 8 km ≈ 5 miles. */
export const DEFAULT_NEAR_RADIUS_KM = 8;

/**
 * Convenience for "gyms near this point" — used by the onboarding
 * picker and the My Gym empty state, which have a geolocation fix rather
 * than a map viewport.
 *
 * 8 km rather than the old ~5.5 km because the previous default was
 * written as a walking-distance decision, and it isn't: people drive to
 * the gym, and the most common "my gym isn't in this list" cause is a
 * radius that stops short of it.
 */
export async function fetchOsmGymsNear(
  lat, lng, { radiusKm = DEFAULT_NEAR_RADIUS_KM, signal } = {},
) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  return fetchOsmGyms(bboxAround(lat, lng, radiusKm), { zoom: 13, signal });
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
