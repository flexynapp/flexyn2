// The auto-widen in NearbyGymPicker.
//
// Reported from Sanford, Maine: "timed out, no gyms found". Two separate
// things were behind that phrasing and they need opposite handling.
//
// Outside a city the default radius can be genuinely empty, and the old
// behaviour was to render "No gyms found nearby" plus a button the user
// had to notice and press. That is a dead end on a screen whose only job
// is to hand someone a list. An empty-but-successful lookup now goes
// straight out to the 30-mile maximum on its own.
//
// A FAILED lookup must not do that. Widening a query that never ran
// produces "nothing within 30 miles" — a claim about the world made on
// no evidence — and takes twice as long to say it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// These components now read tFallback, and useLanguage() throws outside a
// provider by design. Resolving the real English catalog rather than returning
// key paths, so any assertion here still reads like the screen.
vi.mock('@/lib/LanguageContext', async () => {
  const { languageMock } = await import('@/lib/__tests__/i18nMock');
  return languageMock();
});


// The picker reads the Postgres cache now, not Overpass directly.
const fetchOsmGymsNear = vi.fn();
vi.mock('@/lib/data/osmGymCache', () => ({
  fetchOsmGymsNearCached: (...args) => fetchOsmGymsNear(...args),
}));

vi.mock('@/lib/data/gymBusinesses', () => ({
  getGymsInBbox: vi.fn(async () => []),
}));

const NearbyGymPicker = (await import('../NearbyGymPicker')).default;

/** Geolocation always succeeds, at Sanford, Maine. */
const SANFORD = { latitude: 43.4387179, longitude: -70.7746224 };

const osmGym = (name, lat, lon) => ({
  osmId: Math.abs(name.length * 7919), osmType: 'node', name, lat, lon,
  brand: null, website: null,
});

/** The cache returns { gyms, partial } — `partial` means a widen was
 *  asked for and could not be served, so the rows are the narrower set. */
const cached = (gyms, partial = false) => ({ gyms, partial });

/** 3 / 6 / 12 / 24 miles, in km. Doubling is the product decision. */
const MI = 1.609344;
const R = [3, 6, 12, 24].map(m => +(m * MI).toFixed(6));

/** Radii the picker asked for, in km, in order. */
const radiiRequested = () =>
  fetchOsmGymsNear.mock.calls.map(c => +c[2].radiusKm.toFixed(6));

let geolocationCalls = 0;

beforeEach(() => {
  fetchOsmGymsNear.mockReset();
  geolocationCalls = 0;
  vi.stubGlobal('navigator', {
    ...globalThis.navigator,
    geolocation: {
      getCurrentPosition: (ok) => { geolocationCalls++; ok({ coords: SANFORD }); },
    },
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('an empty result widens itself', () => {
  it('escalates to 30 miles and shows what it finds there', async () => {
    fetchOsmGymsNear
      .mockResolvedValueOnce(cached([]))                                   // 5 mi: nothing
      .mockResolvedValueOnce(cached([osmGym('Planet Fitness', 43.6, -70.8)])); // 30 mi

    render(<NearbyGymPicker value={null} onChange={() => {}} />);

    await waitFor(() => expect(screen.getByText('Planet Fitness')).toBeTruthy());
    // 3 miles, then 6 — ONE step. It used to jump straight to the
    // maximum, which made "Search Wider" vanish on the first empty
    // result: the control disappeared exactly when it was wanted.
    expect(radiiRequested()).toEqual([R[0], R[1]]);
    // And the user is never shown the dead end on the way.
    expect(screen.queryByText(/No gyms found nearby/i)).toBeNull();
    // ONE satellite fix, not two. The widen used to re-enter through
    // getCurrentPosition, so an empty first search paid for a second
    // fix before its query even started — pure latency on exactly the
    // path where the user is already waiting longest.
    expect(geolocationCalls).toBe(1);
  });

  it('does not widen when the first radius already had something', async () => {
    fetchOsmGymsNear.mockResolvedValueOnce(cached([osmGym('CrossFit 207', 43.45, -70.78)]));

    render(<NearbyGymPicker value={null} onChange={() => {}} />);

    await waitFor(() => expect(screen.getByText('CrossFit 207')).toBeTruthy());
    expect(radiiRequested()).toEqual([R[0]]);
  });

  it('stops at the maximum rather than escalating forever', async () => {
    fetchOsmGymsNear.mockResolvedValue(cached([]));

    render(<NearbyGymPicker value={null} onChange={() => {}} />);

    await waitFor(() => expect(screen.getByText(/No gyms found nearby/i)).toBeTruthy());
    // Every step, in order, and then it stops — 3, 6, 12, 24 and no
    // fifth attempt. Stepping is what keeps "Search Wider" on screen
    // while there is still somewhere wider to go.
    expect(radiiRequested()).toEqual(R);
    // And the empty state is now honest: 24 miles really were searched.
    expect(screen.getByText(/Nothing is mapped within/i).textContent).toMatch(/24 mi/);
  });

  it('states the radius even when the host passes its own hint', async () => {
    // This is the shape the bug had: the radius line was
    // `emptyHint || <radius>`, and BOTH hosts pass an emptyHint — so the
    // sentence that makes "no gyms found" checkable had never once
    // rendered in the app, only in a test that passed no hint. It also
    // cost a diagnosis: with the screen reading the same before and
    // after the fix, nobody could tell which build a phone was running.
    fetchOsmGymsNear.mockResolvedValue(cached([]));

    render(
      <NearbyGymPicker
        value={null}
        onChange={() => {}}
        emptyHint="Skip for now — you can pick your gym from the map later."
      />,
    );

    await waitFor(() => expect(screen.getByText(/No gyms found nearby/i)).toBeTruthy());
    // The fact AND the advice, not one instead of the other.
    expect(screen.getByText(/Nothing is mapped within/i).textContent).toMatch(/24 mi/);
    expect(screen.getByText(/Skip for now/i)).toBeTruthy();
  });
});

describe('a failed lookup does not widen', () => {
  it('reports the failure instead of claiming nothing is within 24 miles', async () => {
    fetchOsmGymsNear.mockRejectedValue(new Error('OSM timed out after 30s'));

    render(<NearbyGymPicker value={null} onChange={() => {}} />);

    await waitFor(() => expect(screen.getByText(/Couldn't search for gyms/i)).toBeTruthy());
    // One attempt. Widening a query that never ran would take twice as
    // long to produce a claim it hasn't earned.
    expect(radiiRequested()).toEqual([R[0]]);
    expect(screen.queryByText(/Nothing is mapped within/i)).toBeNull();
  });
});
