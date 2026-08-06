import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchOsmGyms, fetchOsmGymsNear, distanceKm, isGymLike, bboxAround,
} from '../osmGyms';

// Overpass responses are staged per test. fetchOsmGyms races three
// mirrors with Promise.any, so every mirror resolves to the same payload
// here — the winner is whichever the microtask queue settles first, and
// the result must be identical either way.
function stageOverpass(elements) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ elements }),
  }));
}

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** A tag set every classifier branch accepts, so fixtures stay about the
 *  thing under test rather than about what counts as a gym. */
const GYM = { leisure: 'fitness_centre' };

/** One fetch per mirror per race — see OVERPASS_MIRRORS in the module. */
const OVERPASS_MIRROR_COUNT = 3;

describe('fetchOsmGyms', () => {
  it('carries osmType through for every element', async () => {
    stageOverpass([
      { type: 'node', id: 1, lat: 40, lon: -74, tags: { ...GYM, name: 'A' } },
      { type: 'way', id: 2, center: { lat: 41, lon: -75 }, tags: { ...GYM, name: 'B' } },
    ]);

    const rows = await fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ osmId: 1, osmType: 'node', name: 'A', lat: 40, lon: -74 });
    // A `way` has no lat/lon of its own — `out center` gives it a centre
    // point. Reading el.lat here would drop every way from the results.
    expect(rows[1]).toMatchObject({ osmId: 2, osmType: 'way', name: 'B', lat: 41, lon: -75 });
  });

  it('keeps relations — a gym inside a larger building is a multipolygon', async () => {
    stageOverpass([
      { type: 'relation', id: 7, center: { lat: 40, lon: -74 }, tags: { ...GYM, name: 'Rel' } },
    ]);

    const rows = await fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 });

    // The query asked for `node` and `way` only until 2026-08-06, so a
    // relation could never arrive here in the first place.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ osmType: 'relation', osmId: 7 });
  });

  it('queries nodes, ways and relations together', async () => {
    stageOverpass([]);
    await fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 });
    const q = decodeURIComponent(globalThis.fetch.mock.calls[0][0]);

    expect(q).toContain('nwr["leisure"="fitness_centre"]');
    // Unfiltered on purpose: YMCAs, rec centres and plenty of commercial
    // gyms carry sports_centre with no `sport=fitness`. The old
    // `["sport"~"fitness"]` qualifier is what hid them.
    expect(q).toContain('nwr["leisure"="sports_centre"]');
    expect(q).not.toContain('"sport"~');
    // Every selector must be an indexed exact match. A negative regex
    // turns the query into a bbox scan — measured at three consecutive
    // 504s where the exact-match form answered in 27s.
    expect(q).not.toContain('!~');
  });

  it('drops the broad sports_centre sweep below metro zoom', async () => {
    stageOverpass([]);
    const SWEEP = 'nwr["leisure"="sports_centre"]';

    // It is the broadest selector here and cost scales with viewport:
    // measured on a phone-shaped bbox, zoom 9 answered in 3.1s, zoom 7
    // in 10.1s and zoom 5 in 27.0s against a 30s cap. Below a metro view
    // the names aren't legible anyway, so the recall can't be used.
    await fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 }, { zoom: 6 });
    expect(decodeURIComponent(globalThis.fetch.mock.calls[0][0])).not.toContain(SWEEP);

    await fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 }, { zoom: 9 });
    expect(decodeURIComponent(globalThis.fetch.mock.calls.at(-1)[0])).toContain(SWEEP);

    // The near-me picker fetches at zoom 13, so it always gets the sweep
    // — that is the surface the recall was widened for.
    await fetchOsmGymsNear(40, -74);
    expect(decodeURIComponent(globalThis.fetch.mock.calls.at(-1)[0])).toContain(SWEEP);
  });

  it('re-races the mirrors once when the whole race fails fast', async () => {
    // 429 and 504 are the common Overpass failures and they are usually
    // momentary. Without a retry the picker renders "we couldn't search
    // for gyms" — a dead end on a screen whose only job is to show a
    // list — for something a second attempt would have answered.
    let round = 0;
    globalThis.fetch = vi.fn(async () => {
      // Three mirrors per race, so the first three calls are round one.
      if (round++ < OVERPASS_MIRROR_COUNT) throw new Error('OSM 504');
      return { ok: true, json: async () => ({ elements: [
        { type: 'node', id: 1, lat: 40, lon: -74, tags: { ...GYM, name: 'Second try' } },
      ] }) };
    });

    const rows = await fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 });
    expect(rows.map(r => r.name)).toEqual(['Second try']);
  });

  it('gives up after the second race rather than looping', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('OSM 504'); });

    await expect(
      fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 }),
    ).rejects.toThrow('504');
    // Two races, three mirrors each. A third would be a retry loop
    // against a service that blocks abusers.
    expect(globalThis.fetch).toHaveBeenCalledTimes(OVERPASS_MIRROR_COUNT * 2);
  });

  it('does NOT retry a timeout', async () => {
    // A timeout means the mirrors are grinding. A second 30s race just
    // doubles the wait before the same answer.
    vi.useFakeTimers();
    globalThis.fetch = vi.fn((_url, { signal }) => new Promise((_res, rej) => {
      signal.addEventListener('abort', () => rej(signal.reason));
    }));

    const promise = fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 });
    const assertion = expect(promise).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(31_000);
    await assertion;
    expect(globalThis.fetch).toHaveBeenCalledTimes(OVERPASS_MIRROR_COUNT);
    vi.useRealTimers();
  });

  it('reports a timeout as a timeout', async () => {
    // AbortSignal.abort(reason) rejects with the reason VERBATIM, so
    // abort('timeout') threw a bare STRING out to callers: err.message
    // was undefined and GymMap fell back to its generic failure copy for
    // what is really a timeout.
    vi.useFakeTimers();
    globalThis.fetch = vi.fn((_url, { signal }) => new Promise((_res, rej) => {
      signal.addEventListener('abort', () => rej(signal.reason));
    }));

    const promise = fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 });
    const assertion = expect(promise).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(31_000);
    await assertion;
    vi.useRealTimers();
  });

  it('dedupes on type+id, not id alone', async () => {
    stageOverpass([
      // The same node tagged both leisure=fitness_centre and amenity=gym
      // comes back twice — one physical gym, two pins without dedupe.
      { type: 'node', id: 10, lat: 40, lon: -74, tags: { ...GYM, name: 'Dupe' } },
      { type: 'node', id: 10, lat: 40, lon: -74, tags: { ...GYM, name: 'Dupe' } },
      // Same numeric id, DIFFERENT type — a genuinely different place.
      // Keying on id alone would collapse these two into one.
      { type: 'way', id: 10, center: { lat: 45, lon: -70 }, tags: { ...GYM, name: 'Other' } },
    ]);

    const rows = await fetchOsmGyms({ south: 39, west: -76, north: 46, east: -69 });

    expect(rows).toHaveLength(2);
    expect(rows.map(r => `${r.osmType}/${r.osmId}`)).toEqual(['node/10', 'way/10']);
  });

  it('drops elements with no resolvable coordinates', async () => {
    stageOverpass([
      { type: 'way', id: 3, tags: { ...GYM, name: 'No centre' } },
      { type: 'node', id: 4, lat: 40, lon: -74, tags: { ...GYM, name: 'Fine' } },
    ]);

    const rows = await fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 });

    // A gym with no coordinates cannot be placed on a map or stored —
    // mig 275 rejects it with BAD_COORDS — so it must not reach the UI.
    expect(rows).toHaveLength(1);
    expect(rows[0].osmId).toBe(4);
  });

  it('drops what the over-fetching query dragged in that is not a gym', async () => {
    stageOverpass([
      { type: 'way', id: 20, center: { lat: 40, lon: -74 },
        tags: { leisure: 'sports_centre', sport: 'tennis', name: 'Tennis Center' } },
      { type: 'way', id: 21, center: { lat: 40, lon: -74 },
        tags: { leisure: 'sports_centre', sport: 'swimming', name: 'Aquatics Center' } },
      { type: 'way', id: 22, center: { lat: 40, lon: -74 },
        tags: { leisure: 'sports_centre', name: 'Weekley Family YMCA' } },
    ]);

    const rows = await fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 });

    expect(rows.map(r => r.name)).toEqual(['Weekley Family YMCA']);
  });

  it('falls back to "Gym" when the feature is unnamed', async () => {
    stageOverpass([{ type: 'node', id: 5, lat: 40, lon: -74, tags: { ...GYM } }]);

    const rows = await fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 });

    // The RPC rejects an empty name, so an unnamed OSM feature needs
    // *something* or it becomes unpickable.
    expect(rows[0].name).toBe('Gym');
  });

  it('throws AbortError when the caller already aborted', async () => {
    stageOverpass([]);
    const ac = new AbortController();
    ac.abort();

    await expect(
      fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 }, { signal: ac.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('includes outdoor fitness stations only when zoomed in', async () => {
    stageOverpass([]);
    const SELECTOR = 'nwr["leisure"="fitness_station"]';

    await fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 }, { zoom: 13 });
    const zoomedIn = decodeURIComponent(globalThis.fetch.mock.calls[0][0]);
    expect(zoomedIn).toContain(SELECTOR);

    await fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 }, { zoom: 8 });
    const zoomedOut = decodeURIComponent(globalThis.fetch.mock.calls.at(-1)[0]);
    // Outdoor pull-up bars swamp a city-wide view; they're only useful
    // once you're looking at a neighbourhood.
    expect(zoomedOut).not.toContain(SELECTOR);
  });

  it('filters out fitness stations at low zoom even when the query cannot', async () => {
    // A pull-up bar also tagged `sport=fitness` comes back from THAT
    // selector at every zoom, so dropping the station selector from the
    // query is not enough on its own.
    stageOverpass([
      { type: 'node', id: 30, lat: 40, lon: -74,
        tags: { leisure: 'fitness_station', sport: 'fitness', name: 'Pull-up bar' } },
      { type: 'node', id: 31, lat: 40, lon: -74, tags: { ...GYM, name: 'Real Gym' } },
    ]);

    const wide = await fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 }, { zoom: 8 });
    expect(wide.map(r => r.name)).toEqual(['Real Gym']);

    const close = await fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 }, { zoom: 14 });
    expect(close.map(r => r.name)).toEqual(['Pull-up bar', 'Real Gym']);
  });
});

