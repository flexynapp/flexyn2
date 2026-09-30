// src/lib/cardioLimits.js
// Physics-based bounds for cardio activity validation.
// All limits are generous enough to accommodate elite athletes
// while catching impossible manual entries.
//
// Speed references:
//   Walking world record race-walk: 14.8 km/h (Suzuki, 2015) — we cap at 14
//   Running world record marathon avg: 20.8 km/h (Kiptum, 2023) — we cap at 28
//   Cycling hour record: 56 km/h (Ganna, 2022) — we cap at 75
//
// Calorie reference: MET × body_weight_kg × duration_hours
//   Max sustained MET for running ≈ 14 (elite marathon). We allow MET 18 as
//   the absolute ceiling — generous enough that no real athlete is blocked.

import { workoutDurationMin } from '@/lib/workoutDuration';

/**
 * Speed limits (km/h) per cardio type.
 * Keys match the `type` field stored on CardioLog.
 */
export const CARDIO_SPEED_LIMITS = {
  walking_outside:      { minKmh: 0.5, maxKmh: 14.0 },
  walking_treadmill:    { minKmh: 0.5, maxKmh: 14.0 },
  running_outside:      { minKmh: 2.0, maxKmh: 28.0 },
  running_treadmill:    { minKmh: 2.0, maxKmh: 28.0 },
  biking_outside:       { minKmh: 2.0, maxKmh: 75.0 },
  biking_stationary:    { minKmh: 2.0, maxKmh: 60.0 },
  biking_treadmill:     { minKmh: 2.0, maxKmh: 60.0 },
  // Swimming: elite short-course sprinters reach ~8 km/h; recreational ~1-3 km/h
  swimming_pool:        { minKmh: 0.2, maxKmh: 9.0 },
  swimming_openwater:   { minKmh: 0.2, maxKmh: 8.0 },
};

const DEFAULT_SPEED_LIMIT = { minKmh: 0.5, maxKmh: 75.0 };

/**
 * Get speed limits for a given cardio type.
 */
export function getSpeedLimits(type = '') {
  return CARDIO_SPEED_LIMITS[type] || DEFAULT_SPEED_LIMIT;
}

/**
 * Compute avg speed in km/h from raw inputs.
 * Returns null if either input is zero/missing.
 */
export function avgSpeedKmh(distanceMeters, durationSeconds) {
  if (!distanceMeters || !durationSeconds || durationSeconds <= 0) return null;
  return (distanceMeters / 1000) / (durationSeconds / 3600);
}

/**
 * Maximum realistic calories for a session.
 * Uses MET-based formula with demographic body weight.
 * @param {number} durationSeconds
 * @param {object} userProfile  — needs weight_lbs or falls back to 70kg
 * @param {number} [maxMet=18]  — absolute MET ceiling (18 = sprint-level sustained)
 */
export function getMaxRealisticCalories(durationSeconds, userProfile = {}, maxMet = 18) {
  const weightKg = userProfile.weight_lbs
    ? userProfile.weight_lbs * 0.453592
    : 70;
  const hours = durationSeconds / 3600;
  return Math.round(maxMet * weightKg * hours);
}

/**
 * Daily active-hour limits across all activity types.
 * These are deliberately generous to accommodate ultramarathon
 * athletes and people who do both strength + long cardio on the
 * same day. They catch only physically impossible entries.
 */
export const DAILY_HOUR_LIMITS = {
  workoutHours:  4,   // total strength workout time in one day
  cardioHours:   12,  // total cardio time in one day (ultramarathon territory)
  combinedHours: 14,  // workout + cardio combined in one day
};

/**
 * Check whether a cardio entry's speed is implausible for its type.
 * Returns { implausible: true, speedKmh, limit } or { implausible: false }.
 */
// Absolute single-session distance ceiling. Even the longest ultras (Spartathlon
// 246 km, Badwater 217 km) finish under this cap — anything beyond is a typo
// or a deliberate cheat attempt.
const MAX_SESSION_DISTANCE_METERS = 250_000;

export function checkCardioSpeed(type, distanceMeters, durationSeconds) {
  // Absolute distance sanity check — fires even when duration is missing.
  // Catches "submitted 1,000,000 m run with no time" cheat attempts that the
  // speed-based check ignores.
  if (distanceMeters && distanceMeters > MAX_SESSION_DISTANCE_METERS) {
    return {
      implausible: true,
      reason: 'distance_ceiling',
      distanceMeters,
      maxDistanceMeters: MAX_SESSION_DISTANCE_METERS,
    };
  }

  // Speed check requires both distance AND duration; bail if either is missing.
  if (!distanceMeters || distanceMeters <= 0 || !durationSeconds || durationSeconds <= 0) {
    return { implausible: false };
  }
  const speed = avgSpeedKmh(distanceMeters, durationSeconds);
  if (speed === null) return { implausible: false };
  const { maxKmh } = getSpeedLimits(type);
  if (speed > maxKmh) {
    return { implausible: true, reason: 'speed', speedKmh: Math.round(speed * 10) / 10, maxKmh };
  }
  return { implausible: false };
}

/**
 * Compute total daily active hours from existing logs.
 * @param {Array} workoutLogs   — WorkoutLog records for the same date
 * @param {Array} cardioLogs    — CardioLog records for the same date
 * @param {number} newWorkoutMins  — minutes being added (0 if cardio entry)
 * @param {number} newCardioSecs   — seconds being added (0 if workout entry)
 */
export function checkDailyHours(workoutLogs, cardioLogs, newWorkoutMins = 0, newCardioSecs = 0) {
  // The saved column is `duration_min`; reading `duration_minutes` here
  // counted every saved workout as zero minutes. workoutDurationMin reads
  // the real column and tolerates the in-memory spelling.
  const existingWorkoutMins = workoutLogs.reduce((sum, l) =>
    sum + workoutDurationMin(l), 0
  );
  const existingCardioSecs = cardioLogs.reduce((sum, l) =>
    sum + (Number(l.duration_seconds) || 0), 0
  );

  const totalWorkoutHours = (existingWorkoutMins + newWorkoutMins) / 60;
  const totalCardioHours  = (existingCardioSecs  + newCardioSecs)  / 3600;
  const totalCombinedHours = totalWorkoutHours + totalCardioHours;

  const { workoutHours, cardioHours, combinedHours } = DAILY_HOUR_LIMITS;

  if (totalWorkoutHours > workoutHours) {
    return {
      implausible: true,
      reason: 'workout_hours',
      hours: +totalWorkoutHours.toFixed(1),
      maxHours: workoutHours,
    };
  }
  if (totalCardioHours > cardioHours) {
    return {
      implausible: true,
      reason: 'cardio_hours',
      hours: +totalCardioHours.toFixed(1),
      maxHours: cardioHours,
    };
  }
  if (totalCombinedHours > combinedHours) {
    return {
      implausible: true,
      reason: 'combined_hours',
      hours: +totalCombinedHours.toFixed(1),
      maxHours: combinedHours,
    };
  }
  return { implausible: false };
}