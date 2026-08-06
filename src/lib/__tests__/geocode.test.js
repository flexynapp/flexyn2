import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { searchPlaces, PLACES_ATTRIBUTION, __resetGeocodeState } from '../geocode';

// Nominatim is a donated service that blocks abusers by IP, so the rate
// limit and the cache are not optimisations — breaking either kills the
// feature for every user at once. These assert on the traffic we
// generate, not just on the values we return.

const CHICAGO = {
  place_id: 1234,
  osm_type: 'relation',
  osm_id: 122604,
  lat: '41.8755616',
  lon: '-87.6244212',
  name: 'Chicago',
  display_name: 'Chicago, Cook County, Illinois, United States',
  // [minLat, maxLat, minLon, maxLon], as STRINGS — neither the order nor
  // the type anything else in this codebase uses.
  boundingbox: ['41.6443349', '42.0230669', '-87.9402669', '-87.5240812'],
};

const realFetch = globalThis.fetch;

beforeEach(() => {
  __resetGeocodeState();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = realFetch;
});

function stage(rows, { ok = true, status = 200 } = {}) {
  globalThis.fetch = vi.fn(async () => ({ ok, status, json: async () => rows }));
  return globalThis.fetch;
}

describe('searchPlaces', () => {
  it('normalises a Nominatim row into a place', async () => {
    stage([CHICAGO]);

    const [place] = await searchPlaces('chicago');

    expect(place).toMatchObject({
      name: 'Chicago',
      label: 'Chicago, Cook County, Illinois, United States',
      lat: 41.8755616,
      lon: -87.6244212,
    });
    // Reordered and cast — feeding Nominatim's array straight to
    // fitBounds would put the map in the middle of the Pacific.
    expect(place.bbox).toEqual({
      south: 41.6443349, north: 42.0230669,
      west: -87.9402669, east: -87.5240812,
    });
  });

  it('keeps a place that has no bounding box', async () => {
    stage([{ ...CHICAGO, boundingbox: undefined }]);
    const [place] = await searchPlaces('chicago');
    expect(place.bbox).toBeNull();
    expect(place.lat).toBe(41.8755616);
  });

  it('drops a row with unusable coordinates rather than flying to NaN', async () => {
    stage([{ ...CHICAGO, lat: 'nope' }, CHICAGO]);
    expect(await searchPlaces('chicago')).toHaveLength(1);
  });

  it('does not call the service for a one-character query', async () => {
    const fetchMock = stage([CHICAGO]);
    expect(await searchPlaces('c')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves a repeat search from cache', async () => {
    const fetchMock = stage([CHICAGO]);

    await searchPlaces('chicago');
    await searchPlaces('  CHICAGO  ');

    // Same query, different whitespace and case — one request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches an empty answer too', async () => {
    const fetchMock = stage([]);

    expect(await searchPlaces('asdfghjkl')).toEqual([]);
    expect(await searchPlaces('asdfghjkl')).toEqual([]);

    // "There is no such place" is a stable fact; re-asking for it is
    // exactly the traffic the usage policy exists to prevent.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('spaces distinct lookups at least a second apart', async () => {
    const at = [];
    globalThis.fetch = vi.fn(async () => {
      at.push(Date.now());
      return { ok: true, status: 200, json: async () => [CHICAGO] };
    });

    // Fired in the same tick — the gate has to serialise them, because
    // two callers measuring the same gap would both decide they may go.
    const both = Promise.all([searchPlaces('chicago'), searchPlaces('houston')]);
    await vi.advanceTimersByTimeAsync(5_000);
    await both;

    expect(at).toHaveLength(2);
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(1_000);
  });

  it('throws on an HTTP failure instead of reporting no such place', async () => {
    stage(null, { ok: false, status: 429 });

    // The distinction is the whole point: "we couldn't ask" and "there
    // is no such place" are different sentences, and only one of them
    // should offer a retry.
    await expect(searchPlaces('chicago')).rejects.toThrow(/429/);
  });

  it('does not cache a failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => null })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [CHICAGO] });
    globalThis.fetch = fetchMock;

    await expect(searchPlaces('chicago')).rejects.toThrow();
    const retry = searchPlaces('chicago');
    await vi.advanceTimersByTimeAsync(2_000);

    expect(await retry).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts while waiting for its rate-limit slot', async () => {
    stage([CHICAGO]);
    await searchPlaces('chicago');           // consumes the slot

    const ac = new AbortController();
    const queued = searchPlaces('houston', { signal: ac.signal });
    const assertion = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    ac.abort();
    await assertion;
  });

  it('lets a later search through after an aborted one', async () => {
    const fetchMock = stage([CHICAGO]);
    await searchPlaces('chicago');

    const ac = new AbortController();
    const doomed = searchPlaces('houston', { signal: ac.signal });
    ac.abort();
    await expect(doomed).rejects.toMatchObject({ name: 'AbortError' });

    // A rejected link must not poison the gate chain for everyone after.
    const next = searchPlaces('austin');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await next).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('asks for jsonv2 and encodes the query', async () => {
    const fetchMock = stage([CHICAGO]);
    await searchPlaces('gold\'s gym & spa');

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('format=jsonv2');
    expect(url).toContain(encodeURIComponent("gold's gym & spa"));
  });
});

describe('PLACES_ATTRIBUTION', () => {
  it('credits OpenStreetMap, which ODbL requires', () => {
    expect(PLACES_ATTRIBUTION).toMatch(/OpenStreetMap/);
  });
});
