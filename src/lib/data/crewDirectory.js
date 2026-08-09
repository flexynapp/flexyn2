// src/lib/data/crewDirectory.js
//
// The public Crews directory and the global Top board — the read side of
// migration 308.
//
// Both are RPCs rather than client queries, and they have to be. crew_members
// SELECT is is_crew_member(crew_id) (mig 048), so the browser can read the
// roster of a crew it belongs to and no other — a member count for a crew you
// are not in is simply not reachable from here. Combined volume has the same
// problem one table further out. CrewDiscovery spent months branching on a
// `_memberCount` that nothing could ever set.
//
// There is no write function in this module because there is no client write
// path: rank, member count and combined volume are all server-derived, and a
// client-computed ranking would be both wrong and forgeable.
//
// Both functions swallow 42883 / 42P01 (RPC not deployed) and return the empty
// shape, so the Crews tab degrades to its empty state during the window
// between the Netlify deploy and the SQL being applied rather than erroring
// the whole surface. Same posture as getSuggestedCrews in crews.js.

import { supabase } from '@/api/supabaseClient';

/** RPC missing on this host — pre-308. Not an error worth reporting. */
function isNotDeployed(error) {
  return error?.code === '42883' || error?.code === '42P01';
}

export const CREW_SORTS   = ['volume', 'members', 'level', 'new'];
export const CREW_METRICS = ['volume', 'trophies', 'points'];

/**
 * One page of public crews.
 *
 * Each row: { id, name, tag, description, avatar_url, member_count,
 * max_capacity, total_volume_lbs, crew_level, trophies, wars_won, wars_lost,
 * is_member }.
 *
 * The caller's own crew is NOT excluded — it comes back flagged with
 * `is_member` so the row can be styled and its action swapped. Seeing your
 * crew among the others is the point of a directory.
 */
export async function listPublicCrews({ query = '', sort = 'volume', limit = 20, offset = 0 } = {}) {
  const { data, error } = await supabase.rpc('get_public_crews', {
    p_query:  query || null,
    p_sort:   CREW_SORTS.includes(sort) ? sort : 'volume',
    p_limit:  limit,
    p_offset: offset,
  });

  if (error) {
    if (!isNotDeployed(error)) console.warn('[crewDirectory] listPublicCrews failed:', error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

const EMPTY_BOARD = { metric: 'volume', myRank: null, total: 0, rows: [] };

/**
 * The global Top board.
 *
 * Returns { metric, myRank, total, rows }, where rows carry a server-computed
 * `rank` and are the top N PLUS a window around the caller's own crew when it
 * ranks below N. Ranks are therefore NOT contiguous, and that is deliberate:
 * the gap is where the client draws its ellipsis.
 *
 * Never derive rank from the array index — a filtered list would renumber
 * itself, and rank is the one number on this screen that has to be true.
 */
export async function getTopCrews({ metric = 'volume', limit = 25 } = {}) {
  const { data, error } = await supabase.rpc('get_top_crews', {
    p_metric: CREW_METRICS.includes(metric) ? metric : 'volume',
    p_limit:  limit,
  });

  if (error) {
    if (!isNotDeployed(error)) console.warn('[crewDirectory] getTopCrews failed:', error);
    return EMPTY_BOARD;
  }

  return {
    metric: data?.metric ?? metric,
    myRank: data?.my_rank ?? null,
    total:  data?.total ?? 0,
    rows:   Array.isArray(data?.rows) ? data.rows : [],
  };
}

/**
 * Which action a directory row should offer.
 *
 * Four states, and the control SWAPS rather than greying out — a disabled
 * button is a dead end, a swapped one is information (Habitica's
 * publicGuildItem.vue does the same). `requested` is tracked by the caller
 * for the session: migration 250 queues a join on a private crew instead of
 * seating you, and claiming "you joined" then showing no crew reads as a bug.
 */
export function joinStateFor(crew, { inACrew = false, requested = false } = {}) {
  if (crew?.is_member) return 'member';
  if (requested)       return 'requested';
  const count = Number(crew?.member_count ?? 0);
  const cap   = Number(crew?.max_capacity ?? 16);
  if (Number.isFinite(count) && Number.isFinite(cap) && count >= cap) return 'full';
  if (inACrew) return 'blocked';
  return 'join';
}
