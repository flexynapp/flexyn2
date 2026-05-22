// src/lib/deloadDetector.js
//
// Heuristic for detecting when a user is overdue for a deload week.
// Triggered from the workout-save success path — soft toast suggests
// pulling back next week. Non-blocking, non-spammy: only fires when
// the user has stacked HIGH volume relative to their own baseline for
// 3+ weeks running.
//
// THE HEURISTIC
// ─────────────
//   1. Compute weekly volume totals for the last 8 weeks
//   2. Compute the rolling 4-week mean + stddev of the EARLIER 4 weeks
//      (weeks 5-8 ago, the user's "normal" baseline)
//   3. For each of the last 3 weeks, check if its volume is > mean + 2σ
//   4. If all 3 most-recent weeks are above the 2σ threshold → deload
//
// Returns null when:
//   • Not enough history (< 8 weeks of logs)
//   • Baseline stddev is too low (user always trains the same volume —
//     no deviation signal)
//   • Recent weeks aren't elevated

import { startOfWeek, differenceInCalendarWeeks } from 'date-fns';

function calcVolume(log) {
  let v = 0;
  for (const ex of log?.exercises || []) {
    for (const s of ex?.sets || []) {
      // Skip warmups when computing the deload signal — they're not
      // representative of true working load.
      if (s?.is_warmup) continue;
      v += (Number(s?.weight) || 0) * (Number(s?.reps) || 0);
    }
  }
  return v;
}

/**
 * Returns { suggest: true, weeksElevated, latestVolume, baselineMean }
 * when a deload is warranted; null otherwise.
 */
export function detectDeloadOpportunity(workoutLogs = [], now = new Date()) {
  if (!Array.isArray(workoutLogs)) return null;
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });

  // Bucket logs into the 8 most recent weeks. weekOffset 0 = current week.
  const weeklyTotals = Array(8).fill(0);
  for (const log of workoutLogs) {
    const raw = log?.date || log?.created_at;
    if (!raw) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    const offset = differenceInCalendarWeeks(weekStart, startOfWeek(d, { weekStartsOn: 1 }), { weekStartsOn: 1 });
    if (offset < 0 || offset > 7) continue;
    weeklyTotals[offset] += calcVolume(log);
  }

  // Need actual data in the baseline window (weeks 5-7 ago, indices 4..7).
  const baseline = weeklyTotals.slice(4);
  const baselineCount = baseline.filter(v => v > 0).length;
  if (baselineCount < 2) return null;

  const baselineMean = baseline.reduce((a, b) => a + b, 0) / 4;
  if (baselineMean <= 0) return null;
  const variance = baseline.reduce((a, b) => a + Math.pow(b - baselineMean, 2), 0) / 4;
  const std = Math.sqrt(variance);
  // If the user's baseline is too rigid (e.g., always the same total),
  // any "2σ" call is noise. Require a minimum coefficient of variation
  // for the signal to be meaningful.
  const cv = std / baselineMean;
  if (cv < 0.05) return null;

  const threshold = baselineMean + 2 * std;
  const recent = weeklyTotals.slice(0, 3); // current week + last 2

  // Check that ALL 3 recent weeks exceed the threshold.
  const allElevated = recent.every(v => v > threshold);
  if (!allElevated) return null;

  return {
    suggest:         true,
    weeksElevated:   3,
    latestVolume:    Math.round(recent[0]),
    baselineMean:    Math.round(baselineMean),
  };
}
