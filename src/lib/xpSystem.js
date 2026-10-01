// XP System Configuration and Calculations
//
// Design goals:
//   - Easy tasks (water logging, short cardio) → small XP (2–30)
//   - Moderate workouts (30 min, ~10 sets) → ~150–300 XP
//   - Hard workouts (60 min, heavy compound lifts) → ~400–1000 XP
//   - Long cardio endurance (1h run / 2h bike) → ~200–600 XP
//   - Milestones and streaks feel meaningful but don't trivialize regular play

import { workoutDurationMin } from '@/lib/workoutDuration';

const LEVEL_CONFIG = {
  MAX_LEVEL: 100,
  baseXpPerLevel: 100,      // cost of level 1 → 2
};

// Growth rate per level, banded by tier. Two properties matter here and the
// previous curve had neither:
//
//   1. CONTINUITY. The cost of level N+1 is the cost of level N times the
//      growth rate for that band — it compounds forward. The old version
//      computed `base * multiplier^(level-1)` with a *different* multiplier
//      per band, which re-based every level below the boundary and produced
//      cliffs: L60→L61 jumped 3.2x and L80→L81 jumped 4.6x in a single level.
//      That is also why the shipped curve put level 100 at 192,438,890 XP —
//      659 years at a realistic 800 XP/day, and 17x worse than the ~11M curve
//      it was written to replace.
//
//   2. DECELERATION. The rate goes DOWN as you climb, not up. A steep
//      percentage on a small number feels fast (L1→L2 is 100 XP); a gentle
//      percentage on a large number stays reachable (L99→L100 is 23,401 XP,
//      about a month of dedicated training). Accelerating the rate on top of
//      an already-exponential base is what makes late levels unreachable.
//
// Resulting pace at a steady 800 XP/day (one solid workout plus hydration):
//   L10 ≈ 2 days · L25 ≈ 11 days · L50 ≈ 2.5 months · L100 ≈ 2.2 years.
// Share of the total ladder per band: 0.3% / 2.1% / 15.0% / 29.0% / 53.6%,
// so all ten cosmetic tiers in xpTier.js sit somewhere a real person passes
// through. Largest jump at any band boundary is 1.11x.
//
// To retune the pace, change these five numbers — the shape stays valid as
// long as they are non-increasing.
function getLevelMultiplier(level) {
  if (level <= 10)  return 1.110; // fast, tiny numbers — several levels in week one
  if (level <= 30)  return 1.085;
  if (level <= 60)  return 1.050;
  if (level <= 80)  return 1.040;
  return 1.030;                   // late-game is long, but it ends
}

// Cumulative XP thresholds, built once at module load.
//
// CUMULATIVE[n] = total XP required to reach level n+1.
// PER_LEVEL[n]  = XP required to go from level n+1 to level n+2.
//
// Precomputing also removes the old O(n^2) behaviour, where
// getTotalXpForLevel(100) re-derived every preceding level from scratch.
const PER_LEVEL = [];
const CUMULATIVE = [];
{
  let cost = LEVEL_CONFIG.baseXpPerLevel;
  let total = 0;
  for (let level = 1; level < LEVEL_CONFIG.MAX_LEVEL; level++) {
    PER_LEVEL.push(Math.floor(cost));
    CUMULATIVE.push(total);
    total += Math.floor(cost);
    cost *= getLevelMultiplier(level);
  }
  CUMULATIVE.push(total); // total to reach MAX_LEVEL
}

// Total XP needed to reach a given level from 0
export function getTotalXpForLevel(level) {
  if (level <= 1) return 0;
  const clamped = Math.min(level, LEVEL_CONFIG.MAX_LEVEL);
  return CUMULATIVE[clamped - 1];
}

// XP needed to go from currentLevel → currentLevel+1.
// Returns 0 at MAX_LEVEL — there is no next level to buy.
export function getXpForNextLevel(currentLevel) {
  if (currentLevel < 1) return PER_LEVEL[0];
  if (currentLevel >= LEVEL_CONFIG.MAX_LEVEL) return 0;
  return PER_LEVEL[currentLevel - 1];
}

