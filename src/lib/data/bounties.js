// src/lib/data/bounties.js
// Bounty System — auto-generated AND user-created social challenges
// with Flex Coin rewards.

import { supabase } from '@/api/supabaseClient';
import { reportError } from '@/lib/reportError';
import { formatNumber } from '@/lib/intl';
import { containsProfanity } from '@/lib/profanityFilter';

/**
 * Create a user-posted bounty on YOUR OWN record (migration 098).
 * Server-side validates caller == target (anti-griefing — you
 * can't post a bounty on someone else's record).
 *
 * Returns { ok: true, id } on success, { ok: false, reason } on failure.
 */
export async function createUserBounty({ metric, exerciseName, targetValue, difficulty, expiresAt } = {}) {
  if (!metric)                          return { ok: false, reason: 'metric_required' };
  if (!targetValue || targetValue <= 0) return { ok: false, reason: 'invalid_target' };
  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    return { ok: false, reason: 'invalid_difficulty' };
  }
  // Bounty exercise names appear on the public bounty board — gate
  // profanity so users can't broadcast slurs through the bounty
  // surface. Mirrors hub_posts + crew_name + highlight policies.
  if (exerciseName && containsProfanity(exerciseName)) {
    return { ok: false, reason: 'profanity' };
  }
  const expIso = (() => {
    if (!expiresAt) return null;
    try {
      const d = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    } catch { return null; }
  })();

  try {
    const { data, error } = await supabase.rpc('create_user_bounty', {
      p_metric:        metric,
      p_exercise_name: exerciseName || null,
      p_target_value:  targetValue,
      p_difficulty:    difficulty,
      p_expires_at:    expIso,
    });
    if (error) {
      if (error.code === '42883' || error.code === '42P01') {
        return { ok: false, reason: 'rpc_missing' };
      }
      console.warn('[bounties] create_user_bounty failed:', error);
      return { ok: false, reason: 'db_error' };
    }
    return { ok: true, id: data };
  } catch (err) {
    console.warn('[bounties] createUserBounty threw:', err?.message || err);
    return { ok: false, reason: 'network' };
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const DIFFICULTY_CONFIG = {
  easy:   { entry_fee: 10, reward: 60,  net: 50,  hours: 48, label: 'Easy',   color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  medium: { entry_fee: 15, reward: 100, net: 85,  hours: 48, label: 'Medium', color: 'text-amber-500',   bg: 'bg-amber-500/10'   },
  hard:   { entry_fee: 20, reward: 175, net: 155, hours: 72, label: 'Hard',   color: 'text-rose-500',    bg: 'bg-rose-500/10'    },
};

export const METRIC_LABEL = {
  single_lift_weight: 'Max weight on',
  single_lift_reps:   'Max reps on',
  weekly_volume:      'Weekly volume',
  session_volume:     'Session volume',
};

/**
 * Human-readable bounty description for a given row.
 * Accepts an optional `language` (ISO 639-1) so the target value renders
 * in the user's locale instead of the browser's. Callers in React land
 * pass `useLanguage().language`; legacy callers omit it and fall back to
 * 'en' formatting (still better than uncontrolled browser locale).
 */
export function bountyDescription(bounty, language, weightUnit = 'lbs') {
  const metric = METRIC_LABEL[bounty.metric] || bounty.metric;
  // For weight-based metrics, convert the stored lbs target to the
  // caller's unit so kg users don't see "beat 315 lbs" everywhere.
  // Rep-based metrics ignore unit. (Audit 17 #F30.)
  const isWeightMetric = bounty.metric === 'single_lift_weight' || bounty.metric === 'weekly_volume';
  const isRepsMetric   = bounty.metric === 'single_lift_reps';
  let target;
  let unitLabel = '';
  if (isWeightMetric) {
    const factor = weightUnit === 'kg' ? 1 / 2.20462 : weightUnit === 'stone' ? 1 / 14 : 1;
    target = formatNumber(Math.round((bounty.target_value || 0) * factor), language);
    unitLabel = weightUnit;
  } else if (isRepsMetric) {
    target = formatNumber(Math.round(bounty.target_value), language);
    unitLabel = 'reps';
  } else {
    target = formatNumber(Math.round(bounty.target_value), language);
    unitLabel = weightUnit;
  }
  if (bounty.exercise_name) {
    return `${metric} ${bounty.exercise_name} — beat ${target} ${unitLabel}`;
  }
  return `${metric} — beat ${target} ${unitLabel}`;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * All active bounties the current user can potentially claim.
 * Excludes expired, excludes bounties targeting the current user.
 */
export async function listActiveBounties() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('bounties')
    .select('*')
    .gt('expires_at', new Date().toISOString())
    .neq('target_user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(30);

  return error ? [] : (data ?? []);
}

/** Current user's active bounty claim (there can be at most one). */
export async function getMyActiveClaim() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('bounty_claims')
    .select('*, bounties(*)')
    .eq('claimant_id', user.id)
    .eq('status', 'active')
    .order('claimed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return error ? null : data;
}

/** Full claim history for the current user. */
export async function getMyClaims(limit = 20) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('bounty_claims')
    .select('*, bounties(*)')
    .eq('claimant_id', user.id)
    .order('claimed_at', { ascending: false })
    .limit(limit);

  return error ? [] : (data ?? []);
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Claim a bounty — calls the claim_bounty RPC, then fires a
 * notification to the target user so they know their record is
 * under attack. Notification fan-out is fire-and-forget — the claim
 * itself is the canonical event, the notification is supplementary.
 *
 * Throws with structured message on failure.
 */
export async function claimBounty(bountyId) {
  const { data, error } = await supabase.rpc('claim_bounty', { p_bounty_id: bountyId });
  if (error) throw error;
  // Notify the target user. notify_bounty_claim_for validates we are
  // the actual claimant on the bounty row; if the migration 069 RPC
  // isn't deployed yet, the claim itself still succeeded.
  try {
    await supabase.rpc('notify_bounty_claim_for', { p_bounty_id: bountyId });
  } catch (e) {
    if (e?.code !== '42883' && e?.code !== '42P01') {
      console.warn('[bounties] notify_bounty_claim_for failed:', e?.message || e);
    }
  }
  return data; // claim UUID
}

/**
 * Complete a bounty claim — calls complete_bounty_claim RPC, then
 * fires a notification to the target user so they know their record
 * fell.
 * @param {string} claimId
 * @param {string|null} workoutLogId  — the log that completed it
 * @param {string|null} bountyId      — for the post-completion notify
 */
export async function completeBountyClaim(claimId, workoutLogId = null, bountyId = null) {
  const { error } = await supabase.rpc('complete_bounty_claim', {
    p_claim_id:       claimId,
    p_workout_log_id: workoutLogId ?? null,
  });
  if (error) throw error;
  // Notify the target user. The RPC validates we were the claimant.
  if (bountyId) {
    try {
      await supabase.rpc('notify_bounty_beaten_for', { p_bounty_id: bountyId });
    } catch (e) {
      if (e?.code !== '42883' && e?.code !== '42P01') {
        console.warn('[bounties] notify_bounty_beaten_for failed:', e?.message || e);
      }
    }
  }
}

/**
 * Client-side completion check — call after every workout save.
 * Compares the log's volume/weight against the active bounty target.
 * Returns true if the bounty was completed (and the RPC was called).
 */
export async function checkAndCompleteBounty(workoutLog) {
  try {
    const claim = await getMyActiveClaim();
    if (!claim || !claim.bounties) return false;

    const bounty = claim.bounties;
    const { metric, target_value, exercise_name } = bounty;

    let achieved = null;

    if (metric === 'session_volume' || metric === 'weekly_volume') {
      // Volume = sum of weight × reps across all sets in the log
      let vol = 0;
      for (const ex of workoutLog.exercises || []) {
        for (const s of ex.sets || []) {
          vol += (Number(s.weight) || 0) * (Number(s.reps) || 0);
        }
      }
      achieved = vol;
    } else if (metric === 'single_lift_weight' && exercise_name) {
      // Max weight on a specific exercise
      for (const ex of workoutLog.exercises || []) {
        if (ex.name?.toLowerCase() === exercise_name.toLowerCase()) {
          for (const s of ex.sets || []) {
            if ((Number(s.weight) || 0) > (achieved ?? 0)) achieved = Number(s.weight);
          }
        }
      }
    } else if (metric === 'single_lift_reps' && exercise_name) {
      // Max reps on a specific exercise
      for (const ex of workoutLog.exercises || []) {
        if (ex.name?.toLowerCase() === exercise_name.toLowerCase()) {
          for (const s of ex.sets || []) {
            if ((Number(s.reps) || 0) > (achieved ?? 0)) achieved = Number(s.reps);
          }
        }
      }
    }

    // Use >= so HITTING the target counts as completion. The previous
    // `> target_value` strict comparison meant a bounty of "beat 315"
    // failed when the user lifted exactly 315 — they'd done the work
    // but got no credit. (Audit 15 #H3.)
    if (achieved === null || achieved < target_value) return false;

    await completeBountyClaim(claim.id, workoutLog?.id ?? null, bounty?.id ?? null);
    return true;
  } catch (err) {
    // Previously `catch { return false; }` — every failure silently
    // suppressed. The caller (workout save flow) takes a `true` return
    // as the cue to fire the celebration toast. A swallowed `false` means
    // bounties broke silently for users hitting the catch path and we
    // never knew. Report so the failure pattern is visible; still return
    // false so the workout save itself doesn't break.
    reportError(err, {
      feature: 'bounties.checkAndCompleteBounty',
      level: 'warning',
      workoutLogId: workoutLog?.id,
    });
    return false;
  }
}

// ── Generation (beta / client-side) ──────────────────────────────────────────

/**
 * Generate sample bounties for beta testing.
 * Production: this logic runs server-side in the daily Edge Function cron.
 * Here it creates 2-3 bounties based on the user's social graph with
 * realistic-looking targets so the claim/complete flow can be tested.
 */
export async function generateDemoBounties() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Fetch own profile to get email for hub_follows lookup
  const { data: myProfile } = await supabase
    .from('user_profiles')
    .select('email, total_xp')
    .eq('id', user.id)
    .single();

  if (!myProfile) throw new Error('Profile not found');

  // Get followed users via email column
  const { data: follows } = await supabase
    .from('hub_follows')
    .select('followee_email')
    .eq('follower_email', myProfile.email)
    .limit(10);

  let targetProfiles = [];

  if (follows?.length) {
    const emails = follows.map(f => f.followee_email);
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, username, avatar_url, total_xp')
      .in('email', emails)
      .not('username', 'is', null)
      .limit(5);
    targetProfiles = profiles ?? [];
  }

  // Fallback: random users if not following anyone
  if (!targetProfiles.length) {
    const { data: randoms } = await supabase
      .from('user_profiles')
      .select('id, username, avatar_url, total_xp')
      .neq('id', user.id)
      .not('username', 'is', null)
      .limit(5);
    targetProfiles = randoms ?? [];
  }

  if (!targetProfiles.length) throw new Error('No users to target');

  // Templates: mix of volume and lift bounties
  const templates = [
    { metric: 'weekly_volume',       exercise_name: null,        difficulty: 'medium', scale: 50000 },
    { metric: 'session_volume',      exercise_name: null,        difficulty: 'easy',   scale: 15000 },
    { metric: 'single_lift_weight',  exercise_name: 'Bench Press', difficulty: 'hard', scale: 225   },
    { metric: 'weekly_volume',       exercise_name: null,        difficulty: 'hard',   scale: 80000 },
    { metric: 'single_lift_weight',  exercise_name: 'Squat',     difficulty: 'medium', scale: 185   },
  ];

  const rows = [];
  const usedTargetIds = new Set();

  for (const tmpl of templates.slice(0, 3)) {
    // Pick an unused target
    const available = targetProfiles.filter(p => !usedTargetIds.has(p.id));
    if (!available.length) break;
    const target = available[Math.floor(Math.random() * available.length)];
    usedTargetIds.add(target.id);

    const cfg = DIFFICULTY_CONFIG[tmpl.difficulty];
    // Add ±10% jitter to target value
    const jitter = 0.9 + Math.random() * 0.2;
    const target_value = Math.round(tmpl.scale * jitter);

    rows.push({
      target_user_id:    target.id,
      target_username:   target.username,
      target_avatar_url: target.avatar_url ?? null,
      metric:            tmpl.metric,
      exercise_name:     tmpl.exercise_name,
      target_value,
      difficulty:        tmpl.difficulty,
      entry_fee:         cfg.entry_fee,
      reward:            cfg.reward,
      expires_at:        new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  if (!rows.length) throw new Error('Could not build any bounties');

  const { data, error } = await supabase
    .from('bounties')
    .insert(rows)
    .select();

  if (error) throw error;
  return data ?? [];
}
