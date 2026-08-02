import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { fetchOsmGyms, distanceKm } from '../osmGyms';

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

describe('fetchOsmGyms', () => {
  it('carries osmType through for every element', async () => {
    stageOverpass([
      { type: 'node', id: 1, lat: 40, lon: -74, tags: { name: 'A' } },
      { type: 'way', id: 2, center: { lat: 41, lon: -75 }, tags: { name: 'B' } },
    ]);

    const rows = await fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ osmId: 1, osmType: 'node', name: 'A', lat: 40, lon: -74 });
    // A `way` has no lat/lon of its own — `out center` gives it a centre
    // point. Reading el.lat here would drop every way from the results.
    expect(rows[1]).toMatchObject({ osmId: 2, osmType: 'way', name: 'B', lat: 41, lon: -75 });
  });

  it('dedupes on type+id, not id alone', async () => {
    stageOverpass([
      // The same node tagged both leisure=fitness_centre and amenity=gym
      // comes back twice — one physical gym, two pins without dedupe.
      { type: 'node', id: 10, lat: 40, lon: -74, tags: { name: 'Dupe' } },
      { type: 'node', id: 10, lat: 40, lon: -74, tags: { name: 'Dupe' } },
      // Same numeric id, DIFFERENT type — a genuinely different place.
      // Keying on id alone would collapse these two into one.
      { type: 'way', id: 10, center: { lat: 45, lon: -70 }, tags: { name: 'Other' } },
    ]);

    const rows = await fetchOsmGyms({ south: 39, west: -76, north: 46, east: -69 });

    expect(rows).toHaveLength(2);
    expect(rows.map(r => `${r.osmType}/${r.osmId}`)).toEqual(['node/10', 'way/10']);
  });

  it('drops elements with no resolvable coordinates', async () => {
    stageOverpass([
      { type: 'way', id: 3, tags: { name: 'No centre' } },
      { type: 'node', id: 4, lat: 40, lon: -74, tags: { name: 'Fine' } },
    ]);

    const rows = await fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 });

    // A gym with no coordinates cannot be placed on a map or stored —
    // mig 275 rejects it with BAD_COORDS — so it must not reach the UI.
    expect(rows).toHaveLength(1);
    expect(rows[0].osmId).toBe(4);
  });

  it('falls back to "Gym" when the feature is unnamed', async () => {
    stageOverpass([{ type: 'node', id: 5, lat: 40, lon: -74, tags: {} }]);

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

    // Match the STANDALONE selector, not a bare substring: every query
    // also carries `["leisure"!="fitness_station"]` as an exclusion on
    // the sport=fitness lines, so a substring check passes at any zoom
    // and proves nothing.
    const STANDALONE = 'node["leisure"="fitness_station"]';

    await fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 }, { zoom: 13 });
    const zoomedIn = decodeURIComponent(globalThis.fetch.mock.calls[0][0]);
    expect(zoomedIn).toContain(STANDALONE);

    await fetchOsmGyms({ south: 39, west: -76, north: 42, east: -73 }, { zoom: 8 });
    const zoomedOut = decodeURIComponent(globalThis.fetch.mock.calls.at(-1)[0]);
    // Outdoor pull-up bars swamp a city-wide view; they're only useful
    // once you're looking at a neighbourhood.
    expect(zoomedOut).not.toContain(STANDALONE);
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
