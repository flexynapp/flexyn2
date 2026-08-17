// src/lib/data/crewChallenges.js
//
// CRUD wrapper around the crew_challenges table (migration 098). A
// crew sets a collective goal (target volume / sessions / xp / days
// active) with a deadline. Admin-only writes via RLS; all crew
// members can read.

import { supabase } from '@/api/supabaseClient';
import { containsProfanity } from '@/lib/profanityFilter';

export const VALID_METRICS = ['total_volume', 'total_sessions', 'total_xp', 'days_active'];

/**
 * The FREE-FORM challenges a leader composed, newest first.
 *
 * `template_key IS NULL` is load-bearing, not tidying. Migration 367 put
 * generational challenges in this same table, so without it the crew's
 * chase renders TWICE: once properly on the Trophies tab, and again here
 * on the Home tab as a generic row with no trophy, no monogram and a bare
 * progress bar. Two views of one object, and the worse one is the one a
 * member lands on first.
 */
export async function listChallengesForCrew(crewId, includeExpired = false) {
  if (!crewId) return [];
  const q = supabase
    .from('crew_challenges')
    .select('id, title, metric, target_value, current_value, starts_at, ends_at, status, created_by, created_at')
    .eq('crew_id', crewId)
    .is('template_key', null)
    .order('ends_at', { ascending: false })
    .limit(20);
  const { data, error } = includeExpired
    ? await q
    : await q.eq('status', 'active');
  if (error) {
    console.warn('[crewChallenges] list failed:', error);
    return [];
  }
  return data ?? [];
}

/**
 * Create a challenge. RLS enforces admin-only — caller MUST be a
 * crew admin for the insert to succeed.
 */
export async function createChallenge({ crewId, title, metric, targetValue, endsAt }) {
  if (!crewId || !title || !metric || !targetValue || !endsAt) {
    return { ok: false, reason: 'missing_fields' };
  }
  if (!VALID_METRICS.includes(metric)) {
    return { ok: false, reason: 'invalid_metric' };
  }
  const target = Math.round(Number(targetValue));
  if (!Number.isFinite(target) || target <= 0) {
    return { ok: false, reason: 'invalid_target' };
  }
  // Challenge titles render in the crew chat header to all members
  // — gate profanity. Mirrors crew_name + hub_posts policies.
  if (containsProfanity(title)) {
    return { ok: false, reason: 'profanity' };
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false, reason: 'unauthenticated' };

  const { data, error } = await supabase
    .from('crew_challenges')
    .insert({
      crew_id:     crewId,
      created_by:  user.id,
      title:       title.trim().slice(0, 80),
      metric,
      target_value: target,
      ends_at:     new Date(endsAt).toISOString(),
    })
    .select('id')
    .single();
  if (error) {
    console.warn('[crewChallenges] create failed:', error);
    return { ok: false, reason: error.code === '42501' ? 'not_admin' : 'db_error' };
  }

  // Fan out per-member notifications. Best-effort — the challenge
  // itself is already persisted, this is just delivery decoration.
  // Mig 104 RPC handles auth + dedup + i18n server-side.
  //
  // Defensive guard: .single() typically guarantees data is non-null
  // when error is falsy, but the optional-chained data?.id below
  // could pass undefined to the RPC if anything ever changes that
  // invariant. The RPC RAISES on null p_challenge_id; cheaper to
  // skip the call entirely than catch the server error.
  if (data?.id) {
    try {
      await supabase.rpc('notify_crew_challenge_created_for', {
        p_challenge_id: data.id,
      });
    } catch (e) {
      console.warn('[crewChallenges] notify_crew_challenge_created_for failed:', e?.message || e);
    }
  }

  return { ok: true, id: data?.id };
}

