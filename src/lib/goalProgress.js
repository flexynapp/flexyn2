// src/lib/goalProgress.js
//
// Shared progress calculators for goals. Used by GoalsAlmostComplete (the
// dashboard "almost there" card), GoalsList (the modal list view) and
// CardioGoals (the Cardio → Goals screen).
//
// ── CARDIO, added 2026-08-11 ──────────────────────────────────────────
// The cardio half arrived the same way the strength half did, and for the
// same reason. There were THREE implementations of "how far along is this
// cardio goal": a private one in GoalsAlmostComplete, an inline one in
// GoalsList, and a third in CardioGoals that ran off calendar-period
// bounds instead of the goal's own period_start_date. Three answers to
// one question is the exact shape this module exists to prevent, so the
// cardio calculator now lives here too and all three call it.
//
// ── STRENGTH ─────────────────────────────────────────────────────────
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

// ── CARDIO ────────────────────────────────────────────────────────────

/** The three cardio goal types the app writes and reads. */
export const CARDIO_GOAL_TYPES = ['cardio_distance', 'cardio_duration', 'cardio_sessions'];

/** True for any cardio goal, whichever metric it targets. */
export function isCardioGoal(goal) {
  return CARDIO_GOAL_TYPES.includes(String(goal?.goal_type || ''));
}

/**
 * Does a cardio_logs row count toward a goal scoped to `activity`?
 *
 * The underscore matters. `cardio_logs.type` is `<mode>_<env>` —
 * `running_outside`, `walking_treadmill` — so matching on the bare prefix
 * would let a hypothetical `runningmachine_x` count toward "running".
 * `'any'` matches everything, which is what the Any Cardio option means.
 */
export function matchesActivity(logType, activity) {
  if (activity === 'any') return true;
  return String(logType || '').startsWith(activity + '_');
}

/** Which target column a goal type reads. */
function cardioTargetOf(goal) {
  if (goal.goal_type === 'cardio_distance') return Number(goal.target_distance_meters);
  if (goal.goal_type === 'cardio_duration') return Number(goal.target_duration_seconds);
  if (goal.goal_type === 'cardio_sessions') return Number(goal.target_sessions);
  return 0;
}

/** What one log contributes to a goal of this type. */
function cardioAmountOf(goal, log) {
  if (goal.goal_type === 'cardio_distance') return Number(log.distance_meters) || 0;
  if (goal.goal_type === 'cardio_duration') return Number(log.duration_seconds) || 0;
  if (goal.goal_type === 'cardio_sessions') return 1;
  return 0;
}

/**
 * Compute progress for a single cardio goal.
 *
 * @param {object} goal        — goal row: { goal_type, cardio_activity,
 *   period, period_start_date, created_date, target_* }
 * @param {Array}  cardioLogs  — cardio_logs rows; pass them all, this
 *   filters internally.
 * @returns {{ currentValue: number, target: number, progress: number }}
 *   progress: 0-100, clamped.
 *
 * Two filters, and both are load-bearing:
 *
 *   • Logs from before the goal existed do not count. Otherwise creating
 *     "run 50 km this month" on the 28th completes it instantly off runs
 *     the user did before they set the goal, which is not a goal.
 *   • Logs from before `period_start_date` do not count, unless the goal
 *     is `lifetime`. This is what makes a weekly goal reset on Monday
 *     without anyone writing a reset job.
 *
 * A `lifetime` goal deliberately reads no period floor — that is the
 * whole meaning of the option, and it is what the two goals already in
 * production ("Run a 5K" ×2) use.
 */
export function computeCardioGoalProgress(goal, cardioLogs) {
  const empty = { currentValue: 0, target: 0, progress: 0 };
  if (!goal || !isCardioGoal(goal)) return empty;

  const goalCreated = goal.created_date ? new Date(goal.created_date).getTime() : 0;
  const periodFloor = (goal.period !== 'lifetime' && goal.period_start_date)
    ? new Date(goal.period_start_date).getTime()
    : null;

  let total = 0;
  for (const log of (Array.isArray(cardioLogs) ? cardioLogs : [])) {
    if (!log) continue;
    if (goalCreated && log.created_date) {
      if (new Date(log.created_date).getTime() < goalCreated) continue;
    }
    if (periodFloor !== null && log.date) {
      if (new Date(log.date).getTime() < periodFloor) continue;
    }
    if (!matchesActivity(log.type, goal.cardio_activity)) continue;
    total += cardioAmountOf(goal, log);
  }

  const target = cardioTargetOf(goal);
  // A malformed goal (no target, or a NaN one from a bad paste) reports
  // 0%, never NaN — a NaN width silently collapses the bar to nothing and
  // reads as "no progress" rather than as the data error it is.
  if (!Number.isFinite(target) || target <= 0) {
    return { currentValue: total, target: 0, progress: 0 };
  }
  return { currentValue: total, target, progress: clamp((total / target) * 100, 0, 100) };
}

/**
 * The first day that counts toward a `week` / `month` goal, as yyyy-MM-dd.
 * `lifetime` has no floor and returns null.
 *
 * Weeks start MONDAY, matching `startOfWeek(now, { weekStartsOn: 1 })`
 * used everywhere else in the app. Written with plain date arithmetic so
 * this module keeps its "no dependencies" property — it is imported by
 * pure-logic tests that do not want date-fns pulled in.
 */
export function periodStartDate(period) {
  const d = new Date();
  if (period === 'week') {
    const dow = d.getDay();                      // 0 = Sunday
    const backToMonday = dow === 0 ? 6 : dow - 1;
    d.setDate(d.getDate() - backToMonday);
  } else if (period === 'month') {
    d.setDate(1);
  } else {
    return null;
  }
  // Local-date formatting, NOT toISOString(): that converts to UTC first,
  // so anyone west of Greenwich gets yesterday's date for most of the day.
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function clamp(n, min, max) {
  // Number.isFinite catches NaN AND Infinity — without this guard a
  // divide-by-zero somewhere upstream produced Infinity that clamped
  // to 100% and let a "almost complete" card mark a goal completable
  // with zero real progress against it. NaN would silently propagate
  // through downstream comparisons as `false`, hiding the goal entirely.
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}
