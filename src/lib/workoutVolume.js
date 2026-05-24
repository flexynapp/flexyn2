// src/lib/workoutVolume.js
//
// Centralized volume math. Previously the calculation lived inline in
// three places (Workout.jsx's calculateTotalVolume, LiveVolumePill,
// WorkoutShareCard) — each with the same `weight × reps` formula.
//
// The May 2026 audit (C-3) flagged that this undercounts barbell
// movements by ~20% because the bar weight itself isn't included.
// This helper makes the calculation configurable: when the user's
// `include_bar_in_volume` profile flag is on AND the exercise is
// detected as barbell-loaded, the bar weight is added per set.
//
// Default (flag off) preserves the historical formula so existing
// leaderboard totals don't suddenly inflate ~20% for users who never
// opted in. The setting toggle lives in SettingsPanel.

import { getActiveBarLbs } from '@/lib/barInventory';

// Pure name regex — mirrors the same heuristic SetRow uses to decide
// when to render the plate diagram. Keep them in sync; if a new
// barbell variant is added (e.g., "log press"), update both.
const BARBELL_REGEX = /\b(barbell|squat|deadlift|bench|press|row|clean|snatch|jerk)\b/i;

export function isBarbellExercise(name) {
  return BARBELL_REGEX.test(String(name || ''));
}

/**
 * Volume contribution of a single set.
 *
 * Bodyweight movements (weight === 0) contribute 0 — bodyweight isn't
 * tracked per-set so we can't reliably add user bodyweight × reps
 * without lying about the math. Future enhancement: factor in
 * userProfile.weight_lbs for bodyweight-tagged exercises.
 */
export function setVolume(set, exerciseName, { includeBarWeight = false, barLbs = 45 } = {}) {
  const w = Number(set?.weight);
  const r = Number(set?.reps);
  if (!Number.isFinite(w) || !Number.isFinite(r) || r <= 0 || w <= 0) return 0;
  if (includeBarWeight && isBarbellExercise(exerciseName)) {
    return (w + barLbs) * r;
  }
  return w * r;
}

/**
 * Total volume across an exercise list. Used by:
 *   - the live LiveVolumePill on the active-workout screen
 *   - the calculateTotalVolume call in Workout.jsx's save mutation
 *   - downstream displays (WorkoutShareCard, debrief)
 *
 * Pass `includeBarWeight: true` to honor the user's bar-weight
 * preference. The bar value comes from getActiveBarLbs() unless
 * explicitly overridden.
 */
export function totalVolume(exercises = [], opts = {}) {
  const includeBarWeight = !!opts.includeBarWeight;
  const barLbs = Number.isFinite(opts.barLbs) ? opts.barLbs : getActiveBarLbs();
  let total = 0;
  for (const ex of exercises || []) {
    const sets = ex?.sets || [];
    for (const s of sets) {
      total += setVolume(s, ex?.name || ex?.displayName, { includeBarWeight, barLbs });
    }
  }
  return total;
}
