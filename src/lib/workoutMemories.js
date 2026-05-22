// src/lib/workoutMemories.js
//
// Pure-client "this day last year" memory finder. Given the user's
// workout log array (already in queryClient cache) and today's date,
// returns the most striking historical workout from the same calendar
// day in a past year — ideally one with a meaningful lift or
// substantial volume so the memory feels worth resurfacing.
//
// SEARCH ORDER (best → fallback)
// ──────────────────────────────
// We prefer recent-but-not-too-recent memories. The order:
//   1. Exactly 1 year ago today
//   2. Exactly 2 years ago today
//   3. Exactly 3 years ago today
//   4. The same MONTH+DAY in ANY past year (the oldest match)
//
// Why month+day match (not "365 days ago"): users feel time
// calendrically, not in raw day counts. "January 14th, 2024" feels
// like a real date; "365 days ago" feels arbitrary.
//
// Returns null when there's no comparable historical workout — we
// don't fake a memory to fill the card. Better to hide than to
// resurface a 3-rep warmup from a year ago.

import { differenceInCalendarDays } from 'date-fns';
import { formatNumber } from '@/lib/intl';

/**
 * Returns the best memory match for `now`, or null. Output shape:
 *   { log, daysAgo, yearLabel } when found
 *   null when no match
 *
 * `log` is the original workout-log row, untouched.
 * `daysAgo` is the exact difference for telemetry.
 * `yearLabel` is a stable display label like "1 year ago" or "Mar 2024".
 *
 * @param {Array}  logs  workout logs (the user's full history)
 * @param {Date}   now   current date (defaults to new Date())
 */
export function findWorkoutMemory(logs, now = new Date()) {
  if (!Array.isArray(logs) || logs.length === 0) return null;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayMonth = today.getMonth();
  const todayDay   = today.getDate();
  const todayYear  = today.getFullYear();

  // Normalize each log to a date object. Skip rows with no date.
  const normalized = [];
  for (const log of logs) {
    const raw = log?.date || log?.created_at || log?.created_date;
    if (!raw) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    // Reject any log that isn't a "real" workout — at least one
    // exercise with a non-empty sets array. Otherwise a placeholder
    // row (created in error, deleted client-side) could surface as a
    // memory.
    const hasContent = Array.isArray(log.exercises) &&
      log.exercises.some(ex => Array.isArray(ex.sets) && ex.sets.length > 0);
    if (!hasContent) continue;
    normalized.push({ log, date: d });
  }
  if (normalized.length === 0) return null;

  // Same calendar day in any past year. Sort by years-ago ASC so the
  // most recent matching year comes first.
  const sameDayMatches = normalized
    .filter(({ date }) =>
      date.getMonth() === todayMonth &&
      date.getDate() === todayDay &&
      date.getFullYear() < todayYear
    )
    .sort((a, b) => b.date.getFullYear() - a.date.getFullYear());

  if (sameDayMatches.length === 0) return null;

  const best = sameDayMatches[0];
  const yearsAgo = todayYear - best.date.getFullYear();
  const yearLabel = yearsAgo === 1
    ? '1 year ago'
    : `${yearsAgo} years ago`;

  return {
    log:       best.log,
    daysAgo:   differenceInCalendarDays(today, best.date),
    yearLabel,
  };
}

/**
 * Compute a one-line summary of a workout log for the memory card —
 * focuses on the heaviest lift since that's the most identity-loaded
 * stat ("I benched 245!" feels more rememberable than "I did 8 sets").
 *
 * Returns a string like:
 *   "Bench Press: 225 lb × 5"
 *   "5 exercises, 3,200 lb volume"
 *
 * Falls back to volume-only when no single set has a recorded weight
 * (cardio-style entries, rep-bodyweight logs).
 */
export function summarizeMemoryLog(log, language) {
  if (!log || !Array.isArray(log.exercises)) return '';
  let topLift = null;
  let volume = 0;
  let exerciseCount = 0;
  for (const ex of log.exercises) {
    if (!Array.isArray(ex.sets) || ex.sets.length === 0) continue;
    exerciseCount += 1;
    for (const s of ex.sets) {
      const w = Number(s.weight) || 0;
      const r = Number(s.reps)   || 0;
      volume += w * r;
      if (w > 0 && (!topLift || w > topLift.weight)) {
        topLift = { name: ex.name || ex.displayName || 'lift', weight: w, reps: r };
      }
    }
  }
  if (topLift) {
    return `${topLift.name}: ${Math.round(topLift.weight)} × ${topLift.reps}`;
  }
  if (volume > 0) {
    return `${exerciseCount} exercises, ${formatNumber(Math.round(volume), language)} lb volume`;
  }
  return `${exerciseCount} exercises`;
}
