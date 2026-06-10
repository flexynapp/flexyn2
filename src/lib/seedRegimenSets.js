// src/lib/seedRegimenSets.js
//
// Pure set-seeding logic for starting an active workout from a regimen
// or a built-in program template. Extracted from Workout.jsx's
// startFromRegimen so it can be unit-tested in isolation. (Audit task 8.)
//
// Two regimen shapes are supported:
//   1. Built-in programs / cloned templates — each exercise carries an
//      explicit `sets[]` array (each set with `reps_target` and an
//      optional prescribed `weight`). Honor the array's length + values
//      so a program doesn't collapse to "3 blank sets".
//   2. Hand-built regimens — scalar `target_sets` / `target_reps`. We
//      seed `target_sets` rows, reps from `target_reps`, weight from
//      workout history when available (progressive-overload continuity).
//
// `histSeed` is the per-set history seed (array of { weight, reps }) the
// caller looks up via getLastSetsForExercise. Pass [] / null when there
// is no history.

/**
 * Seed the `sets` array for ONE regimen exercise.
 *
 * @param {object} ex          regimen exercise (sets[] or target_sets/reps)
 * @param {Array}  histSeed    history seed rows [{ weight, reps }], optional
 * @returns {Array<{weight: number|null, reps: number|null}>}
 */
export function seedSetsForExercise(ex, histSeed = []) {
  const hist = Array.isArray(histSeed) ? histSeed : [];
  const hasSetsArray = Array.isArray(ex?.sets) && ex.sets.length > 0;
  const targetSets = hasSetsArray ? ex.sets.length : (ex?.target_sets || 3);
  const targetReps = ex?.target_reps != null && ex.target_reps !== ''
    ? Number(ex.target_reps)
    : null;

  if (hasSetsArray) {
    // Per-set seeding from the program's sets[]. The set's own
    // reps_target (or the regimen-level target_reps) seeds reps; the
    // set's prescribed weight seeds weight, else fall back to history.
    return ex.sets.map((s, i) => {
      const reps = s?.reps_target != null && s.reps_target !== ''
        ? Number(s.reps_target)
        : (targetReps != null ? targetReps : (hist[i]?.reps ?? null));
      const weight = s?.weight != null && s.weight !== ''
        ? Number(s.weight)
        : (hist[i]?.weight ?? null);
      return { weight, reps };
    });
  }

  if (hist.length > 0) {
    return hist.map((s) => ({
      weight: s?.weight ?? null,
      reps: targetReps != null ? targetReps : (s?.reps ?? null),
    }));
  }

  return Array.from({ length: targetSets }, () => ({
    weight: null,
    reps: targetReps,
  }));
}