describe('isGymLike', () => {
  it.each([
    ['fitness centre', { leisure: 'fitness_centre' }],
    ['amenity=gym', { amenity: 'gym' }],
    ['club=fitness', { club: 'fitness' }],
    ['sports centre, no sport tag (a YMCA)', { leisure: 'sports_centre' }],
    ['sports centre, boxing', { leisure: 'sports_centre', sport: 'boxing' }],
    ['sports centre, climbing', { leisure: 'sports_centre', sport: 'climbing' }],
    ['sports centre, exercise', { leisure: 'sports_centre', sport: 'exercise' }],
    // CrossFit boxes are routinely mapped this way with no leisure tag.
    ['bare sport=gymnastics', { sport: 'gymnastics', name: 'CrossFit EaDo' }],
    ['multi-sport including fitness', { leisure: 'sports_centre', sport: 'swimming;fitness' }],
    ['named like a gym', { building: 'yes', name: "Gold's Gym" }],
  ])('keeps %s', (_label, tags) => {
    expect(isGymLike(tags)).toBe(true);
  });

  it.each([
    ['a tennis centre', { leisure: 'sports_centre', sport: 'tennis', name: 'Memorial Park Tennis Center' }],
    ['a public pool', { leisure: 'sports_centre', sport: 'swimming', name: 'Colonial Park Pool' }],
    ['a basketball arena', { leisure: 'sports_centre', sport: 'basketball', name: 'Fertitta Center' }],
    ['a baseball park', { leisure: 'sports_centre', sport: 'baseball;softball', name: 'Diez Street Park' }],
    ['axe throwing', { leisure: 'sports_centre', sport: 'axe_throwing', name: 'BATL' }],
    ['a polo club', { leisure: 'sports_centre', sport: 'polo', name: 'Houston Polo Club' }],
    ['an untagged building', { building: 'yes', name: 'Some Office' }],
  ])('drops %s', (_label, tags) => {
    expect(isGymLike(tags)).toBe(false);
  });
});

