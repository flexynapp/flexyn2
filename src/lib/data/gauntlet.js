// src/lib/data/gauntlet.js
// Gauntlet Path + Weekly Community Gauntlet data layer.
import { supabase } from '@/api/supabaseClient';

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

// ── Challenge 1 detection helper ─────────────────────────────────────────────

/**
 * Called after every workout save. Checks if the user qualifies for
 * Challenge 1 ("First Blood" — 4+ exercises, zero skipped sets).
 * Returns the RPC result if awarded, or null if not eligible.
 * Never throws — swallow all errors so the workout save never breaks.
 */
export async function checkChallenge1(workoutLog, workoutLogId) {
  try {
    // Must be on challenge 1
    const progress = await getMyProgress();
    const seq = progress?.current_challenge_sequence ?? 1;
    if (seq !== 1) return null;

    // Already completed?
    const completions = await getMyCompletions();
    if (completions.some(c => c.sequence_number === 1)) return null;

    // Validate the workout
    const exercises = workoutLog?.exercises ?? [];
    if (exercises.length < 4) return null;

    // "Zero skipped sets" = every set must have reps > 0 AND
    // either a real weight > 0 OR the exercise is cardio-style.
    // The previous version only checked reps and accepted weight=0,
    // letting a user clear the gauntlet with 4 air-squat sets (weight
    // 0 × N reps). Cardio remains exempt to match the convention in
    // src/pages/Workout.jsx — cardio sets are duration-based, not
    // weight-based, so they're already "complete" without a weight.
    const isCardioGroup = (g) =>
      typeof g === 'string' && g.toLowerCase() === 'cardio';
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
    if (anySkipped) return null;

    // All clear — award it
    const totalVolume = exercises.reduce((acc, ex) =>
      acc + (ex.sets ?? []).reduce((s, set) =>
        s + (set.reps ?? 0) * (set.weight ?? 0), 0), 0);

    return await completeGauntletChallenge(1, workoutLogId, totalVolume);
  } catch {
    return null;
  }
}
