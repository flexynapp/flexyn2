/**
 * workoutFatigue.js
 * Second layer of anti-cheat: detects physically implausible workout volume
 * based on user demographics and same-day history (strength + cardio combined).
 */

import { checkDailyHours, DAILY_HOUR_LIMITS } from './cardioLimits';
import { formatNumber } from './intl';

export function getMaxRealisticSetsPerWorkout(userProfile) {
  const birthYear = userProfile?.birthday
    ? new Date(userProfile.birthday).getFullYear()
    : 1990;
  const age = new Date().getFullYear() - birthYear;
  const weightLbs = userProfile?.weight_lbs || 160;
  const gender = userProfile?.gender || 'male';

  let baseSets = 25;

  if (age < 18) baseSets *= 0.80;
  else if (age <= 35) { /* no adjustment */ }
  else if (age <= 50) baseSets *= 0.85;
  else if (age <= 65) baseSets *= 0.70;
  else baseSets *= 0.55;

  if (weightLbs < 100) baseSets *= 0.75;
  else if (weightLbs > 300) baseSets *= 0.80;

  if (gender === 'female') baseSets *= 0.85;

  return Math.min(40, Math.max(5, Math.floor(baseSets)));
}

/**
 * Maximum working sets per muscle group in a single session, before
 * additional volume is physiologically pointless. These are upper-end
 * intermediate-lifter caps; values below 4 would block legitimate beginners.
 *
 * Keys must match the muscle-group keys used on exercise records
 * (see exercise.muscle_groups: ['chest', 'triceps', ...]).
 */
export const PER_MUSCLE_GROUP_SET_CAP = {
  chest: 12,
  back: 14,
  lats: 10,
  shoulders: 10,
  biceps: 10,
  triceps: 10,
  forearms: 8,
  legs: 16,
  quads: 12,
  hamstrings: 10,
  glutes: 12,
  calves: 12,
  core: 12,
  abs: 10,
  obliques: 8,
  traps: 8,
  fullBody: 20, // catch-all; rarely used as a primary tag
  cardio: 0,    // strength sets shouldn't be tagged cardio; defensive
};

/**
 * Per-muscle-group cap, demographic-adjusted. Uses the same age/gender
 * curves as the per-exercise and per-workout caps for consistency.
 */
export function getMuscleGroupCap(muscleKey, userProfile) {
  const base = PER_MUSCLE_GROUP_SET_CAP[muscleKey];
  if (base == null) return 12; // unknown group → conservative default

  const birthYear = userProfile?.birthday
    ? new Date(userProfile.birthday).getFullYear()
    : 1990;
  const rawAge = new Date().getFullYear() - birthYear;
  const age = Number.isFinite(rawAge) ? rawAge : 36;
  const gender = userProfile?.gender || 'male';

  let multiplier = 1.0;
  if (age < 18) multiplier = 0.80;
  else if (age <= 35) multiplier = 1.00;
  else if (age <= 50) multiplier = 0.90;
  else if (age <= 65) multiplier = 0.75;
  else multiplier = 0.60;

  if (gender === 'female') multiplier *= 0.90;

  const result = Math.floor(base * multiplier);
  return Math.max(3, result);
}

/**
 * Counts working sets touching each muscle group across an exercise list.
 * Each set with N tagged muscle groups counts once toward each group
 * (a bench set tagged ['chest', 'triceps', 'shoulders'] counts toward
 * all three — physiologically accurate, since they all receive stimulus).
 *
 * Returns: { chest: 6, triceps: 6, shoulders: 6, ... }
 */
export function countSetsPerMuscleGroup(exercises) {
  const counts = {};
  for (const ex of exercises || []) {
    const groups = ex.muscle_groups?.length
      ? ex.muscle_groups
      : (ex.muscle_group ? [ex.muscle_group] : []);
    const setCount = ex.sets?.length || 0;
    for (const g of groups) {
      counts[g] = (counts[g] || 0) + setCount;
    }
  }
  return counts;
}

