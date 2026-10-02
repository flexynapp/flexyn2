// src/lib/todaySession.js
//
// Today's session as the Today page shows it: each lift in the due regimen
// with the weight to put on the bar, and how that compares with last time.
// Pure. The weights come from suggestNext (progressiveOverload.js), the same
// heuristic the Workout logger shows beside a set, so Today and the logger
// never disagree about what to lift.
//
// A lift with no history has no suggestion and is shown as sets x reps
// alone. Inventing a starting weight here would be a number the user never
// gave us; the logger's demographic starting weights are the place for that.

import { suggestNext } from '@/lib/progressiveOverload';

// About two and a half minutes a working set, rest included. Only used to
// say "about 50 min", rounded to five, so it is a size, not a promise.
const MIN_PER_SET = 2.5;

function lastTopWeight(name, logs) {
  const lc = name.toLowerCase();
  for (const log of logs || []) {
    const ex = (log?.exercises || []).find((e) => (e?.name || '').toLowerCase() === lc);
    if (!ex) continue;
    const top = Math.max(0, ...(ex.sets || []).filter((s) => !s?.is_warmup).map((s) => Number(s?.weight) || 0));
    if (top > 0) return top;
  }
  return null;
}

/**
 * @param {object} regimen   a regimens row (exercises jsonb)
 * @param {Array}  logs      workout_logs, newest first
 * @returns {null | { name, lifts: Array<{ name, sets, reps, weight, last, change }>, sets, minutes }}
 *   weight and last are in lbs, null when unknown; change is 'up' | 'hold'
 *   | 'down' | null (no history).
 */
export function todaySession(regimen, logs = [], { now = new Date() } = {}) {
  if (!regimen) return null;
  const lifts = (regimen.exercises || [])
    .filter((ex) => ex && ex.kind !== 'cardio' && (ex.name || ex.displayName))
    .map((ex) => {
      const name = ex.name || ex.displayName;
      const sets = Number(ex.target_sets) || 3;
      const s = suggestNext(name, logs, { now });
      const last = lastTopWeight(name, logs);
      // No loaded history means bodyweight work (or none yet): sets x reps only,
      // never a suggested load the user never lifted.
      const weight = last != null && s?.weight > 0 ? s.weight : null;
      let change = null;
      if (weight != null && last != null) change = weight > last ? 'up' : weight < last ? 'down' : 'hold';
      return {
        name,
        sets,
        reps: Number(ex.target_reps) || s?.reps || null,
        weight,
        last,
        change,
      };
    });
  if (lifts.length === 0) return null;
  const sets = lifts.reduce((n, l) => n + l.sets, 0);
  return {
    name: regimen.name || '',
    lifts,
    sets,
    minutes: Math.max(10, Math.round((sets * MIN_PER_SET) / 5) * 5),
  };
}
