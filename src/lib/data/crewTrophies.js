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
