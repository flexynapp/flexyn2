// src/lib/data/crewTrophies.js
//
// A crew's trophy shelf — migration 367. Crew-owned, and distinct from
// `user_trophies` / `src/lib/trophyDefinitions.js`, which is the per-user
// ladder system. A crew trophy is earned exactly once, by completing one
// of the pre-built generational challenges, and every challenge carries
// its own (kegan, 2026-08-16: "each challenge should be rewarded with a
// unique trophy").
//
// `title` comes back from the row rather than from the catalog on
// purpose. A trophy is a record of what the crew was told they had won,
// so retuning the catalog later must not silently rewrite one somebody
// already holds.

import { supabase } from '@/api/supabaseClient';

/** Trophies this crew has earned, newest first. */
export async function getCrewTrophies(crewId) {
  if (!crewId) return [];
  const { data, error } = await supabase.rpc('get_crew_trophies', {
    p_crew_id: crewId,
  });
  if (error) {
    console.warn('[crewTrophies] fetch failed:', error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

/**
 * How many trophies each crew has actually WON, keyed by crew id.
 *
 * `crews.trophies` is a different number and always was: it is war renown,
 * raised 30 per win by `award_crew_progress`, which is why a crew could read
 * "30 trophies" with an empty shelf. This counts rows in `crew_trophies`,
 * which is the shelf the Trophies tab renders.
 *
 * One round trip for a whole page rather than one per card. The table holds
 * at most a handful of rows per crew (a trophy is unique and earned once),
 * so counting client-side costs nothing and needs no new RPC.
 */
export async function getCrewTrophyCounts(crewIds) {
  const ids = [...new Set((crewIds || []).filter(Boolean))];
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from('crew_trophies')
    .select('crew_id')
    .in('crew_id', ids);
  if (error) {
    // 42P01 = migration 367 not applied on this host. An absent shelf is
    // zero trophies, not an error the card should render.
    if (error.code !== '42P01') console.warn('[crewTrophies] counts failed:', error);
    return {};
  }
  const out = {};
  for (const row of data || []) out[row.crew_id] = (out[row.crew_id] || 0) + 1;
  return out;
}
