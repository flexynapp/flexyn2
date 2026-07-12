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

  // Per-signal breakdown so the UI can show the user EXACTLY which
  // inputs produced this number — value they logged (or that we
  // defaulted to a neutral estimate), the 0-100 sub-score it earned,
  // its weight, and the points it contributed to the final total.
  // `logged: false` means the user hasn't given us that signal and we
  // leaned on a neutral 70.
  let daysSince = null;
  if (lastWorkoutAt) {
    const d = lastWorkoutAt instanceof Date ? lastWorkoutAt : new Date(lastWorkoutAt);
    if (!Number.isNaN(d.getTime())) daysSince = Math.max(0, differenceInCalendarDays(now, d));
  }
  // Apportion the point contributions with the largest-remainder method
  // so the four displayed values sum EXACTLY to `score` — otherwise
  // independently rounding each (e.g. 17.5→18 and 10.5→11) can make the
  // rows read 71 while the headline says 70, which is exactly the
  // "why is my score that number?" confusion this breakdown exists to kill.
  const parts = [
    { key: 'sleep',    logged: typeof sleepHours === 'number',                     value: sleepHours ?? null,   sub: sleepScore,    weight: 0.40 },
    { key: 'quality',  logged: typeof sleepQuality === 'number' && sleepQuality > 0, value: sleepQuality ?? null, sub: qualityScore,  weight: 0.20 },
    { key: 'soreness', logged: typeof soreness === 'number' && soreness > 0,        value: soreness ?? null,     sub: sorenessScore, weight: 0.25 },
    { key: 'recency',  logged: !!lastWorkoutAt,                                     value: daysSince,            sub: recencyScore,  weight: 0.15 },
  ];
  const raw = parts.map((p) => p.sub * p.weight);
  const floors = raw.map((r) => Math.floor(r));
  let leftover = score - floors.reduce((a, b) => a + b, 0);
  const byFrac = raw
    .map((r, i) => ({ i, frac: r - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  const contribs = [...floors];
  for (let k = 0; k < byFrac.length && leftover > 0; k++) { contribs[byFrac[k].i] += 1; leftover -= 1; }

  const breakdown = {};
  parts.forEach((p, i) => {
    breakdown[p.key] = {
      logged: p.logged,
      value: p.value,
      score: Math.round(p.sub),
      weight: p.weight,
      contribution: Math.max(0, contribs[i]),
    };
  });

  return { score, label, color, breakdown };
}

function labelForScore(score) {
  if (score >= 80) return { label: 'Primed',    color: 'emerald' };
  if (score >= 65) return { label: 'Ready',     color: 'green'   };
  if (score >= 50) return { label: 'Moderate',  color: 'amber'   };
  if (score >= 35) return { label: 'Tired',     color: 'orange'  };
  return            { label: 'Depleted',        color: 'rose'    };
}
