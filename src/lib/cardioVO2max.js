// src/lib/cardioVO2max.js
//
// VO2max estimation helpers for completed cardio sessions.
//
// Two formulas are supported:
//
// 1. Speed-based (running only) — ACSM oxygen-cost model:
//    VO2max ≈ -4.60 + 0.182258 × v + 0.000104 × v²
//    where v = speed in m/min at sustainable effort.
//    Valid range: ~40–350 m/min (2.4–21 km/h).
//    Accuracy: ±10–15% — good enough for trend tracking.
//
// 2. Heart-rate based — Uth-Sørensen-Overgaard-Pedersen (2004):
//    VO2max ≈ 15 × (HRmax / HRresting)
//    Requires resting HR. We estimate HRmax = 220 - age when age is known.
//    Falls back to 190 when age is unknown.
//
// Returns null when insufficient data or inputs are out of valid range.

/**
 * Estimates VO2max from running speed (ACSM formula).
 * Only meaningful for sustained running efforts.
 *
 * @param {number} distanceMeters
 * @param {number} durationSeconds
 * @returns {number|null} mL/kg/min rounded to 1 decimal, or null
 */
export function vo2maxFromSpeed(distanceMeters, durationSeconds) {
  if (!distanceMeters || !durationSeconds) return null;
  if (distanceMeters < 400 || durationSeconds < 60) return null;
  const v = distanceMeters / (durationSeconds / 60); // m/min
  if (v < 40 || v > 350) return null;
  const vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v;
  return Math.round(vo2 * 10) / 10;
}

/**
 * Estimates VO2max from heart rate data (Uth-Sørensen method).
 *
 * @param {number} avgHr    — average heart rate during exercise (bpm)
 * @param {number} restHr   — resting heart rate (bpm), optional
 * @param {number} age      — user's age in years, optional
 * @returns {number|null} mL/kg/min rounded to 1 decimal, or null
 */
export function vo2maxFromHR(avgHr, restHr = null, age = null) {
  if (!avgHr || avgHr < 40 || avgHr > 220) return null;
  const hrMax = age ? Math.max(160, 220 - age) : 190;
  if (avgHr >= hrMax) return null;           // at/above max HR → invalid
  if (!restHr || restHr < 30 || restHr > 100) return null;
  const vo2 = 15 * (hrMax / restHr);
  return Math.round(vo2 * 10) / 10;
}

/**
 * Best available VO2max estimate for a cardio session.
 * Tries HR-based first (more accurate), falls back to speed-based for running.
 *
 * @param {object} params
 * @param {string}  params.mode           — 'running' | 'biking' | etc.
 * @param {number}  params.distanceMeters
 * @param {number}  params.durationSeconds
 * @param {number}  [params.avgHr]        — average exercise HR
 * @param {number}  [params.restHr]       — resting HR from user profile
 * @param {number}  [params.age]          — age from user profile
 * @returns {number|null}
 */
export function bestVO2max({ mode, distanceMeters, durationSeconds, avgHr, restHr, age }) {
  // HR-based is valid for any aerobic activity when resting HR is known
  if (avgHr && restHr) {
    const hrBased = vo2maxFromHR(avgHr, restHr, age);
    if (hrBased !== null) return hrBased;
  }
  // Speed-based only valid for running
  if (mode === 'running') {
    return vo2maxFromSpeed(distanceMeters, durationSeconds);
  }
  return null;
}

/**
 * Human-readable VO2max fitness tier.
 * Based on American College of Sports Medicine age-adjusted norms.
 * Returns a generic label (no age adjustment for brevity).
 */
export function vo2maxTier(vo2max) {
  if (vo2max === null || vo2max === undefined) return null;
  if (vo2max >= 60) return { label: 'Elite', color: 'text-purple-500' };
  if (vo2max >= 52) return { label: 'Excellent', color: 'text-blue-500' };
  if (vo2max >= 44) return { label: 'Good', color: 'text-green-500' };
  if (vo2max >= 36) return { label: 'Average', color: 'text-amber-500' };
  if (vo2max >= 28) return { label: 'Below Average', color: 'text-orange-500' };
  return { label: 'Poor', color: 'text-red-500' };
}
