// src/lib/progressiveOverload.js
//
// Auto-progressive-overload suggestion. Looks at the user's last few
// sessions for a given exercise and proposes the next session's
// working weight + reps. Heuristic — not a prescription:
//
//   1. Find the user's most recent sessions for this exercise
//      (working sets only — warmups + failed sets excluded).
//   2. If their LAST session completed all sets at the target rep
//      range (≥90% completion), suggest a small weight bump:
//        • Upper body (bench, press, row, curl, …): +5 lb
//        • Lower body (squat, deadlift, hinge, lunge, …): +10 lb
//        • Bodyweight or unknown: +5%
//   3. If the LAST session was a failed grind (any failed set OR
//      partial completion), suggest STAYING at the same weight with
//      a focus on cleaner reps.
//   4. If they haven't trained the exercise in 14+ days, suggest a
//      regression of 5-10% to ease back in.
//
// Returns null when there isn't enough data to be useful (< 1 prior
// session). The UI shows the suggestion as a quiet hint below the
// recent-sessions line; the user can ignore it without dismissal.

const UPPER_REGEX = /\b(bench|press|row|curl|fly|raise|pull[- ]?up|chin[- ]?up|push[- ]?up|dip|extension|tricep|bicep|shoulder|lat)\b/i;
const LOWER_REGEX = /\b(squat|deadlift|hinge|lunge|hip|leg|calf|glute|hamstring|quad|romanian)\b/i;

function classify(name) {
  if (LOWER_REGEX.test(name)) return 'lower';
  if (UPPER_REGEX.test(name)) return 'upper';
  return 'unknown';
}

function workingSetsOnly(sets) {
  return (sets || []).filter(s => !s?.is_warmup && !s?.is_failed);
}

/**
 * Compute the suggestion for one exercise.
 *
 * @param {string} exerciseName
 * @param {Array} workoutLogs   user's recent workout_logs (newest first)
 * @param {object} [opts]
 * @param {Date}   [opts.now=new Date()]
 * @returns {null | { kind, weight, reps, message }}
 */
export function suggestNext(exerciseName, workoutLogs = [], { now = new Date() } = {}) {
  if (!exerciseName) return null;
  const lc = exerciseName.toLowerCase();
  const sessions = [];
  for (const log of workoutLogs || []) {
    const exs = log?.exercises || [];
    const match = exs.find(e =>
      (e?.name || e?.exercise_name || '').toLowerCase() === lc
    );
    if (!match) continue;
    const working = workingSetsOnly(match.sets);
    if (working.length === 0) continue;
    sessions.push({
      date: log.date || log.created_at,
      sets: working,
      anyFailed: (match.sets || []).some(s => s?.is_failed),
    });
    if (sessions.length >= 4) break;
  }
  if (sessions.length === 0) return null;

  const last = sessions[0];
  const lastDate = last.date ? new Date(last.date) : null;
  const ageDays = lastDate
    ? Math.floor((now - lastDate) / (24 * 3600 * 1000))
    : 0;

  // Top working weight + median reps in the last session.
  const topWeight = Math.max(...last.sets.map(s => Number(s.weight) || 0));
  const repsArr = last.sets.map(s => Number(s.reps) || 0).filter(n => n > 0).sort((a, b) => a - b);
  const medianReps = repsArr.length
    ? repsArr[Math.floor(repsArr.length / 2)]
    : 0;

  // Branch 1: stale (14+ days) → regress slightly.
  if (ageDays >= 14) {
    const regressed = Math.max(0, Math.round(topWeight * 0.92 / 2.5) * 2.5);
    return {
      kind: 'regress',
      weight: regressed,
      reps: medianReps || null,
      message: `Off ${ageDays} days — start at ~${regressed} to ease back in.`,
    };
  }

  // Branch 2: failed grind → hold the line.
  if (last.anyFailed) {
    return {
      kind: 'hold',
      weight: topWeight,
      reps: medianReps || null,
      message: `Stay at ${topWeight} — clean the reps before adding load.`,
    };
  }

  // Branch 3: smooth session → small bump per body region.
  const region = classify(exerciseName);
  let bump = 5;
  if (region === 'lower') bump = 10;
  else if (region === 'unknown') bump = Math.max(2.5, Math.round((topWeight * 0.05) / 2.5) * 2.5);
  const nextWeight = topWeight + bump;
  return {
    kind: 'bump',
    weight: nextWeight,
    reps: medianReps || null,
    message: `Try ${nextWeight} (+${bump}) — last session looked smooth.`,
  };
}
