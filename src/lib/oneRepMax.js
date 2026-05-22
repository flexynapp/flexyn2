// src/lib/oneRepMax.js
//
// Shared 1RM estimation + utilities. Was duplicated inline in
// ExerciseLogger; now centralized so the live-volume pill, PR
// proximity bar, and PR-stamp features all use the same math.
//
// Epley's formula:
//   1RM = weight × (1 + reps / 30)
//
// Caveats:
//   • Accuracy degrades sharply above ~12 reps. Returns 0 for
//     anything outside the [1, 12] rep window so high-rep sets
//     don't claim implausible PRs.
//   • Weight === 0 returns 0 (bodyweight exercises need their own
//     rep-based PR comparator).
//   • Single-rep set: 1RM === weight (formula yields weight × 1.033;
//     we special-case to keep "225 × 1" returning 225, not 232).

export const REP_RANGE_MAX = 12;

/**
 * Estimate 1-rep max from a single set's weight + reps via Epley.
 * Returns 0 when inputs are invalid or out of the accurate range.
 */
export function epleyOneRepMax(weight, reps) {
  const w = Number(weight);
  const r = Number(reps);
  if (!Number.isFinite(w) || !Number.isFinite(r)) return 0;
  if (w <= 0 || r <= 0) return 0;
  if (r > REP_RANGE_MAX) return 0;
  if (r === 1) return w;
  return w * (1 + r / 30);
}

/**
 * Best estimated 1RM across an array of sets — used to compute a
 * session-best (for the PR stamp) or all-time-best (for the
 * proximity bar comparator).
 *
 * @param {Array<{ weight, reps }>} sets
 * @returns {number}
 */
export function bestOneRepMax(sets = []) {
  let best = 0;
  for (const s of sets) {
    const rm = epleyOneRepMax(s?.weight, s?.reps);
    if (rm > best) best = rm;
  }
  return best;
}
