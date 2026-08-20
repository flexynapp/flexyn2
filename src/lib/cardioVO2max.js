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
 * READ THIS BEFORE USING IT PER SESSION. The formula is
 * `15 × HRmax / HRrest`, and BOTH of those come from the profile — HRmax
 * from age, HRrest from the stored resting rate. It therefore returns the
 * SAME number for every session a user ever logs. It is an estimate of the
 * athlete, not of the workout.
 *
 * `avgHr` is a GATE, not an input: it is validated and then deliberately
 * unused, because its only job here is to prove the user actually recorded
 * heart rate for this session rather than leaving the field blank. That
 * looked like a bug on audit — a parameter checked and discarded — so it is
 * spelled out rather than left to be rediscovered.
 *
 * The consequence is in `bestVO2max` below: this must not preempt the
 * speed-based estimate, which does vary with the session.
 *
 * @param {number} avgHr    — average heart rate during exercise (bpm). Gate only.
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
  // SPEED FIRST for running. This ordering used to be the other way round,
  // and the comment justifying it said HR was "more accurate" — which is
  // true of the formula in general and false of what it does here. The HR
  // estimate is `15 × HRmax/HRrest`, both profile constants, so it is the
  // same number for every session; the speed estimate is derived from the
  // distance and duration of THIS one. Trying HR first meant that the
  // moment a user filled in a resting heart rate, every run they logged
  // reported an identical VO2max and the session-specific figure was
  // discarded. Latent rather than live only because `resting_heart_rate`
  // is unset on every production profile today.
  if (mode === 'running') {
    const speedBased = vo2maxFromSpeed(distanceMeters, durationSeconds);
    if (speedBased !== null) return speedBased;
  }
  // HR-based is the FALLBACK: it is the only option for a ride or a swim,
  // where there is no validated speed model, and for a run too short or
  // too slow for the ACSM range.
  if (avgHr && restHr) {
    const hrBased = vo2maxFromHR(avgHr, restHr, age);
    if (hrBased !== null) return hrBased;
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
  // `id` is what a render site resolves `cardio.vo2max.tier.<id>` from. The
  // English stays here as the fallback so this module renders identically
  // when called from a context with no translator.
  if (vo2max >= 60) return { id: 'elite', label: 'Elite', color: 'text-purple-500' };
  if (vo2max >= 52) return { id: 'excellent', label: 'Excellent', color: 'text-blue-500' };
  if (vo2max >= 44) return { id: 'good', label: 'Good', color: 'text-green-500' };
  if (vo2max >= 36) return { id: 'average', label: 'Average', color: 'text-amber-500' };
  if (vo2max >= 28) return { id: 'belowAverage', label: 'Below Average', color: 'text-orange-500' };
  return { id: 'poor', label: 'Poor', color: 'text-red-500' };
}
