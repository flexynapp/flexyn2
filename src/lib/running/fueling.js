// src/lib/running/fueling.js
//
// Turns a running plan's weekly training load into a concrete nutrition
// adjustment — how many extra calories the runs cost and how many carb grams
// to add on training days to fuel + recover. This is the bridge from the
// cardio plan (paces/splits) to the Nutrition diet plan.
//
// Energy: ~0.73 kcal per lb of bodyweight per mile — the standard gross
// estimate (bodyweight is by far the dominant factor; pace matters little for
// total calories). Carbs: endurance training runs on carbohydrate, and daily
// targets for runners sit at 5–10 g/kg. We route ~60% of the extra
// training-day energy to carbs (4 kcal/g) and leave the rest to the base
// plan's protein/fat split — a per-run-day top-up that nudges toward those
// targets on the days that actually need the fuel.

const KCAL_PER_LB_MILE = 0.73;
const CARB_KCAL = 4;
const CARB_FRACTION = 0.6;
// Warm-up + reps + cool-down when an interval session carries no distance/duration.
const INTERVAL_DEFAULT_MILES = 3;

/** Best-effort distance (miles) for one cardio session. */
export function sessionMiles(session = {}) {
  const m = Number(session.target_distance_m) || 0;
  if (m > 0) return m / 1609.344;
  const s = Number(session.target_duration_s) || 0;
  if (s > 0) return (s / 60) / 8; // ~8 min/mile blended tempo/easy
  return INTERVAL_DEFAULT_MILES;
}

/** Gross calories for a run of `miles` at the given bodyweight. */
export function runKcal(miles, bodyweightLbs) {
  return Math.round((Number(miles) || 0) * KCAL_PER_LB_MILE * (Number(bodyweightLbs) || 165));
}

/**
 * Weekly running load from a regimen's exercises.
 * @returns { runDays, weeklyKcal, perRunDayKcal, addCarbsG }
 */
export function weeklyRunningLoad(exercises = [], bodyweightLbs = 165) {
  const runs = (exercises || []).filter((e) => e?.kind === 'cardio');
  if (!runs.length) return { runDays: 0, weeklyKcal: 0, perRunDayKcal: 0, addCarbsG: 0 };
  const weeklyKcal = runs.reduce((sum, r) => sum + runKcal(sessionMiles(r), bodyweightLbs), 0);
  const perRunDayKcal = Math.round(weeklyKcal / runs.length);
  const addCarbsG = Math.round((perRunDayKcal * CARB_FRACTION) / CARB_KCAL);
  return { runDays: runs.length, weeklyKcal, perRunDayKcal, addCarbsG };
}
