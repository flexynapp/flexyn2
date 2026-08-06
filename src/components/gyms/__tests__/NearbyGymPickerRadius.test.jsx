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
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const fetchOsmGymsNear = vi.fn();
vi.mock('@/lib/osmGyms', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchOsmGymsNear: (...args) => fetchOsmGymsNear(...args),
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

/** Radii the picker asked for, in km, in order. */
const radiiRequested = () => fetchOsmGymsNear.mock.calls.map(c => c[2].radiusKm);

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
      .mockResolvedValueOnce([])                                   // 5 mi: nothing
      .mockResolvedValueOnce([osmGym('Planet Fitness', 43.6, -70.8)]); // 30 mi

    render(<NearbyGymPicker value={null} onChange={() => {}} />);

    await waitFor(() => expect(screen.getByText('Planet Fitness')).toBeTruthy());
    // 8 km ≈ 5 miles, then straight to 48 km ≈ 30. No intermediate step:
    // one extra round trip is the whole budget for this.
    expect(radiiRequested()).toEqual([8, 48]);
    // And the user is never shown the dead end on the way.
    expect(screen.queryByText(/No gyms found nearby/i)).toBeNull();
    // ONE satellite fix, not two. The widen used to re-enter through
    // getCurrentPosition, so an empty first search paid for a second
    // fix before its query even started — pure latency on exactly the
    // path where the user is already waiting longest.
    expect(geolocationCalls).toBe(1);
  });

  it('does not widen when the first radius already had something', async () => {
    fetchOsmGymsNear.mockResolvedValueOnce([osmGym('CrossFit 207', 43.45, -70.78)]);

    render(<NearbyGymPicker value={null} onChange={() => {}} />);

    await waitFor(() => expect(screen.getByText('CrossFit 207')).toBeTruthy());
    expect(radiiRequested()).toEqual([8]);
  });

  it('stops at the maximum rather than escalating forever', async () => {
    fetchOsmGymsNear.mockResolvedValue([]);

    render(<NearbyGymPicker value={null} onChange={() => {}} />);

    await waitFor(() => expect(screen.getByText(/No gyms found nearby/i)).toBeTruthy());
    expect(radiiRequested()).toEqual([8, 48]);
    // Now the empty state is honest: 30 miles really were searched.
    expect(screen.getByText(/within/i).textContent).toMatch(/30 mi/);
  });

  it('states the radius even when the host passes its own hint', async () => {
    // This is the shape the bug had: the radius line was
    // `emptyHint || <radius>`, and BOTH hosts pass an emptyHint — so the
    // sentence that makes "no gyms found" checkable had never once
    // rendered in the app, only in a test that passed no hint. It also
    // cost a diagnosis: with the screen reading the same before and
    // after the fix, nobody could tell which build a phone was running.
    fetchOsmGymsNear.mockResolvedValue([]);

    render(
      <NearbyGymPicker
        value={null}
        onChange={() => {}}
        emptyHint="Skip for now — you can pick your gym from the map later."
      />,
    );

    await waitFor(() => expect(screen.getByText(/No gyms found nearby/i)).toBeTruthy());
    // The fact AND the advice, not one instead of the other.
    expect(screen.getByText(/Nothing is mapped within/i).textContent).toMatch(/30 mi/);
    expect(screen.getByText(/Skip for now/i)).toBeTruthy();
  });
});

describe('a failed lookup does not widen', () => {
  it('reports the failure instead of claiming nothing is within 30 miles', async () => {
    fetchOsmGymsNear.mockRejectedValue(new Error('OSM timed out after 30s'));

    render(<NearbyGymPicker value={null} onChange={() => {}} />);

    await waitFor(() => expect(screen.getByText(/Couldn't search for gyms/i)).toBeTruthy());
    // One attempt. Widening a query that never ran would take twice as
    // long to produce a claim it hasn't earned.
    expect(radiiRequested()).toEqual([8]);
    expect(screen.queryByText(/within 30 mi/i)).toBeNull();
  });
});

describe('adding a gym OpenStreetMap has never heard of', () => {
  // The case this exists for: a Planet Fitness three miles away that
  // appears in no tag on any of the 1,905 named objects within five
  // miles of it. No radius reaches a place that isn't in the dataset.

  const openAddForm = async () => {
    await waitFor(() => expect(screen.getByText(/isn't listed/i)).toBeTruthy());
    fireEvent.click(screen.getByText(/isn't listed/i));
  };

  it('reports the typed name at the fix the lookup already used', async () => {
    fetchOsmGymsNear.mockResolvedValue([]);
    const onChange = vi.fn();

    render(<NearbyGymPicker value={null} onChange={onChange} />);
    await openAddForm();

    fireEvent.change(screen.getByPlaceholderText('Gym name'), {
      target: { value: '  Planet Fitness Sanford  ' },
    });
    fireEvent.click(screen.getByText('Add gym'));

    // The POSITION is the user's own geolocation fix, never a typed
    // address. That is what makes a typed name trustworthy enough to
    // share a row: whoever adds it is standing in it.
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      custom: {
        name: 'Planet Fitness Sanford',
        lat: SANFORD.latitude,
        lng: SANFORD.longitude,
      },
      name: 'Planet Fitness Sanford',
    }));
  });

  it('will not submit a name too short for the RPC to accept', async () => {
    fetchOsmGymsNear.mockResolvedValue([]);
    const onChange = vi.fn();

    render(<NearbyGymPicker value={null} onChange={onChange} />);
    await openAddForm();

    fireEvent.change(screen.getByPlaceholderText('Gym name'), { target: { value: 'X' } });
    fireEvent.click(screen.getByText('Add gym'));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the pending pick, because onboarding does not save until the end', async () => {
    fetchOsmGymsNear.mockResolvedValue([]);

    render(
      <NearbyGymPicker
        value={{ custom: { name: 'Planet Fitness Sanford', lat: 43.4, lng: -70.7 } }}
        onChange={() => {}}
      />,
    );

    // Without this the user types a name, taps Add, and the screen looks
    // exactly as it did before — the same failure the My Gym picker
    // already had once, where "highlighted" read as "saved".
    await waitFor(() => expect(screen.getByText('Planet Fitness Sanford')).toBeTruthy());
    expect(screen.getByText(/Adding at your location/i)).toBeTruthy();
  });

  it('offers the path alongside a list too, not only when empty', async () => {
    fetchOsmGymsNear.mockResolvedValueOnce([osmGym('CrossFit 207', 43.45, -70.78)]);

    render(<NearbyGymPicker value={null} onChange={() => {}} />);

    await waitFor(() => expect(screen.getByText('CrossFit 207')).toBeTruthy());
    // Five gyms within 3 miles and none of them yours is the exact
    // Sanford case — a non-empty list is no evidence the right one is in it.
    expect(screen.getByText(/isn't listed/i)).toBeTruthy();
  });
});