describe('bboxAround', () => {
  // The bug: one degree offset applied to BOTH axes. A degree of
  // longitude shrinks by cos(latitude), so the east-west reach of the
  // old 0.05° box was 3.00 mi in Houston and 2.33 mi in Seattle — a gym
  // three miles away was never fetched.
  const spanKm = (box, lat) => ({
    ns: (box.north - box.south) * 110.574,
    ew: (box.east - box.west) * 111.320 * Math.cos(lat * Math.PI / 180),
  });

  it.each([
    ['Houston', 29.76],
    ['New York', 40.71],
    ['Seattle', 47.61],
    ['Reykjavik', 64.13],
    ['the equator', 0],
  ])('reaches the full radius in both axes at %s', (_label, lat) => {
    const { ns, ew } = spanKm(bboxAround(lat, -95, 8), lat);
    expect(ns / 2).toBeCloseTo(8, 1);
    expect(ew / 2).toBeCloseTo(8, 1);
  });

  it('stays inside legal bbox bounds near a pole', () => {
    const box = bboxAround(89.9, 0, 40);
    expect(box.north).toBeLessThanOrEqual(90);
    expect(box.south).toBeGreaterThanOrEqual(-90);
    expect(box.west).toBeGreaterThanOrEqual(-180);
    expect(box.east).toBeLessThanOrEqual(180);
    expect(Number.isFinite(box.east)).toBe(true);
  });

  it('clamps rather than wrapping at the antimeridian', () => {
    const box = bboxAround(0, 179.9, 40);
    expect(box.east).toBe(180);
  });
});

