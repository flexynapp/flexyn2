// src/lib/data/soloChallenges.js
//
// Solo Challenges data layer — backed by public.solo_challenges and
// public.solo_challenge_claims (migration 171).
//
// Solo challenges are non-targeted bounties ("Lift 5,000 lbs this
// week"), in contrast with the existing user-targeted bounties on
// public.bounties ("Beat @kegan's bench PR"). Both surfaces render
// on the Bounties page side-by-side.
//
// Lifecycle:
//   1. listActiveSoloChallenges() — board view
//   2. listMyClaims()              — user's claim row, one per challenge
//   3. claimSoloChallenge(id)      — atomic claim via RPC
//   4. recordWorkoutProgress(...)  — bump progress on each saved workout
//   5. completeSoloChallenge(id)   — server-gated reward credit
//
// TODO: weekly seed — currently relies on the inline INSERT in
// migration 171. Either land a pg_cron job that re-seeds each
// Sunday at 00:00 UTC, or add an admin "Seed weekly" button in the
// admin panel. Both are follow-ups; the inline seed gives us one
// week's worth out of the box.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { reportError } from '@/lib/reportError';

/**
 * All active solo challenges that haven't yet expired. Sorted
 * easy→hard so the lightest commitment is visually first.
 */
export async function listActiveSoloChallenges() {
  const { data, error } = await safeSelect({
    columns: ['id', 'kind', 'title', 'description', 'target_value', 'target_unit', 'difficulty', 'reward_coins', 'expires_at'],
    build: (cols) => supabase
      .from('solo_challenges')
      .select(cols)
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .order('difficulty', { ascending: true })
      .order('reward_coins', { ascending: true }),
  });
  if (error) {
    // Pre-migration-171 host — table doesn't exist. Return empty so
    // the UI degrades to "no solo challenges yet" instead of throwing.
    if (error.code === '42P01') return [];
    return [];
  }
  return data ?? [];
}

/** All of the current user's claim rows (active + completed). */
export async function listMyClaims() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return [];
  const { data, error } = await safeSelect({
    columns: ['id', 'challenge_id', 'status', 'progress', 'claimed_at', 'completed_at'],
    build: (cols) => supabase
      .from('solo_challenge_claims')
      .select(cols)
      .eq('user_id', user.id)
      .order('claimed_at', { ascending: false }),
  });
  if (error?.code === '42P01') return [];
  return error ? [] : (data ?? []);
}

/**
 * Atomic claim. Idempotent — the RPC returns the same claim_id if the
 * caller already had an active claim on this challenge.
 */
export async function claimSoloChallenge(challengeId) {
  const { data, error } = await supabase.rpc('claim_solo_challenge', {
    p_challenge_id: challengeId,
  });
  if (error) {
    if (error.code === '42883' || error.code === '42P01') {
      return { ok: false, reason: 'rpc_missing' };
    }
    reportError(error, { feature: 'soloChallenges.claim', level: 'warning' });
    return { ok: false, reason: error.message || 'db_error' };
  }
  return { ok: true, claimId: data };
}

/**
 * Server-gated completion. Returns the new coin balance + reward
 * granted, or marks the call as a no-op if already completed.
 */
export async function completeSoloChallenge(claimId) {
  const { data, error } = await supabase.rpc('complete_solo_challenge', {
    p_claim_id: claimId,
  });
  if (error) {
    if (error.code === '42883' || error.code === '42P01') {
      return { ok: false, reason: 'rpc_missing' };
    }
    reportError(error, { feature: 'soloChallenges.complete', level: 'warning' });
    return { ok: false, reason: error.message || 'db_error' };
  }
  return { ok: true, ...data };
}

/**
 * Bump progress on every ACTIVE claim the user holds, in one round-
 * trip. Call this from the workout-save flow with the saved
 * workout's volume / session count / cardio minutes / PR count.
 *
 * Idempotent: progress is capped at target_value server-side, so
 * a retry from a network blip can't push a claim past 100%.
 */
export async function recordWorkoutProgress({
  volumeLbs    = 0,
  sessionCount = 0,
  cardioMin    = 0,
  prsHit       = 0,
} = {}) {
  if (!volumeLbs && !sessionCount && !cardioMin && !prsHit) return { ok: true, claimsUpdated: 0 };
  const { data, error } = await supabase.rpc('update_solo_challenge_progress', {
    p_volume_lbs:    volumeLbs,
    p_session_count: sessionCount,
    p_cardio_min:    cardioMin,
    p_prs_hit:       prsHit,
  });
  if (error) {
    if (error.code === '42883' || error.code === '42P01') {
      // Pre-mig host — silently skip; the rest of the workout save still works.
      return { ok: false, reason: 'rpc_missing' };
    }
    reportError(error, { feature: 'soloChallenges.recordProgress', level: 'warning' });
    return { ok: false, reason: error.message || 'db_error' };
  }
  return { ok: true, claimsUpdated: data?.claims_updated ?? 0 };
}

/** Difficulty → presentation tokens. Kept here so callers don't
 *  duplicate the mapping (mirrors bounties.DIFFICULTY_CONFIG shape). */
export const SOLO_DIFFICULTY = {
  easy:   { label: 'Easy',   color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  medium: { label: 'Medium', color: 'text-amber-500',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30'   },
  hard:   { label: 'Hard',   color: 'text-rose-500',    bg: 'bg-rose-500/10',    border: 'border-rose-500/30'    },
};
