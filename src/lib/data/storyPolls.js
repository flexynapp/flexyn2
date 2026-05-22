// src/lib/data/storyPolls.js
//
// Client wrappers for story-poll voting (migration 112). The poll
// itself is shaped as an overlay on stories.overlays (mig 111):
//
//   { kind: 'poll', question, options: [{ id, label }], x, y }
//
// This module covers the dynamic side — casting a vote and reading
// aggregate counts. RLS lets everyone SELECT poll vote rows so the
// "63% / 37%" results display works for viewers AND owners.

import { supabase } from '@/api/supabaseClient';

/**
 * Cast a vote on a story poll. Upserts so the user can change their
 * mind by tapping a different option; (story_id, voter_id) PK keeps
 * the count correct under concurrent retries.
 */
export async function castVote(storyId, optionId) {
  if (!storyId || !optionId) throw new Error('storyId + optionId required');
  const { error } = await supabase.rpc('cast_story_poll_vote', {
    p_story_id:  storyId,
    p_option_id: optionId,
  });
  if (error) throw error;
}

/**
 * Read the current per-option vote counts. Returns a Map keyed by
 * option_id with the total tally; missing options return 0 implicitly.
 *
 * Pre-112 host (RPC missing): returns an empty Map so the viewer
 * gracefully shows "0%" bars rather than blowing up.
 */
export async function getResults(storyId) {
  if (!storyId) return new Map();
  const { data, error } = await supabase.rpc('story_poll_results', {
    p_story_id: storyId,
  });
  if (error) {
    if (error.code === '42883' || error.code === '42P01') return new Map();
    return new Map();
  }
  const m = new Map();
  for (const row of data || []) {
    m.set(row.option_id, Number(row.vote_count) || 0);
  }
  return m;
}

/**
 * Fetch the current viewer's vote for a single story (if any). Used
 * to show "you voted X" state without a second roundtrip.
 */
export async function getMyVote(storyId, userId) {
  if (!storyId || !userId) return null;
  const { data, error } = await supabase
    .from('story_poll_votes')
    .select('option_id')
    .eq('story_id', storyId)
    .eq('voter_id', userId)
    .maybeSingle();
  if (error) return null;
  return data?.option_id || null;
}
