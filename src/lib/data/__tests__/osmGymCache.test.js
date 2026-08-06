// Three cases, and only one of them is allowed to be slow.
//
// The RPC returns coverage alongside the rows because "no gyms here" and
// "never looked here" are different facts. Getting that wrong in either
// direction is a real cost: block on a covered area and every user pays
// Overpass again; serve an unvisited area and you tell someone their town
// has no gyms without having looked.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const invoke = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: (...a) => rpc(...a),
    functions: { invoke: (...a) => invoke(...a) },
  },
}));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

const { fetchOsmGymsNearCached } = await import('../osmGymCache');

const SANFORD = { lat: 43.4387179, lng: -70.7746224 };
const gym = (name, lat, lon) => ({ osmType: 'node', osmId: name.length, name, lat, lon });

/** Shape of get_osm_gyms_cached's JSONB return. */
const cached = (gyms, total, known, fresh) => ({
  data: { gyms, tiles_total: total, tiles_known: known, tiles_fresh: fresh },
  error: null,
});

beforeEach(() => {
  rpc.mockReset();
  invoke.mockReset();
  invoke.mockResolvedValue({ data: { ok: true }, error: null });
});

describe('fetchOsmGymsNearCached', () => {
  it('serves a covered, fresh area without touching the fill', async () => {
    rpc.mockResolvedValueOnce(cached([gym('YMCA', 43.44, -70.78)], 9, 9, 9));

    const { gyms: rows } = await fetchOsmGymsNearCached(SANFORD.lat, SANFORD.lng);

    expect(rows.map(r => r.name)).toEqual(['YMCA']);
    // The whole point: this path is a single ~19ms database read.
    expect(invoke).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('sorts closest first', async () => {
    rpc.mockResolvedValueOnce(cached([
      gym('Far', 43.60, -70.90),
      gym('Near', 43.4390, -70.7750),
      gym('Middle', 43.50, -70.80),
    ], 9, 9, 9));

    const { gyms: rows } = await fetchOsmGymsNearCached(SANFORD.lat, SANFORD.lng);
    expect(rows.map(r => r.name)).toEqual(['Near', 'Middle', 'Far']);
  });

  it('serves a STALE area immediately and refreshes behind the user', async () => {
    rpc.mockResolvedValueOnce(cached([gym('YMCA', 43.44, -70.78)], 9, 9, 0));

    const { gyms: rows } = await fetchOsmGymsNearCached(SANFORD.lat, SANFORD.lng);

    // Gyms open and close over months. A spinner that confirms last
    // month's list is a spinner for nothing.
    expect(rows.map(r => r.name)).toEqual(['YMCA']);
    expect(invoke).toHaveBeenCalledTimes(1);
    // Not re-read: the refresh is for the NEXT visit, nobody waits on it.
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('fills first when the area has never been looked at', async () => {
    rpc
      .mockResolvedValueOnce(cached([], 9, 0, 0))
      .mockResolvedValueOnce(cached([gym('CrossFit 207', 43.46, -70.75)], 9, 9, 9));

    const { gyms: rows } = await fetchOsmGymsNearCached(SANFORD.lat, SANFORD.lng);

    expect(rows.map(r => r.name)).toEqual(['CrossFit 207']);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('trusts a covered-and-empty area rather than re-filling it', async () => {
    // Covered, fresh, genuinely nothing there. Filling again would make
    // every user in a gym-less area pay Overpass on every visit.
    rpc.mockResolvedValueOnce(cached([], 9, 9, 9));

    expect((await fetchOsmGymsNearCached(SANFORD.lat, SANFORD.lng)).gyms).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('returns stale rows rather than an error when the fill fails', async () => {
    rpc.mockResolvedValueOnce(cached([gym('YMCA', 43.44, -70.78)], 9, 4, 4));
    invoke.mockResolvedValue({ data: null, error: new Error('overpass_failed') });

    // Partial coverage plus a dead Overpass. Something beats the picker's
    // failure state, which tells the user to retry what we could show.
    const res = await fetchOsmGymsNearCached(SANFORD.lat, SANFORD.lng);
    expect(res.gyms.map(r => r.name)).toEqual(['YMCA']);
    // But FLAGGED. This used to return the rows and nothing else, so
    // tapping "Search Wider" over a failed fill re-rendered the identical
    // list with no error — asked for more, got the same, told nothing.
    expect(res.partial).toBe(true);
  });

  it('throws when there is nothing cached AND the fill fails', async () => {
    rpc.mockResolvedValueOnce(cached([], 9, 0, 0));
    invoke.mockResolvedValue({ data: null, error: new Error('overpass_failed') });

    // The picker must render "couldn't search" here, not "no gyms
    // nearby" — one is a fact about us, the other about the world.
    await expect(fetchOsmGymsNearCached(SANFORD.lat, SANFORD.lng)).rejects.toThrow();
  });

  it('survives the RPC being missing on a pre-300 host', async () => {
    rpc.mockRejectedValueOnce({ code: '42883', message: 'function does not exist' });
    rpc.mockResolvedValueOnce(cached([gym('YMCA', 43.44, -70.78)], 9, 9, 9));

    const { gyms: rows } = await fetchOsmGymsNearCached(SANFORD.lat, SANFORD.lng);
    expect(rows.map(r => r.name)).toEqual(['YMCA']);
  });

  it('returns [] on a bad fix without any round trip', async () => {
    expect((await fetchOsmGymsNearCached(NaN, -70.77)).gyms).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});
