// src/lib/goalProgress.js
//
// Shared progress calculators for goals. Used by GoalsAlmostComplete (the
// dashboard "almost there" card) and GoalsList (the modal list view).
//
// It had a third caller, CardioGoals (the Cardio → Goals screen), until
// 0e7a2d6d took that screen off the Cardio page on 2026-08-11 — cardio
// goals are created and edited in the Goals form like every other type.
// The component and its test outlived the removal by a day and were
// deleted in the goals audit; see docs/goals-audit.md.
//
// ── CARDIO, added 2026-08-11 ──────────────────────────────────────────
// The cardio half arrived the same way the strength half did, and for the
// same reason. There were THREE implementations of "how far along is this
// cardio goal": a private one in GoalsAlmostComplete, an inline one in
// GoalsList, and a third in CardioGoals that ran off calendar-period
// bounds instead of the goal's own period_start_date. Three answers to
// one question is the exact shape this module exists to prevent, so the
// cardio calculator now lives here too. Two of those three callers
// survive; the third was the removed screen described above.
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
//
// ── ONE SET, since 2026-09-27 (Kegan) ─────────────────────────────────
// "Bench 225 × 5" means one set of five at 225 or heavier, which is how a
// lifter reads it. Until this date reps at or above the target weight were
// SUMMED across every session since the goal was set, so five singles over
// a month completed a five-rep goal. Rep-only goals ("Pull-ups 15") are one
// set too, for the same reason: the goal names a set, not a tally.

/**
 * Compute progress for a single strength goal.
 *
 * @param {object} goal     — goal row, expects { exercise_name,
 *   exercise_canonical?, target_weight, target_reps, created_date }
 * @param {Array}  logs     — workout_logs rows (pass them all; logs from
 *   before the goal was created are skipped here)
 * @returns {{ maxWeight: number, maxReps: number,
 *            bestSet: {weight:number, reps:number}|null,
 *            progress: number, currentValue: number }}
 *   progress: 0-100, clamped.
 *   bestSet: the single set closest to the target, for "215 × 5" labels.
 *   currentValue: weight for weight goals, reps for rep-only goals.
 */
export function computeStrengthGoalProgress(goal, logs) {
  if (!goal) return _empty();

  // Canonical name wins when present — set during goal creation via
  // ExerciseAutocomplete. Falls back to the user-typed name for
  // legacy goals that predate the canonical field.
  const target = (goal.exercise_canonical || goal.exercise_name || '').toLowerCase().trim();
  if (!target) return _empty();

  const createdAt = goal.created_date ? new Date(goal.created_date).getTime() : 0;

  const tw = Number(goal.target_weight);
  const tr = Number(goal.target_reps);
  const hasWeightTarget = Number.isFinite(tw) && tw > 0;
  const hasRepsTarget   = Number.isFinite(tr) && tr > 0;
  if (!hasWeightTarget && !hasRepsTarget) return _empty();

  let maxWeight = 0;
  let maxReps   = 0;
  let bestSet   = null;
  let bestScore = 0;

  for (const log of (logs || [])) {
    // Only forward progress counts: a goal set today is not met by last
    // month's session.
    if (createdAt && log?.created_date) {
      if (new Date(log.created_date).getTime() < createdAt) continue;
    }
    for (const ex of (log?.exercises || [])) {
      if ((ex?.name || '').toLowerCase().trim() !== target) continue;
      for (const set of (ex?.sets || [])) {
        const r = Number(set?.reps);
        // A set with no reps was never lifted, so its weight proves nothing.
        if (!Number.isFinite(r) || r <= 0) continue;
        const wRaw = Number(set?.weight);
        const w = Number.isFinite(wRaw) && wRaw > 0 ? wRaw : 0;
        if (w > maxWeight) maxWeight = w;
        if (r > maxReps) maxReps = r;

        // How close this one set is to the target, 0..1. Both halves are
        // capped at 1 so a heavy triple cannot make up for missing reps.
        let score;
        if (hasWeightTarget && hasRepsTarget) score = Math.min(w / tw, 1) * Math.min(r / tr, 1);
        else if (hasWeightTarget)             score = Math.min(w / tw, 1);
        // A weighted-vest set still counts toward a rep goal.
        else                                  score = Math.min(r / tr, 1);

        if (score > bestScore || (score === bestScore && bestSet && w > bestSet.weight)) {
          bestScore = score;
          bestSet = { weight: w, reps: r };
        }
      }
    }
  }

  return {
    maxWeight,
    maxReps,
    bestSet,
    progress: clamp(bestScore * 100, 0, 100),
    currentValue: hasWeightTarget ? (bestSet?.weight || 0) : maxReps,
  };
}

/**
 * Progress for any goal type. Cardio needs cardio_logs; a caller that
 * forgets them gets 0% for every cardio goal, which is exactly how the
 * Goals sheet showed 0 km for months.
 */
export function goalProgress(goal, logs, cardioLogs) {
  return isCardioGoal(goal)
    ? computeCardioGoalProgress(goal, cardioLogs).progress
    : computeStrengthGoalProgress(goal, logs).progress;
}

function _empty() {
  return {
    maxWeight: 0,
    maxReps: 0,
    bestSet: null,
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
