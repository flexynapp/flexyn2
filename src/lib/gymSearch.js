// src/lib/gymSearch.js
//
// Matching for the Gym Locator search box.
//
// Lives here rather than in GymMap.jsx for the same reason osmGyms.js
// does: GymMap statically imports maplibre-gl, so a test that reached
// into it would drag the whole map engine into jsdom. This is the part
// worth asserting on and it needs no map at all.
//
// The map draws TWO pin layers and the search used to filter only one:
// `gyms` (registered gym_businesses rows). Every grey OpenStreetMap
// teardrop stayed on screen no matter what was typed, and Enter's
// fly-to only ever looked at the Flexyn rows.
//
// That is the wrong 5%. Almost no real gym has registered a business
// account — the whole reason migration 275 promotes OSM features into
// community gyms — so on a typical viewport `gyms` is a handful and
// `osmGyms` is everything else. Searching "Planet Fitness" removed the
// few bubbles that didn't match, left forty unrelated teardrops
// standing, and did nothing on Enter. It read as a dead control.
//
// One matcher, both layers.

/**
 * Does a query match any of these fields? An empty query matches
 * everything, so callers can filter unconditionally.
 *
 * @param {string} q  already lowercased and trimmed
 */
export function matchesQuery(q, ...fields) {
  if (!q) return true;
  return fields.some(f => (f || '').toLowerCase().includes(q));
}

/** A gym_businesses row. Carries a city; OSM features don't. */
export const matchesFlexynGym = (q, g) => matchesQuery(q, g?.name, g?.city);

/** A live OpenStreetMap feature. `brand` is what catches chain names. */
export const matchesOsmGym = (q, g) => matchesQuery(q, g?.name, g?.brand);

/** Normalise raw input the same way everywhere. */
export const normalizeQuery = (s) => (s || '').trim().toLowerCase();
