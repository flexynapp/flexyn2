import { describe, it, expect } from 'vitest';
import {
  matchesQuery, matchesFlexynGym, matchesOsmGym, normalizeQuery,
} from '../gymSearch';

// The Gym Locator draws two pin layers. The search box filtered only
// `gyms` (registered gym_businesses rows) and left every OpenStreetMap
// teardrop on screen — which is nearly all of them, because almost no
// real gym has registered a business account. These assert that one
// query covers both layers.

describe('normalizeQuery', () => {
  it('trims and lowercases', () => {
    expect(normalizeQuery('  Planet Fitness  ')).toBe('planet fitness');
  });

  it('survives null and undefined', () => {
    expect(normalizeQuery(null)).toBe('');
    expect(normalizeQuery(undefined)).toBe('');
  });
});

describe('matchesQuery', () => {
  it('matches everything on an empty query, so callers can filter unconditionally', () => {
    expect(matchesQuery('', 'anything')).toBe(true);
    expect(matchesQuery('', null, undefined)).toBe(true);
  });

  it('matches a substring in any field', () => {
    expect(matchesQuery('fit', 'Planet Fitness', null)).toBe(true);
    expect(matchesQuery('chicago', null, 'Chicago')).toBe(true);
  });

  it('does not match when no field contains it', () => {
    expect(matchesQuery('crossfit', 'Planet Fitness', 'Chicago')).toBe(false);
  });

  it('ignores missing fields rather than throwing', () => {
    expect(matchesQuery('fit', undefined, null, 'Fitness')).toBe(true);
  });
});

describe('matchesFlexynGym', () => {
  const gym = { name: "Gold's Gym", city: 'Austin' };

  it('matches on name', () => expect(matchesFlexynGym('gold', gym)).toBe(true));
  it('matches on city', () => expect(matchesFlexynGym('austin', gym)).toBe(true));
  it('rejects a miss', () => expect(matchesFlexynGym('planet', gym)).toBe(false));
  it('survives a row with neither field', () => {
    expect(matchesFlexynGym('gold', {})).toBe(false);
  });
});

describe('matchesOsmGym', () => {
  // OSM features carry no city, but chains carry a brand — and the brand
  // is often cleaner than the name ("PF Gym" branded "Planet Fitness").
  const pin = { name: 'PF Gym', brand: 'Planet Fitness' };

  it('matches on name', () => expect(matchesOsmGym('pf', pin)).toBe(true));
  it('matches on brand', () => expect(matchesOsmGym('planet', pin)).toBe(true));
  it('rejects a miss', () => expect(matchesOsmGym('equinox', pin)).toBe(false));

  it('is the same query that filters the Flexyn layer', () => {
    // The regression: typing "planet fitness" hid the Flexyn bubbles and
    // left every OSM teardrop standing, because only one layer was
    // filtered. Both matchers must answer a single normalised query.
    const q = normalizeQuery('  Planet Fitness ');
    expect(matchesOsmGym(q, { name: 'Planet Fitness' })).toBe(true);
    expect(matchesFlexynGym(q, { name: 'Planet Fitness', city: 'Chicago' })).toBe(true);
    expect(matchesOsmGym(q, { name: 'Momentum Climbing' })).toBe(false);
  });
});
