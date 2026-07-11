// src/lib/data/gauntlet.js
// Gauntlet Path + Weekly Community Gauntlet data layer.
import { supabase } from '@/api/supabaseClient';
import { format, differenceInCalendarDays, startOfWeek } from 'date-fns';
import { detectPRsInWorkout } from '@/lib/data/personalRecords';

// ── Challenge catalogue ───────────────────────────────────────────────────────

/** Fetch all 10 path challenges ordered by sequence. */
export async function getGauntletChallenges() {
  const { data, error } = await supabase
    .from('gauntlet_challenges')
    .select('*')
    .order('sequence_number', { ascending: true });
  if (error) throw error;
  return data;
}

// ── Personal progress ─────────────────────────────────────────────────────────

/** Get (or implicitly create via the RPC) the signed-in user's progress row. */
export async function getMyProgress() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('user_gauntlet_progress')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data; // null = never started (seq defaults to 1 on first RPC call)
}

/** IDs of all challenges this user has already completed. */
export async function getMyCompletions() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('user_gauntlet_completions')
    .select('challenge_id, sequence_number, completed_at, score')
    .eq('user_id', user.id)
    .order('sequence_number', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ── Complete a path challenge (SECURITY DEFINER RPC) ─────────────────────────

/**
 * Mark challenge `sequenceNumber` as completed.
 * Returns { challenge_id, challenge_title, next_sequence, xp_awarded,
 *           coins_awarded, path_completed }
 */
export async function completeGauntletChallenge(sequenceNumber, workoutLogId = null, score = null) {
  const { data, error } = await supabase.rpc('complete_gauntlet_challenge', {
    p_sequence_number: sequenceNumber,
    p_workout_log_id:  workoutLogId,
    p_score:           score,
  });
  if (error) throw error;

  // Self-targeted notification on PATH completion (the milestone moment).
  // Individual challenges already get a stats modal client-side; the
  // notification is for the broader "you finished the whole Gauntlet"
  // event so the user sees it in the bell tray later too.
  if (data?.path_completed) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('notifications').insert({
          user_id:    user.id,
          user_email: user.email,
          type:       'gauntlet_path_completed',
          title:      '🏆 Gauntlet complete!',
          body:       'You finished the 10-challenge path. New season begins next week.',
          icon:       '🏆',
          link_url:   '/gauntlet',
          metadata:   { final_challenge_id: data.challenge_id, xp_awarded: data.xp_awarded },
        });
      }
    } catch (e) {
      console.warn('[gauntlet] path-complete notification failed:', e?.message || e);
    }
  }

  return data;
}

// ── Global stats for a specific challenge ────────────────────────────────────

/**
 * Returns { total_attempts, completions, completion_rate_pct, user_rank }
 * for the given sequence number. Used on the completion stats modal.
 */
export async function getGauntletStats(sequenceNumber) {
  // Total users who have ever reached or passed this challenge
  const { count: totalUsers, error: e1 } = await supabase
    .from('user_gauntlet_progress')
    .select('*', { count: 'exact', head: true });
  if (e1) throw e1;

  // How many completed this specific sequence
  const { count: completions, error: e2 } = await supabase
    .from('user_gauntlet_completions')
    .select('*', { count: 'exact', head: true })
    .eq('sequence_number', sequenceNumber);
  if (e2) throw e2;

  const total = totalUsers ?? 1;
  const done  = completions ?? 0;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

  return {
    total_attempts:       total,
    completions:          done,
    completion_rate_pct:  pct,
  };
}

// ── Weekly Community Gauntlet ─────────────────────────────────────────────────

