// src/lib/goalProgress.js
//
// Shared progress calculator for STRENGTH goals. Used by both
// GoalsAlmostComplete (the dashboard "almost there" card) and
// GoalsList (the modal list view).
//
// Audit found these two components used DIFFERENT logic:
//
//   • GoalsAlmostComplete summed ALL reps across all logs, regardless
//     of weight. A user with target "315 lb × 5 reps" who logged
//     "225 lb × 10 reps" saw 200% on this card while GoalsList
//     correctly showed 0% (no reps at goal weight).
//
//   • GoalsList only counted reps EXACTLY at target_weight. Lifting
//     MORE than target weight (e.g. 320 lb × 5 reps for a 315 lb goal)
//     produced 0 rep-progress.
//
//   • Both skipped sets where `set.weight` was falsy (null or 0), so
//     bodyweight goals like "Push-ups × 100 reps" never progressed.
//
// This module is the single source of truth. Pure function — fully
// unit-testable, zero React / Supabase deps.

/**
 * Compute progress for a single strength goal.
 *
 * @param {object} goal     — goal row, expects { exercise_name,
 *   exercise_canonical?, target_weight, target_reps, created_date }
 * @param {Array}  logs     — workout_logs rows (oldest filter applied
 *   internally — pass them all, function handles filtering)
 * @returns {{ maxWeight: number, repsAtOrAboveTarget: number,
 *            bodyweightReps: number, progress: number,
 *            currentValue: number }}
 *   progress: 0-100, clamped.
 *   currentValue: number to display in the "X / Y" subtitle.
 */
export function computeStrengthGoalProgress(goal, logs) {
  if (!goal) return _empty();

  // Canonical name wins when present — set during goal creation via
  // ExerciseAutocomplete. Falls back to the user-typed name for
  // legacy goals that predate the canonical field.
  const target = (goal.exercise_canonical || goal.exercise_name || '').toLowerCase().trim();
  if (!target) return _empty();

  const createdAt = goal.created_date ? new Date(goal.created_date).getTime() : 0;

  const hasWeightTarget = goal.target_weight != null && goal.target_weight > 0;
  const hasRepsTarget   = goal.target_reps   != null && goal.target_reps   > 0;
  // If neither target is set the goal is malformed — return 0 progress.
  if (!hasWeightTarget && !hasRepsTarget) return _empty();

  let maxWeight             = 0;
  let repsAtOrAboveTarget   = 0;
  let bodyweightReps        = 0;

  for (const log of (logs || [])) {
    // Skip logs from BEFORE the goal was created — only forward
    // progress counts.
    if (createdAt && log?.created_date) {
      if (new Date(log.created_date).getTime() < createdAt) continue;
    }
    for (const ex of (log?.exercises || [])) {
      if ((ex?.name || '').toLowerCase().trim() !== target) continue;
      for (const set of (ex?.sets || [])) {
        const w = Number(set?.weight);
        const r = Number(set?.reps);
        if (!Number.isFinite(r) || r <= 0) continue;
        const hasWeight = Number.isFinite(w) && w > 0;

        if (hasWeight) {
          if (w > maxWeight) maxWeight = w;
          // Count reps at OR ABOVE the target weight. Lifting heavier
          // should count — the previous "exactly target_weight" logic
          // in GoalsList dropped legit progress for users who overshot.
          if (hasWeightTarget && w >= goal.target_weight) {
            repsAtOrAboveTarget += r;
          }
          // For bodyweight goals (no weight target), weighted-vest
          // reps STILL count — wearing a vest while doing push-ups
          // is harder, not easier; we shouldn't exclude that progress.
          if (!hasWeightTarget) {
            bodyweightReps += r;
          }
        } else {
          // Bodyweight set (weight null / 0). Always counts for
          // rep-only goals; tracked but unused for weight goals.
          bodyweightReps += r;
        }
      }
    }
  }

  // Compute progress.
  let progress;
  let currentValue;

  if (hasWeightTarget && hasRepsTarget) {
    // Both targets — user needs to hit BOTH weight and rep count
    // at-or-above. Progress reflects whichever they're further on.
    // Once weight is met, only reps-at-target gates completion;
    // once reps-at-target is met, only weight gates.
    if (maxWeight >= goal.target_weight && repsAtOrAboveTarget >= goal.target_reps) {
      progress = 100;
    } else if (maxWeight < goal.target_weight) {
      // Haven't hit the weight yet — progress is weight-driven.
      progress = (maxWeight / goal.target_weight) * 100;
    } else {
      // Weight is met, building reps at-or-above.
      progress = (repsAtOrAboveTarget / goal.target_reps) * 100;
    }
    currentValue = maxWeight || repsAtOrAboveTarget;
  } else if (hasWeightTarget) {
    // Weight-only goal (e.g. "deadlift 405 once").
    progress = maxWeight >= goal.target_weight ? 100 : (maxWeight / goal.target_weight) * 100;
    currentValue = maxWeight;
  } else {
    // Reps-only goal — bodyweight-style (e.g. "100 push-ups").
    // Total counts: bodyweight reps + any weighted reps (a user
    // weighted-vest push-up still counts toward the bodyweight goal).
    const totalReps = bodyweightReps + repsAtOrAboveTarget;
    progress = (totalReps / goal.target_reps) * 100;
    currentValue = totalReps;
  }

  return {
    maxWeight,
    repsAtOrAboveTarget,
    bodyweightReps,
    progress: clamp(progress, 0, 100),
    currentValue,
  };
}

function _empty() {
  return {
    maxWeight: 0,
    repsAtOrAboveTarget: 0,
    bodyweightReps: 0,
    progress: 0,
    currentValue: 0,
  };
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}
