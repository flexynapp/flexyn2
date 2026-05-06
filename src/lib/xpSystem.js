// XP System Configuration and Calculations
//
// Design goals:
//   - Easy tasks (water logging, short cardio) → small XP (2–30)
//   - Moderate workouts (30 min, ~10 sets) → ~150–300 XP
//   - Hard workouts (60 min, heavy compound lifts) → ~400–1000 XP
//   - Long cardio endurance (1h run / 2h bike) → ~200–600 XP
//   - Milestones and streaks feel meaningful but don't trivialize regular play

const LEVEL_CONFIG = {
  MAX_LEVEL: 100,
  baseXpPerLevel: 150,      // halved from 300 — original curve put level 100 at
                            // ~11M total XP (~12 years of play). New target:
                            // level 50 in ~3 months, level 100 in ~1 year of
                            // dedicated training. Existing users will see their
                            // current level either hold or bump up on next save.
  exponentialGrowth: 1.10,
};

// Tiered growth so early levels feel quick, mid-game slows down, late-game is a grind.
// Multipliers tuned down from the original (1.10/1.13/1.16/1.18/1.22) to make
// level 100 a realistic year-long goal rather than a decade-long one.
function getLevelMultiplier(level) {
  if (level <= 10)  return 1.05; // very gentle early — first few levels in a session
  if (level <= 30)  return 1.07;
  if (level <= 60)  return 1.09;
  if (level <= 80)  return 1.11;
  return 1.13;                   // late-game grind, but reachable
}

// Total XP needed to reach a given level from 0
export function getTotalXpForLevel(level) {
  if (level <= 1) return 0;
  let totalXp = 0;
  for (let i = 1; i < level; i++) {
    totalXp += getXpForNextLevel(i);
  }
  return totalXp;
}

// XP needed to go from currentLevel → currentLevel+1
export function getXpForNextLevel(currentLevel) {
  const multiplier = getLevelMultiplier(currentLevel);
  return Math.floor(
    LEVEL_CONFIG.baseXpPerLevel * Math.pow(multiplier, Math.max(0, currentLevel - 1))
  );
}

// Derive level + progress from cumulative total XP
export function calculateLevelFromXp(totalXp) {
  let cumulativeXp = 0;

  for (let i = 1; i < LEVEL_CONFIG.MAX_LEVEL; i++) {
    const xpNeeded = getXpForNextLevel(i);
    if (cumulativeXp + xpNeeded > totalXp) {
      const currentLevelXp = totalXp - cumulativeXp;
      const progressPercent = (currentLevelXp / xpNeeded) * 100;
      return { level: i, xpInLevel: currentLevelXp, xpNeeded, progressPercent, totalXp };
    }
    cumulativeXp += xpNeeded;
  }

  return { level: LEVEL_CONFIG.MAX_LEVEL, xpInLevel: 0, xpNeeded: 0, progressPercent: 100, totalXp };
}

// ── Flat XP rewards for non-workout actions ───────────────────────────────────
export const XP_REWARDS = {
  // Nutrition / hydration — small but consistent
  waterGlass: 3,            // logging a glass of water

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

  const duration = Number(workout.duration_minutes) || 0;
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
  const minutes = duration_seconds / 60;

  // Base: 1.5 XP/min (up from 1.0 — cardio deserves more respect)
  const baseXp = minutes * 1.5;

  // Distance bonus: 1 XP per 200 m (was 250 m — slightly more rewarding)
  const distanceXp = (distance_meters || 0) / 200;

  // Calorie bonus: 1 XP per 20 kcal (was 25 — intensity bonus)
  const calorieXp = (calories || 0) / 20;

  // Intensity multiplier — if calories AND distance are logged, reward the data quality
  const hasFullData = (distance_meters || 0) > 0 && (calories || 0) > 0;
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

// ── Daily XP cap (anti-farming) ───────────────────────────────────────────────
// Prevents someone from submitting hundreds of micro-workouts to grind XP.
// The server-side function that calls updateUserXpAndAchievements should respect this.
export const DAILY_XP_CAP = 2500;