describe('fetchOsmGymsNear', () => {
  it('sends a box whose east-west reach matches the radius', async () => {
    stageOverpass([]);
    await fetchOsmGymsNear(47.61, -122.33, { radiusKm: 8 });

    const q = decodeURIComponent(globalThis.fetch.mock.calls[0][0]);
    const [, s, w, n, e] = q.match(/\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/)
      .map(Number);
    const ew = (e - w) * 111.320 * Math.cos(47.61 * Math.PI / 180) / 2;
    const ns = (n - s) * 110.574 / 2;

    expect(ns).toBeCloseTo(8, 1);
    // Under the old radiusDeg default this was 3.75 km — less than the
    // three miles a user would reasonably call "nearby".
    expect(ew).toBeCloseTo(8, 1);
  });

  it('returns [] rather than querying on a bad fix', async () => {
    stageOverpass([]);
    expect(await fetchOsmGymsNear(NaN, -122.33)).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('distanceKm', () => {
  it('returns 0 for the same point', () => {
    expect(distanceKm(40, -74, 40, -74)).toBe(0);
  });

  it('approximates a known distance', () => {
    // NYC → Philadelphia is ~130 km.
    const d = distanceKm(40.7128, -74.0060, 39.9526, -75.1652);
    expect(d).toBeGreaterThan(125);
    expect(d).toBeLessThan(140);
  });
});

describe('mirror race error reporting', () => {
  it('surfaces an informative error rather than the 406 mirror', async () => {
    // overpass-api.de answers browser User-Agents with 406 and no CORS
    // header, so from the app it ALWAYS fails. It is last in the mirror
    // list, but Promise.any's AggregateError still carries its error —
    // and reporting that one would describe every outage as "406"
    // regardless of what actually broke.
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('overpass-api.de')) throw new Error('OSM 406');
      throw new Error('OSM 504 Gateway Timeout');
    });

    await expect(
      fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 }),
    ).rejects.toThrow('504');
  });

  it('tries the CORS-capable mirror first', async () => {
    stageOverpass([]);
    await fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 });
    // private.coffee was the only mirror answering reliably from a
    // browser origin when this was audited; overpass-api.de must not be
    // the first request the app makes.
    const first = String(globalThis.fetch.mock.calls[0][0]);
    expect(first).toContain('private.coffee');
    expect(first).not.toContain('overpass-api.de');
  });
});