/**
 * Recompute MY contribution to every live challenge in every crew I'm in,
 * and refresh each crew aggregate from the resulting ledger.
 *
 * Deliberately argument-free. Migration 246 derives everything — identity,
 * crew membership, which challenges are live, and how much I've actually
 * put in — from auth.uid() and my own workout_logs / action_xp_ledger rows
 * inside a SECURITY DEFINER function. There is no number for a client to
 * forge because the client sends no numbers.
 *
 * This replaced updateChallengeProgress / setChallengeStatus, which wrote
 * current_value and status straight from the browser. Those were both dead
 * (zero non-test call sites, so no challenge had ever moved off 0%) and
 * forgeable (the FOR ALL admin policy let any crew admin write any value
 * and fan out the "goal smashed" push). 246 revokes UPDATE on the table
 * outright, so the old shape can't come back by accident.
 *
 * Fire-and-forget safe: returns a reason instead of throwing.
 */
export async function syncMyCrewChallengeProgress() {
  const { data, error } = await supabase.rpc('sync_my_crew_challenge_progress');
  if (error) {
    // 42883 / 42P01 = RPC not deployed yet. Nothing to fall back to —
    // a client-side recompute is exactly the forgery vector 246 closed.
    console.warn('[crewChallenges] sync failed:', error);
    return { ok: false, reason: error.code === '42501' ? 'unauthenticated' : 'db_error' };
  }
  return {
    ok: true,
    updated:   data?.updated ?? 0,
    completed: Array.isArray(data?.completed) ? data.completed : [],
  };
}

/**
 * The pre-built generational catalog for one crew, with a state per row
 * (available / active / earned / locked) — migration 367.
 *
 * Returns the LOCKED rows too, on purpose: a ladder whose next rung is
 * invisible gives a crew no reason to level up. The caller renders them
 * dimmed rather than filtering them out.
 *
 * Server-gated on crew membership, so this throws for a non-member
 * rather than leaking which rungs somebody else's crew has cleared.
 */
export async function getCrewChallengeCatalog(crewId) {
  if (!crewId) return [];
  const { data, error } = await supabase.rpc('get_crew_challenge_catalog', {
    p_crew_id: crewId,
  });
  if (error) {
    console.warn('[crewChallenges] catalog failed:', error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

/**
 * Start a generational challenge. LEADER ONLY, enforced server-side by
 * migration 367 — `crewPermissions.js` mirrors that for the UI but is
 * explicitly not the enforcement.
 *
 * There is deliberately no client-side insert path for these. The INSERT
 * policy on crew_challenges is is_crew_moderator, and a rank-2 member who
 * could set template_key from the browser would post target_value=1
 * against a template and mint the crew's trophy in one request. The guard
 * trigger nulls template_key on every client insert, so this RPC is the
 * only door.
 */
export async function startGenerationalChallenge(crewId, templateKey) {
  if (!crewId || !templateKey) return { ok: false, reason: 'missing_fields' };
  const { data, error } = await supabase.rpc('start_crew_generational_challenge', {
    p_crew_id:      crewId,
    p_template_key: templateKey,
  });
  if (error) {
    console.warn('[crewChallenges] start failed:', error);
    // 42501 covers both "not a leader" and "crew level too low"; the
    // message distinguishes them and the UI already knows the level.
    const reason =
      error.code === '23505' ? 'already_chasing'
      : error.code === '42501' ? 'not_allowed'
      : error.code === '22023' ? 'no_such_challenge'
      : 'db_error';
    return { ok: false, reason };
  }
  return { ok: true, id: data };
}

/**
 * Per-member contribution breakdown for one challenge, richest first.
 *
 * Server-gated on the caller's own crew membership, and returns display
 * names in the same round trip so the UI doesn't have to join profiles.
 */
export async function getChallengeContributions(challengeId) {
  if (!challengeId) return [];
  const { data, error } = await supabase.rpc('get_crew_challenge_contributions', {
    p_challenge_id: challengeId,
  });
  if (error) {
    console.warn('[crewChallenges] contributions failed:', error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}