/** Fetch the currently active (or most-recent) community gauntlet. */
export async function getActiveCommunityGauntlet() {
  const { data, error } = await supabase
    .from('weekly_gauntlets')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Get the signed-in user's attempt record for a given gauntlet. */
export async function getCommunityGauntletAttempt(gauntletId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('weekly_gauntlet_attempts')
    .select('*')
    .eq('gauntlet_id', gauntletId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Start a weekly gauntlet attempt (or return existing row).
 * Returns the attempt record.
 */
export async function startCommunityGauntletAttempt(gauntletId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not_authenticated');

  const { data, error } = await supabase
    .from('weekly_gauntlet_attempts')
    .upsert(
      { gauntlet_id: gauntletId, user_id: user.id, status: 'in_progress' },
      { onConflict: 'gauntlet_id,user_id', ignoreDuplicates: true }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Complete a weekly gauntlet attempt with a score.
 * Increments the gauntlet's completion_count if score >= passing_threshold.
 */
export async function completeCommunityGauntletAttempt(gauntletId, score, workoutLogId = null) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not_authenticated');

  // Fetch the gauntlet to check threshold
  const { data: gauntlet, error: ge } = await supabase
    .from('weekly_gauntlets')
    .select('passing_threshold, attempt_count, completion_count')
    .eq('id', gauntletId)
    .single();
  if (ge) throw ge;

  const passed = score >= gauntlet.passing_threshold;

  // Update the attempt
  const { data: attempt, error: ae } = await supabase
    .from('weekly_gauntlet_attempts')
    .update({
      status:         passed ? 'completed' : 'failed',
      score,
      completed_at:   new Date().toISOString(),
      workout_log_id: workoutLogId,
    })
    .eq('gauntlet_id', gauntletId)
    .eq('user_id', user.id)
    .select()
    .single();
  if (ae) throw ae;

  // Increment counts on the parent gauntlet. Non-blocking: an RLS deny or
  // network blip on the counter bump shouldn't drop the attempt row that
  // just succeeded — but silent failures will skew the leaderboard, so
  // surface them via the reportError pipeline rather than swallowing.
  const { error: counterErr } = await supabase
    .from('weekly_gauntlets')
    .update({
      attempt_count:    (gauntlet.attempt_count ?? 0) + 1,
      completion_count: passed ? (gauntlet.completion_count ?? 0) + 1 : gauntlet.completion_count,
    })
    .eq('id', gauntletId);
  if (counterErr) {
    // Lazy import to avoid a circular dep — reportError pulls Sentry which
    // pulls things that pull this module on hot reload in dev.
    import('@/lib/reportError').then(({ reportError }) => {
      reportError(counterErr, { feature: 'gauntlet.weekly-counter-bump', level: 'warning' });
    }).catch(() => { /* reporter unavailable — best-effort */ });
  }

  return attempt;
}

/**
 * Global stats for the weekly gauntlet after a user completes it.
 * Returns { attempt_count, completion_count, completion_pct, user_rank }
 */
export async function getWeeklyGauntletStats(gauntletId, userScore) {
  const { data: gauntlet, error: ge } = await supabase
    .from('weekly_gauntlets')
    .select('attempt_count, completion_count')
    .eq('id', gauntletId)
    .single();
  if (ge) throw ge;

  const attempts    = gauntlet?.attempt_count    ?? 1;
  const completions = gauntlet?.completion_count ?? 1;
  const pct         = Math.round((completions / Math.max(attempts, 1)) * 100);

  // How many finished with a higher score than the user?
  let rank = null;
  if (userScore != null) {
    const { count, error: re } = await supabase
      .from('weekly_gauntlet_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('gauntlet_id', gauntletId)
      .eq('status', 'completed')
      .gt('score', userScore);
    if (!re) rank = (count ?? 0) + 1;
  }

  return { attempt_count: attempts, completion_count: completions, completion_pct: pct, user_rank: rank };
}

// ── Path challenge detection (all 10) ────────────────────────────────────────
//
// The completion RPC (complete_gauntlet_challenge, 060_gauntlet.sql) is
// client-authoritative: it guards auth + sequence-order + already-completed,
// but TRUSTS that the challenge's metric/target were actually met. So
// detection lives here on the client. Rewards are one-time (UNIQUE
// constraint), bounded (150–1500 XP), and the XP rate-limit ledger (mig
// 188, 50k/24h) caps abuse — an acceptable trade-off that mirrors the
// original First-Blood-only detector. A follow-up could push criteria
// validation into the RPC to make it server-authoritative.
//
// Originally only Challenge 1 ("First Blood") had a detector, which stranded
// every user on Challenge 2 forever. evaluateChallengeCriteria below covers
// all six metric types the seed uses.

// Total lb-volume of one session: Σ reps × weight across every set.
function sessionVolume(log) {
  let v = 0;
  for (const ex of log?.exercises ?? []) {
    for (const s of ex?.sets ?? []) v += (Number(s.reps) || 0) * (Number(s.weight) || 0);
  }
  return v;
}

// Parse a log's 'yyyy-MM-dd' date to a LOCAL Date (midnight). Falls back to
// created_at, then today — parsed component-wise to avoid the UTC-midnight
// off-by-one that `new Date('yyyy-MM-dd')` introduces in negative offsets.
function logLocalDate(log, todayStr) {
  const raw = (log?.date || log?.created_at || todayStr || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(log?.created_at ?? NaN);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

// Distinct calendar DAYS with a workout in the trailing `days`-day window
// ending today (inclusive). Counting days (not raw entries) stops a user
// trivially clearing a "N sessions" gate by logging N junk sessions in one
// day, and matches the streak spirit of these challenges.
function distinctDaysInTrailingWindow(logs, days, todayStr) {
  const today = logLocalDate({ date: todayStr }, todayStr);
  const seen = new Set();
  for (const log of logs ?? []) {
    const d = logLocalDate(log, todayStr);
    const diff = differenceInCalendarDays(today, d);
    if (diff >= 0 && diff < days) seen.add(format(d, 'yyyy-MM-dd'));
  }
  return seen.size;
}

// Cumulative volume across every session in the current Monday-start
// calendar week — matches the server's date_trunc('week') convention.
function currentWeekVolume(logs, todayStr) {
  const weekStart = startOfWeek(logLocalDate({ date: todayStr }, todayStr), { weekStartsOn: 1 });
  let v = 0;
  for (const log of logs ?? []) {
    if (logLocalDate(log, todayStr) >= weekStart) v += sessionVolume(log);
  }
  return v;
}

// Movement-name substrings that count as a "compound lift" for the PR
// challenge (challenge 9). Deliberately broad so "Barbell Back Squat",
// "Romanian Deadlift", "Overhead Press" all match.
const COMPOUND_PATTERNS = [
  'squat', 'deadlift', 'bench', 'overhead press', 'ohp', 'military press',
  'shoulder press', 'push press', 'row', 'pull up', 'pull-up', 'pullup',
  'chin up', 'chin-up', 'chinup', 'dip', 'clean', 'snatch', 'jerk',
  'thruster', 'hip thrust', 'leg press', 'lunge',
];
function isCompoundName(name) {
  const n = (name || '').toLowerCase();
  return COMPOUND_PATTERNS.some((p) => n.includes(p));
}

// "N exercises, zero skipped sets" — a skipped set is one with no reps, or
// (for non-cardio) no real weight. Cardio is exempt from the weight check:
// cardio sets are duration-based, so weight 0 is legitimately "complete".
// Prevents clearing the gate with N air-squat sets (weight 0 × reps).
function minExercisesNoSkip(workoutLog, target) {
  const exercises = workoutLog?.exercises ?? [];
  if (exercises.length < target) return false;
  const isCardioGroup = (g) => typeof g === 'string' && g.toLowerCase() === 'cardio';
  const exerciseIsCardio = (ex) => {
    const groups = ex?.muscle_groups?.length
      ? ex.muscle_groups
      : (ex?.muscle_group ? [ex.muscle_group] : []);
    return groups.some(isCardioGroup);
  };
  const anySkipped = exercises.some((ex) => {
    const allowZeroWeight = exerciseIsCardio(ex);
    return (ex.sets ?? []).some((s) => {
      if (!s.reps || s.reps <= 0) return true;
      if (allowZeroWeight) return false;
      return !s.weight || Number(s.weight) <= 0;
    });
  });
  return !anySkipped;
}

/**
 * Pure predicate: does the just-saved workout (+ context) satisfy this
 * challenge's criteria? No I/O — fully unit-testable.
 *
 * @param challenge  a row from gauntlet_challenges ({ metric, target_value })
 * @param ctx {
 *   workoutLog,         the just-saved session
 *   historicalLogs,     prior sessions (EXCLUDES the just-saved one)
 *   workoutStreakDays,  server-authoritative consecutive-day streak
 *   todayStr,           'yyyy-MM-dd' (defaults to today)
 * }
 * @returns { met: boolean, score: number|null }
 */
export function evaluateChallengeCriteria(challenge, ctx = {}) {
  const metric = challenge?.metric;
  const target = challenge?.target_value;
  const { workoutLog, historicalLogs = [], workoutStreakDays = 0, todayStr } = ctx;
  const day = todayStr || format(new Date(), 'yyyy-MM-dd');
  const allLogs = [workoutLog, ...historicalLogs].filter(Boolean);

  switch (metric) {
    case 'min_exercises_no_skip':
      return { met: minExercisesNoSkip(workoutLog, target ?? 0), score: (workoutLog?.exercises ?? []).length };
    case 'session_volume': {
      const vol = sessionVolume(workoutLog);
      return { met: vol >= (target ?? Infinity), score: vol };
    }
    case 'sessions_in_5_days':
    case 'sessions_in_7_days': {
      const windowDays = metric === 'sessions_in_5_days' ? 5 : 7;
      const count = distinctDaysInTrailingWindow(allLogs, windowDays, day);
      return { met: count >= (target ?? Infinity), score: count };
    }
    case 'weekly_lbs': {
      const vol = currentWeekVolume(allLogs, day);
      return { met: vol >= (target ?? Infinity), score: vol };
    }
    case 'consecutive_days':
      return { met: (workoutStreakDays ?? 0) >= (target ?? Infinity), score: workoutStreakDays ?? 0 };
    case 'any_compound_pr': {
      const compoundPRs = detectPRsInWorkout(workoutLog, historicalLogs)
        .filter((p) => isCompoundName(p.displayName || p.name));
      const best = compoundPRs.reduce((m, p) => Math.max(m, p.delta || 0), 0);
      return { met: compoundPRs.length > 0, score: compoundPRs.length ? best : null };
    }
    default:
      return { met: false, score: null };
  }
}

// Fetch the signed-in user's server-authoritative consecutive-day workout
// streak (written by advance_workout_streak). Used only for the streak
// challenge so its value reflects the just-recorded day, not a stale prop.
async function fetchWorkoutStreakDays() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const { data } = await supabase
    .from('user_profiles')
    .select('workout_streak')
    .eq('id', user.id)
    .maybeSingle();
  return data?.workout_streak ?? 0;
}

/**
 * Called after every workout save. Advances the Gauntlet path by checking
 * the user's CURRENT challenge against the just-saved workout (+ history),
 * awarding it server-side when the criteria are met. Covers all 10
 * challenges (First Blood → The Final Gauntlet).
 *
 * Never throws — a failed check must never break the workout save.
 *
 * @param ctx { workoutLog, workoutLogId, historicalLogs, workoutStreakDays, todayStr }
 * @returns the RPC award object (+ sequence_number) or null.
 */
export async function checkGauntletProgress(ctx = {}) {
  try {
    const progress = await getMyProgress();
    if (progress?.path_completed) return null;
    const seq = progress?.current_challenge_sequence ?? 1;

    // Already completed this rung? (Idempotent — the RPC also guards this.)
    const completions = await getMyCompletions();
    if (completions.some((c) => c.sequence_number === seq)) return null;

    const challenges = await getGauntletChallenges();
    const challenge = (challenges ?? []).find((c) => c.sequence_number === seq);
    if (!challenge) return null;

    // The streak metric needs the post-save authoritative value; fetch it
    // only for that challenge so the common path stays a no-extra-query.
    let evalCtx = ctx;
    if (challenge.metric === 'consecutive_days' && ctx.workoutStreakDays == null) {
      evalCtx = { ...ctx, workoutStreakDays: await fetchWorkoutStreakDays() };
    }

    const { met, score } = evaluateChallengeCriteria(challenge, evalCtx);
    if (!met) return null;

    const award = await completeGauntletChallenge(seq, ctx.workoutLogId ?? null, score);
    return { ...award, sequence_number: seq };
  } catch (err) {
    // Surface the silent swallow via reportError so a network blip that
    // costs the user a completion shows up in Sentry. Lazy import avoids a
    // circular dep with the reportError pipeline.
    import('@/lib/reportError').then(({ reportError }) => {
      reportError(err, { feature: 'gauntlet.check-progress', level: 'warning' });
    }).catch(() => {});
    return null;
  }
}
