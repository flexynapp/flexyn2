// src/lib/data/personalRecords.js
//
// Per-exercise all-time best 1RM lookup. Powers:
//   • PR proximity bar (live percentage as user types)
//   • PR stamp on set rows during a workout
//   • Future: PR history page / progress charts
//
// Reads from already-fetched workout logs (the queryClient's existing
// ['workoutLogs', email] cache when available; falls back to a fresh
// fetch when not). Returns the best Epley 1RM across all sets for the
// given exercise name.
//
// Implementation note: the workout-logs cache is large but already
// hot (Dashboard + Workout both fetch it). Iterating client-side is
// faster + cheaper than a per-exercise server query.

import { bestOneRepMax } from '@/lib/oneRepMax';

/**
 * Computes the best 1RM for `exerciseName` across the supplied
 * workout logs (typically `useQuery(['workoutLogs', email]).data`).
 *
 * Case-insensitive exercise-name match.
 *
 * @param {string} exerciseName
 * @param {Array<{ exercises: Array<{ name, sets }> }>} workoutLogs
 * @returns {number}  best 1RM in the user's stored unit (lbs)
 */
export function bestPRForExercise(exerciseName, workoutLogs = []) {
  if (!exerciseName || !Array.isArray(workoutLogs)) return 0;
  const target = exerciseName.trim().toLowerCase();
  if (!target) return 0;
  let best = 0;
  for (const log of workoutLogs) {
    const exes = log?.exercises;
    if (!Array.isArray(exes)) continue;
    for (const ex of exes) {
      const name = (ex?.name || ex?.displayName || '').trim().toLowerCase();
      if (name !== target) continue;
      const rm = bestOneRepMax(ex.sets);
      if (rm > best) best = rm;
    }
  }
  return best;
}

/**
 * Convenience: returns an object keyed by lowercase exercise name with
 * the best 1RM for each. Useful when rendering multiple set rows in
 * a single workout (avoids re-walking logs per row).
 */
export function buildPRIndex(workoutLogs = []) {
  const index = {};
  if (!Array.isArray(workoutLogs)) return index;
  for (const log of workoutLogs) {
    const exes = log?.exercises;
    if (!Array.isArray(exes)) continue;
    for (const ex of exes) {
      const name = (ex?.name || ex?.displayName || '').trim().toLowerCase();
      if (!name) continue;
      const rm = bestOneRepMax(ex.sets);
      if (rm > (index[name] || 0)) index[name] = rm;
    }
  }
  return index;
}