/**
 * Realistic daily volume budget in lbs, scaled by demographics. Represents
 * the total weight-lifted ceiling for one person across all strength
 * sessions in a single day. An intermediate 190 lb lifter has roughly a
 * 38,000 lb daily budget; values above this are not physiologically
 * sustainable session-to-session.
 *
 * Reduced when the user has logged cardio that day, since concurrent
 * training meaningfully impairs strength capacity.
 */
export function getDailyVolumeBudget(userProfile, sameDateCardio = []) {
  const weightLbs = Number(userProfile?.weight_lbs) || 160;
  const birthYear = userProfile?.birthday
    ? new Date(userProfile.birthday).getFullYear()
    : 1990;
  const rawAge = new Date().getFullYear() - birthYear;
  const age = Number.isFinite(rawAge) ? rawAge : 36;
  const gender = userProfile?.gender || 'male';

  // Base: 200× bodyweight in lbs of total volume per day (intermediate ceiling).
  let budget = weightLbs * 200;

  if (age < 18) budget *= 0.85;
  else if (age <= 35) { /* no change */ }
  else if (age <= 50) budget *= 0.90;
  else if (age <= 65) budget *= 0.75;
  else budget *= 0.55;

  if (gender === 'female') budget *= 0.85;

  // Cardio cuts into the strength budget. 30 min moderate cardio ≈ 10% off.
  const cardioMinutes = (sameDateCardio || []).reduce((sum, l) =>
    sum + ((Number(l.duration_seconds) || 0) / 60), 0
  );
  const cardioPenalty = Math.min(0.40, (cardioMinutes / 30) * 0.10);
  budget *= (1 - cardioPenalty);

  return Math.floor(budget);
}

/**
 * Sums weight × reps across an exercise list. Mirrors the volume math
 * used in xpSystem.calculateTotalVolume but defined here too so the
 * fatigue module is self-contained.
 */
export function sumWorkoutVolume(exercises) {
  let total = 0;
  for (const ex of exercises || []) {
    for (const s of ex.sets || []) {
      total += (Number(s.weight) || 0) * (Number(s.reps) || 0);
    }
  }
  return total;
}

/**
 * Estimate workout session duration in minutes from exercise structure.
 * Assumes ~2 minutes rest + ~1 minute active per set.
 */
function estimateWorkoutMinutes(exercises) {
  const totalSets = (exercises || []).reduce((sum, ex) =>
    sum + (ex.sets?.length || 0), 0
  );
  return Math.ceil(totalSets * 3); // 3 min per set (rest + work) — conservative
}

/**
 * Detect a physically implausible workout session.
 *
 * @param {object} workout           — { date, exercises, duration_minutes? }
 * @param {object} userProfile       — demographics
 * @param {Array}  recentWorkoutLogs — all WorkoutLog records (any date), filtered to same date internally
 * @param {Array}  recentCardioLogs  — all CardioLog records (any date), filtered to same date internally
 */
