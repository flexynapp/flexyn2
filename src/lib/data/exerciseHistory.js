// src/lib/data/exerciseHistory.js
//
// Pure-client helper that pulls the last N sessions' sets for a
// given exercise out of the user's workout-log cache. Powers the
// "Last: 185×8, 185×8, 185×7" hint shown next to each exercise in
// the workout logger.

/**
 * @param {Array}  workoutLogs    user's workout log array (cached)
 * @param {string} exerciseName   the exercise to find history for
 * @param {number} [sessions=3]   how many past sessions to return
 *
 * Returns an array of session-sets:
 *   [
 *     [{ weight: 185, reps: 8 }, { weight: 185, reps: 7 }],  // most recent
 *     [{ weight: 180, reps: 8 }, …],                          // session before
 *     …
 *   ]
 * Most recent FIRST. Sets without a logged weight (warmups, body-
 * weight) are still included so the user sees what they actually did.
 *
 * Case-insensitive exercise-name match against `name` and `displayName`.
 */
export function getRecentSessionsForExercise(workoutLogs, exerciseName, sessions = 3) {
  return getRecentSessionsDetailed(workoutLogs, exerciseName, sessions).map(s => s.sets);
}

/**
 * Same scan, but keeps the per-session context the sets-only shape
 * throws away — specifically which machine it was done on.
 *
 * Returns [{ sets, equipment, date }], most recent FIRST. `equipment` is
 * the object stored on the logged exercise (see ImplementPicker), or
 * null for sessions logged before the picker existed / with nothing
 * chosen — so callers must treat it as optional forever, not just
 * during rollout.
 *
 * getRecentSessionsForExercise is a thin wrapper over this so its
 * long-standing contract (an array of set-arrays) is untouched.
 */
export function getRecentSessionsDetailed(workoutLogs, exerciseName, sessions = 3) {
  if (!Array.isArray(workoutLogs) || !exerciseName) return [];
  const target = exerciseName.trim().toLowerCase();
  if (!target) return [];

  // Sort logs newest-first by date (or created_at fallback).
  const sorted = [...workoutLogs].sort((a, b) => {
    const da = new Date(a?.date || a?.created_at || 0).getTime();
    const db = new Date(b?.date || b?.created_at || 0).getTime();
    return db - da;
  });

  const out = [];
  for (const log of sorted) {
    const exes = Array.isArray(log?.exercises) ? log.exercises : [];
    for (const ex of exes) {
      const lower = (ex?.name || ex?.displayName || '').trim().toLowerCase();
      if (lower !== target) continue;
      const sets = Array.isArray(ex?.sets) ? ex.sets : [];
      if (sets.length === 0) continue;
      out.push({
        sets: sets.map(s => ({
          weight: s?.weight ?? null,
          reps:   s?.reps   ?? null,
        })),
        equipment: ex?.equipment || null,
        date: log?.date || log?.created_at || null,
      });
      break; // only one entry per log
    }
    if (out.length >= sessions) break;
  }
  return out;
}

/**
 * The machine the user was last on for this exercise.
 *
 * Used to prefill the picker. Reads from the workout log rather than
 * localStorage on purpose: the log is already in memory, and it follows
 * the user across devices — someone who logs on their phone at the gym
 * and their tablet at home should see the same machine either way.
 *
 * Returns null when they've never picked one.
 */
export function getLastImplementForExercise(workoutLogs, exerciseName) {
  const recent = getRecentSessionsDetailed(workoutLogs, exerciseName, 5);
  for (const session of recent) {
    if (session.equipment?.label) return session.equipment;
  }
  return null;
}

/**
 * Format a session's sets as a compact one-liner: "185×8, 185×8, 185×7".
 * Skips sets where both weight and reps are null. Empty result → ''.
 */
export function formatSetsLine(sets) {
  if (!Array.isArray(sets)) return '';
  const parts = [];
  for (const s of sets) {
    const w = s?.weight;
    const r = s?.reps;
    if (w == null && r == null) continue;
    if (w != null && r != null) parts.push(`${Math.round(w)}×${r}`);
    else if (w != null)         parts.push(`${Math.round(w)}`);
    else                        parts.push(`×${r}`);
  }
  return parts.join(', ');
}