// Derive level + progress from cumulative total XP
export function calculateLevelFromXp(totalXp) {
  const xp = Math.max(0, Number(totalXp) || 0);

  for (let i = 1; i < LEVEL_CONFIG.MAX_LEVEL; i++) {
    const xpNeeded = PER_LEVEL[i - 1];
    const cumulativeXp = CUMULATIVE[i - 1];
    if (cumulativeXp + xpNeeded > xp) {
      const currentLevelXp = xp - cumulativeXp;
      const progressPercent = (currentLevelXp / xpNeeded) * 100;
      return { level: i, xpInLevel: currentLevelXp, xpNeeded, progressPercent, totalXp: xp };
    }
  }

  return { level: LEVEL_CONFIG.MAX_LEVEL, xpInLevel: 0, xpNeeded: 0, progressPercent: 100, totalXp: xp };
}

// Total XP to max out. Exported so surfaces that want to show
// "you are X% of the way to 100" don't re-derive it.
export const TOTAL_XP_FOR_MAX_LEVEL = CUMULATIVE[LEVEL_CONFIG.MAX_LEVEL - 1];
export const MAX_LEVEL = LEVEL_CONFIG.MAX_LEVEL;

// ── Flat XP rewards for non-workout actions ───────────────────────────────────
export const XP_REWARDS = {
  // Water pays nothing per glass. The server pays league points once a day
  // at the water goal (sync_my_logging_points, migration 20261001170000).

  // Goals
  goalCompleted: 100,       // completing any active goal (up from 75)

  // Regimen building — rewards planning effort
  regimenCreated: 60,
  fifth_regimen: 120,
  tenth_regimen: 250,

  // Workout count milestones — landmark moments
  first_workout:     50,    // first ever workout saved
  tenth_workout:    150,
  fiftieth_workout: 400,
  hundredth_workout: 750,

  // Achievements (value passed in from the achievement definition)
  achievementUnlocked: (xpReward) => xpReward,
};

// ── Goal completion XP ───────────────────────────────────────────────────────
// Computed and paid on the server by complete_goal (migration
// 20260927204000, goal_xp), capped at 100 per goal and 500 a day. The
// client formula that used to live here sent its own number.

// ── Workout XP: strength ─────────────────────────────────────────────────────
// Tuned so:
//   - A 20-min beginner session (light weight, 6 sets) ≈ 60–90 XP
//   - A 45-min intermediate session (moderate weight, 15 sets) ≈ 200–350 XP
//   - A 60-min advanced session (heavy compound, 20 sets) ≈ 500–900 XP
//
// Weight multiplier tiers — based on relative 1RM percentages so a 200 lb
// deadlift is "heavy" for a beginner but "moderate" for an advanced lifter.
// Thresholds are absolute lbs because the input is always in lbs.

function getWeightMultiplier(weight) {
  if (weight <= 0)   return 0;
  if (weight < 25)   return 0.6;  // very light / warmup
  if (weight < 50)   return 0.8;  // light
  if (weight < 95)   return 1.0;  // moderate
  if (weight < 135)  return 1.3;  // intermediate
  if (weight < 185)  return 1.7;  // heavy
  if (weight < 225)  return 2.1;  // very heavy
  if (weight < 275)  return 2.6;  // elite
  return 3.2;                     // world-class / powerlifter territory
}

// Hard cap per single strength session — prevents abuse of the per-set formula
export const MAX_WORKOUT_XP = 1000;

export function calculateWorkoutXp(workout) {
  if (!workout?.exercises || workout.exercises.length === 0) return 0;

  let repXp = 0;
  let totalVolume = 0;

  for (const exercise of workout.exercises) {
    for (const set of exercise.sets || []) {
      const weight = Number(set.weight) || 0;
      const reps   = Number(set.reps)   || 0;
      totalVolume += weight * reps;

      if (weight > 0 && reps > 0) {
        // Core formula: reps × weight-multiplier × scale factor
        // Scale factor (0.7) keeps per-set contribution in the 2–20 XP range
        repXp += reps * getWeightMultiplier(weight) * 0.7;
      } else if (reps > 0) {
        // Bodyweight set — flat 0.5 XP per rep, capped at 20 XP/set
        repXp += Math.min(reps * 0.5, 20);
      }
    }
  }

  // Via the shared accessor because this scores TWO shapes: the payload
  // Workout.jsx is about to save (now keyed `duration_min`) and the AI
  // Coach's in-memory plans (still `duration_minutes`, and correctly so —
  // those never touch the table). Reading one key would have silently
  // zeroed the duration bonus for whichever shape it did not match.
  const duration = workoutDurationMin(workout);
  const setCount = workout.exercises.reduce((sum, ex) => sum + (ex.sets?.length || 0), 0);

  const baseSetXp  = setCount * 12;             // 12 XP per set (up from 8)
  const volumeXp   = Math.floor(totalVolume / 400); // 1 XP per 400 lbs volume (tighter than 500)
  const durationXp = Math.floor(duration / 10) * 4; // 4 XP per 10 min (up from 3)

  const rawXp = baseSetXp + repXp + volumeXp + durationXp;
  return Math.min(Math.round(rawXp), MAX_WORKOUT_XP);
}

