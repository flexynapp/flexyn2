// The one lift a profile names under "Workouts".
//
// It used to be the highest estimated 1RM across every exercise, which on a
// real account named the leg press: a sled loaded to 540 lb out-estimates
// any barbell lift anyone does, so the line read as a boast about the one
// number that means least. Two changes:
//
//   • Barbell lifts only (squat, bench, deadlift, press, row …), decided by
//     implementTypeForExercise rather than the coarse classifier. Dumbbell
//     lifts are the fallback, then anything, so a lifter with no barbell
//     history still gets a line.
//   • The heaviest weight actually lifted, with its reps, instead of an
//     Epley estimate. "Bench 225 × 5" is a set someone did; "Bench 262" is
//     arithmetic.
//
// Weights are stored in lb; the caller converts for display.

import { implementTypeForExercise } from '@/lib/equipmentCatalog';

function heaviestSet(sets) {
  let best = null;
  for (const s of Array.isArray(sets) ? sets : []) {
    if (!s || s.is_warmup) continue;
    const weight = Number(s.weight) || 0;
    const reps = Number(s.reps) || 0;
    if (weight <= 0 || reps <= 0) continue;
    if (!best || weight > best.weight || (weight === best.weight && reps > best.reps)) {
      best = { weight, reps };
    }
  }
  return best;
}

/**
 * @param {Array<{ exercises?: Array<{ name?: string, displayName?: string, sets?: Array }> }>} logs
 * @returns {{ name: string, weight: number, reps: number } | null}
 */
export function headlineLift(logs = []) {
  const byName = new Map();
  for (const log of Array.isArray(logs) ? logs : []) {
    for (const ex of Array.isArray(log?.exercises) ? log.exercises : []) {
      const raw = String(ex?.name || ex?.displayName || '').trim();
      if (!raw) continue;
      const set = heaviestSet(ex.sets);
      if (!set) continue;
      const key = raw.toLowerCase();
      const prev = byName.get(key);
      if (!prev || set.weight > prev.weight || (set.weight === prev.weight && set.reps > prev.reps)) {
        byName.set(key, { name: prev?.name || raw, ...set });
      }
    }
  }
  const all = [...byName.values()];
  const heaviest = (list) => list.sort((a, b) => b.weight - a.weight || b.reps - a.reps)[0] || null;
  const ofType = (type) => all.filter((l) => implementTypeForExercise(l.name) === type);
  return heaviest(ofType('barbell')) || heaviest(ofType('dumbbell')) || heaviest(all);
}
