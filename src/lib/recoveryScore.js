// src/lib/recoveryScore.js
//
// Deterministic heuristic combining sleep + soreness + days-since-
// workout into a 0-100 recovery score. Higher = more ready to train.
// No AI — just sport-science-informed weighted averages with safe
// fallbacks when inputs are missing.
//
// FORMULA
// ───────
//   sleep_score      = clamp((hours / 8) * 100, 0, 100)
//   quality_score    = quality ? (quality / 5) * 100 : 70  (neutral)
//   soreness_score   = soreness ? ((6 - soreness) / 5) * 100 : 70
//   recency_score    = clamp(days_since_workout * 30 + 40, 0, 100)
//                      (0 days = 40, 1 day = 70, 2 days = 100, plateau)
//
//   weighted = sleep * 0.4
//            + quality * 0.2
//            + soreness * 0.25
//            + recency * 0.15
//
// Tiered labels:
//   ≥ 80  "Primed"
//   ≥ 65  "Ready"
//   ≥ 50  "Moderate"
//   ≥ 35  "Tired"
//   < 35  "Depleted"

import { differenceInCalendarDays } from 'date-fns';

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Compute a recovery score from optional inputs. Each input is
 * gracefully defaulted to a neutral middle value when missing, so a
 * brand-new user who has only logged sleep still gets a meaningful
 * score (rather than 0 or null).
 *
 * @param {object} inputs
 * @param {number} [inputs.sleepHours]
 * @param {number} [inputs.sleepQuality]    1-5
 * @param {number} [inputs.soreness]        1-5  (5 = very sore = bad)
 * @param {Date|string} [inputs.lastWorkoutAt]
 * @param {Date}   [inputs.now]
 * @returns {{ score: number, label: string, color: string }}
 */
export function computeRecoveryScore({
  sleepHours,
  sleepQuality,
  soreness,
  lastWorkoutAt,
  now = new Date(),
} = {}) {
  // Sleep duration (40% weight).
  const sleepScore = typeof sleepHours === 'number'
    ? clamp((sleepHours / 8) * 100, 0, 100)
    : 70;

  // Sleep quality (20%). When missing, neutral 70.
  const qualityScore = typeof sleepQuality === 'number' && sleepQuality > 0
    ? clamp((sleepQuality / 5) * 100, 0, 100)
    : 70;

  // Soreness — INVERTED (5 = very sore → low score). When missing, 70.
  const sorenessScore = typeof soreness === 'number' && soreness > 0
    ? clamp(((6 - soreness) / 5) * 100, 0, 100)
    : 70;

  // Recency — 0 days since last workout = 40 (just trained, low recovery),
  // 1 day = 70, 2+ days = 100 (plateau). Missing = neutral 70.
  let recencyScore = 70;
  if (lastWorkoutAt) {
    const d = lastWorkoutAt instanceof Date ? lastWorkoutAt : new Date(lastWorkoutAt);
    if (!Number.isNaN(d.getTime())) {
      const days = Math.max(0, differenceInCalendarDays(now, d));
      recencyScore = clamp(days * 30 + 40, 0, 100);
    }
  }

  const weighted =
    sleepScore     * 0.40 +
    qualityScore   * 0.20 +
    sorenessScore  * 0.25 +
    recencyScore   * 0.15;

  const score = Math.round(weighted);
  const { label, color } = labelForScore(score);
  return { score, label, color };
}

function labelForScore(score) {
  if (score >= 80) return { label: 'Primed',    color: 'emerald' };
  if (score >= 65) return { label: 'Ready',     color: 'green'   };
  if (score >= 50) return { label: 'Moderate',  color: 'amber'   };
  if (score >= 35) return { label: 'Tired',     color: 'orange'  };
  return            { label: 'Depleted',        color: 'rose'    };
}