// ── Workout XP: cardio ───────────────────────────────────────────────────────
// Tuned so:
//   - 20 min easy jog ≈ 40–70 XP
//   - 45 min run with distance ≈ 120–180 XP
//   - 2h bike ride (20 km) ≈ 300–500 XP
//   - Elite ultra effort ≈ ~600 XP (hard cap)
//
// Formula rewards duration (base), distance (effort), and calorie burn (intensity).

export const MAX_CARDIO_XP = 600; // up from 400

export function calculateCardioXp({ duration_seconds, distance_meters, calories }) {
  if (!duration_seconds || duration_seconds <= 0) return 0;
  // Floor negative-ish inputs at zero before computing bonuses. A
  // client-side bug or GPS noise that produced `distance_meters: -100`
  // used to offset the duration XP. Same for negative calories.
  // (Audit 17 #F10.)
  const safeDistance = Math.max(0, Number(distance_meters) || 0);
  const safeCalories = Math.max(0, Number(calories)        || 0);
  const minutes = duration_seconds / 60;

  // Base: 1.5 XP/min (up from 1.0 — cardio deserves more respect)
  const baseXp = minutes * 1.5;

  // Distance bonus: 1 XP per 200 m (was 250 m — slightly more rewarding)
  const distanceXp = safeDistance / 200;

  // Calorie bonus: 1 XP per 20 kcal (was 25 — intensity bonus)
  const calorieXp = safeCalories / 20;

  // Intensity multiplier — if calories AND distance are logged, reward the data quality
  const hasFullData = safeDistance > 0 && safeCalories > 0;
  const intensityBonus = hasFullData ? 1.10 : 1.0; // 10% bonus for complete logging

  const raw = (baseXp + distanceXp + calorieXp) * intensityBonus;
  return Math.min(Math.round(raw), MAX_CARDIO_XP);
}

// ── Volume helper ─────────────────────────────────────────────────────────────
export function calculateTotalVolume(exercises) {
  let totalVolume = 0;
  for (const exercise of exercises || []) {
    for (const set of exercise.sets || []) {
      totalVolume += (Number(set.weight) || 0) * (Number(set.reps) || 0);
    }
  }
  return totalVolume;
}

// ── Daily XP caps live on the SERVER, not here ───────────────────────────────
//
// There used to be a `DAILY_XP_CAP = 2500` exported from this file, described
// as anti-farming. Nothing ever read it — not this module, not the server, not
// a single call site. Its only reference was a test asserting it equalled
// 2500. Meanwhile the real enforced ceiling was 50,000/day, twenty times the
// number this file advertised, so the constant actively misled anyone reading
// it to understand the economy.
//
// Removed rather than corrected: a mirrored constant is how the level curve
// came to disagree with the database in the first place (see migration 261).
// The caps have exactly one home, and it is SQL:
//
//   grant_action_xp    (migrations 198, 262, 286, 298) — per-action, per-day,
//     bucketed by the LIFTER'S local date, returning what it credited:
//     workout_completed 4000 · cardio_completed 2400 · goal_completed 500
//     regimen_created 200 · comeback_bonus 200 · crew_xp_fuel 100
//     recipe_created 75 · meal_logged 30 · anything unclassified 0
//
//   sync_my_logging_points (migration 20261001170000) — league points the
//     server derives from saved rows: photo_meal 30 · barcode_meal 20 ·
//     water_goal_met 20 (water pays only at the goal, never per glass);
//     bounty_completed 100 and league_quest 600 are paid by their own RPCs.
//
//   increment_user_xp      (migrations 203, 261) — global 50,000 per rolling
//     24h, enforced against xp_grant_log, and not callable by `authenticated`.
//
// Migration 298 closed the last path around all of that: claim_crew_xp_fuel
// called increment_user_xp directly with a CLIENT-supplied amount, so a chat
// button was worth up to 1,000 XP a tap against no daily ceiling at all.
//
// Client-side caps that DO still apply are the per-session ones above:
// MAX_WORKOUT_XP and MAX_CARDIO_XP bound a single submission before it is
// sent. They are advisory — the server re-caps regardless — but they keep the
// number the UI celebrates equal to the number that lands.
