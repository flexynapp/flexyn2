// src/lib/data/crewChallenges.js
//
// CRUD wrapper around the crew_challenges table (migration 098). A
// crew sets a collective goal (target volume / sessions / xp / days
// active) with a deadline. Admin-only writes via RLS; all crew
// members can read.

import { supabase } from '@/api/supabaseClient';
import { containsProfanity } from '@/lib/profanityFilter';

export const VALID_METRICS = ['total_volume', 'total_sessions', 'total_xp', 'days_active'];

/** List active challenges for a crew, newest first. */
export async function listChallengesForCrew(crewId, includeExpired = false) {
  if (!crewId) return [];
  const q = supabase
    .from('crew_challenges')
    .select('id, title, metric, target_value, current_value, starts_at, ends_at, status, created_by, created_at')
    .eq('crew_id', crewId)
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
  // Mig 103 RPC handles auth + dedup + i18n server-side.
  try {
    await supabase.rpc('notify_crew_challenge_created_for', {
      p_challenge_id: data?.id,
    });
  } catch (e) {
    console.warn('[crewChallenges] notify_crew_challenge_created_for failed:', e?.message || e);
  }

  return { ok: true, id: data?.id };
}

/** Update a challenge's progress (admin-only via RLS). */
export async function updateChallengeProgress(id, currentValue) {
  if (!id) return { ok: false, reason: 'no_id' };
  const { error } = await supabase
    .from('crew_challenges')
    .update({ current_value: Math.max(0, Math.round(currentValue || 0)) })
    .eq('id', id);
  if (error) return { ok: false, reason: 'db_error' };
  return { ok: true };
}

/** Mark a challenge completed or expired. */
export async function setChallengeStatus(id, status) {
  if (!id || !['active', 'completed', 'expired'].includes(status)) {
    return { ok: false, reason: 'invalid' };
  }
  const { error } = await supabase
    .from('crew_challenges')
    .update({ status })
    .eq('id', id);
  if (error) return { ok: false, reason: 'db_error' };

  // Fan out a per-member celebration push when the challenge just
  // hit its goal. Expiry is intentionally silent — a "you missed
  // your goal" push reads as scolding. Mig 103 RPC checks the
  // status server-side and no-ops if not 'completed', so a benign
  // double-call (e.g. expired then completed) doesn't push twice.
  if (status === 'completed') {
    try {
      await supabase.rpc('notify_crew_challenge_completed_for', {
        p_challenge_id: id,
      });
    } catch (e) {
      console.warn('[crewChallenges] notify_crew_challenge_completed_for failed:', e?.message || e);
    }
  }

  return { ok: true };
}