export function detectImplausibleWorkout(
  workout,
  userProfile,
  recentWorkoutLogs,
  recentCardioLogs = [],  // ← new param; defaults to [] for backward compat
  language               // ← optional: pass useLanguage().language so volume/budget
                         //   render in the user's locale instead of the browser's.
                         //   Falls back to 'en' when omitted (legacy callers).
) {
  const exercises = workout.exercises || [];
  const maxSets = getMaxRealisticSetsPerWorkout(userProfile);

  // ── Rule A: total sets in this workout exceed user's single-session max ──
  const totalSets = exercises.reduce((sum, ex) => sum + (ex.sets?.length || 0), 0);
  if (totalSets > maxSets) {
    return {
      implausible: true,
      i18nKey: 'workout.warn.totalSetsExceeded',
      i18nParams: { totalSets, maxSets },
    };
  }

  // ── Rule B: single exercise exceeds the per-exercise realistic cap ──
  const perExerciseCap = getMaxSetsPerExercise(userProfile);
  for (const ex of exercises) {
    if ((ex.sets?.length || 0) > perExerciseCap) {
      return {
        implausible: true,
        i18nKey: 'workout.warn.singleExerciseSets',
        i18nParams: { exercise: ex.name, max: perExerciseCap },
      };
    }
  }

  // ── Early compute: filter same-date logs and cardio for reuse in Rules B4 & C onwards ──
  const sameDateLogs = (recentWorkoutLogs || []).filter(l => l.date === workout.date);
  const sameDateCardio = (recentCardioLogs || []).filter(l => l.date === workout.date);

  // ── Rule B2: per-muscle-group set cap exceeded in this session ──
  // Catches the "stack 4 chest exercises × 6 sets" cheese path.
  const groupCounts = countSetsPerMuscleGroup(exercises);
  for (const [group, count] of Object.entries(groupCounts)) {
    const cap = getMuscleGroupCap(group, userProfile);
    if (count > cap) {
      return {
        implausible: true,
        i18nKey: 'workout.warn.muscleGroupSets',
        i18nParams: { group, sets: count, max: cap },
      };
    }
  }

  // ── Rule B3: combined same-day per-muscle-group volume too high ──
  // Walks all already-saved logs for this date plus the new session,
  // counting working sets per muscle group across the whole day.
  const allDayExercises = [
    ...exercises,
    ...sameDateLogs.flatMap(l => l.exercises || []),
  ];
  const dailyGroupCounts = countSetsPerMuscleGroup(allDayExercises);
  for (const [group, count] of Object.entries(dailyGroupCounts)) {
    const cap = getMuscleGroupCap(group, userProfile);
    // Daily ceiling is 1.5× the single-session cap (allowing AM/PM splits).
    if (count > cap * 1.5) {
      return {
        implausible: true,
        i18nKey: 'workout.warn.muscleGroupDaily',
        i18nParams: { group, sets: count, max: Math.floor(cap * 1.5) },
      };
    }
  }

  // ── Rule B4: total daily volume exceeds physiological budget ──
  const sessionVolume = sumWorkoutVolume(exercises);
  const previousVolume = sameDateLogs.reduce((sum, l) =>
    sum + sumWorkoutVolume(l.exercises || []), 0
  );
  const dailyBudget = getDailyVolumeBudget(userProfile, sameDateCardio);
  const totalDailyVolume = sessionVolume + previousVolume;
  if (totalDailyVolume > dailyBudget) {
    return {
      implausible: true,
      i18nKey: 'workout.warn.dailyVolumeBudget',
      i18nParams: {
        volume: formatNumber(Math.round(totalDailyVolume), language),
        budget: formatNumber(Math.round(dailyBudget), language),
      },
    };
  }

  // ── Rule C: combined same-date workout volume is too high ──
  const alreadyLoggedSets = sameDateLogs.reduce((sum, log) =>
    sum + (log.exercises || []).reduce((s, ex) => s + (ex.sets?.length || 0), 0), 0
  );
  const combinedSets = alreadyLoggedSets + totalSets;
  if (combinedSets > maxSets * 1.5) {
    return {
      implausible: true,
      i18nKey: 'workout.warn.combinedVolume',
      i18nParams: { combinedSets: Math.round(combinedSets) },
    };
  }

  // ── Rule D: too many separate workout sessions on the same date ──
  const maxWorkoutsPerDay = 3;
  if (sameDateLogs.length >= maxWorkoutsPerDay) {
    return {
      implausible: true,
      i18nKey: 'workout.warn.tooManySessions',
      i18nParams: { count: sameDateLogs.length, max: maxWorkoutsPerDay },
    };
  }

  // ── Rule E: combined active hours on this date exceed daily limits ──
  // Includes all same-date workout sessions + cardio sessions + this new session.
  const newWorkoutMins = workout.duration_minutes ?? estimateWorkoutMinutes(exercises);
  const existingWorkoutMins = sameDateLogs.reduce((sum, l) =>
    sum + (Number(l.duration_minutes) || estimateWorkoutMinutes(l.exercises || [])), 0
  );

  const hoursCheck = checkDailyHours(
    [], // pass empty — we compute workout manually below to include "this" workout
    sameDateCardio,
    existingWorkoutMins + newWorkoutMins, // total workout mins including this one
    0
  );

  if (hoursCheck.implausible) {
    return {
      implausible: true,
      i18nKey: `workout.warn.${hoursCheck.reason}`,
      i18nParams: { hours: hoursCheck.hours, maxHours: hoursCheck.maxHours },
    };
  }

  // ── Rule F: any single muscle group exceeds its per-session cap ──
  // Combine sets from this workout AND all prior same-date workouts so
  // a user can't split a 30-set chest day into two sessions.
  const allSameDateExercises = [
    ...exercises,
    ...sameDateLogs.flatMap(l => l.exercises || []),
  ];
  const muscleGroupSets = countSetsPerMuscleGroup(allSameDateExercises);
  for (const [group, count] of Object.entries(muscleGroupSets)) {
    if (group === 'cardio') continue; // defensive — cardio tag on strength sets
    const cap = getMuscleGroupCap(group, userProfile);
    if (count > cap) {
      return {
        implausible: true,
        i18nKey: 'workout.warn.muscleGroupVolume',
        i18nParams: { group, count, cap },
      };
    }
  }

  // ── Rule G: total daily volume (lbs) exceeds the demographic budget ──
  // Covers edge cases where many light-weight / high-rep sets accumulate
  // to unrealistic daily tonnage without triggering the set-count rules.
  const budgetedVolume = getDailyVolumeBudget(userProfile, sameDateCardio);
  const thisWorkoutVolume = sumWorkoutVolume(exercises);
  const priorDayVolume = sameDateLogs.reduce(
    (sum, l) => sum + sumWorkoutVolume(l.exercises || []), 0
  );
  const totalDayVolume = thisWorkoutVolume + priorDayVolume;
  if (budgetedVolume > 0 && totalDayVolume > budgetedVolume) {
    return {
      implausible: true,
      i18nKey: 'workout.warn.dailyVolumeBudget',
      i18nParams: {
        totalVolume: Math.round(totalDayVolume / 1000), // display in k-lbs
        budgetVolume: Math.round(budgetedVolume / 1000),
      },
    };
  }

  // ── Rule H: cardio-interference — heavy cardio same day significantly
  //    reduces realistic strength capacity; enforce a tighter set budget. ──
  const cardioMinutesToday = sameDateCardio.reduce(
    (sum, l) => sum + ((Number(l.duration_seconds) || 0) / 60), 0
  );
  if (cardioMinutesToday >= 45) {
    // After 45+ min of cardio, realistic strength volume drops ≈25%.
    const adjustedMax = Math.floor(maxSets * 0.75);
    if (totalSets > adjustedMax) {
      return {
        implausible: true,
        i18nKey: 'workout.warn.cardioInterference',
        i18nParams: { cardioMinutes: Math.round(cardioMinutesToday), adjustedMax },
      };
    }
  }

  return { implausible: false, i18nKey: null, i18nParams: {} };
}

/**
 * Returns the maximum number of sets per single exercise per session.
 * Tightened to a 3–6 range — beyond 6 working sets per exercise,
 * additional volume produces diminishing returns and is implausible
 * for a single session of one movement.
 */
export function getMaxSetsPerExercise(userProfile) {
  const birthYear = userProfile?.birthday
    ? new Date(userProfile.birthday).getFullYear()
    : 1990;
  const rawAge = new Date().getFullYear() - birthYear;
  const age = Number.isFinite(rawAge) ? rawAge : 36;
  const gender = userProfile?.gender || 'male';

  let base = 6;
  if (age < 18) base = 5;
  else if (age <= 35) base = 6;
  else if (age <= 50) base = 5;
  else if (age <= 65) base = 4;
  else base = 3;

  if (gender === 'female') base = Math.max(3, base - 1);

  const result = Math.min(6, Math.max(3, base));
  // Defensive: never return NaN/undefined — would silently disable the cap.
  return Number.isFinite(result) ? result : 5;
}