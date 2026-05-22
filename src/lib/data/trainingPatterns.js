// src/lib/data/trainingPatterns.js
//
// "You usually train Mon / Wed / Fri at 6:30 PM." Surfaces the user's
// own training schedule as a soft insight on Progress. Reads from
// already-fetched workout logs — no additional server queries.
//
// Method:
//   1. Take the most recent 8 weeks of workout logs (configurable).
//   2. Aggregate by dayOfWeek + hour-of-day in user's local time.
//   3. A day "counts" if it has >= MIN_OCCURRENCES occurrences across
//      the window (default 4 — roughly biweekly).
//   4. Among qualifying days, compute the MEDIAN hour-of-day (rounded
//      to half-hour) so an occasional 10 PM session doesn't shift the
//      pattern.
//   5. Return { days: ['Mon','Wed','Fri'], medianHourLabel: '6:30 PM' }
//      or null when there isn't enough data to call a pattern.

import { differenceInWeeks } from 'date-fns';

const MIN_OCCURRENCES = 4;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Compute the user's training pattern from a list of workout logs.
 *
 * @param {Array<{ date: string, created_at?: string }>} logs
 * @param {object} [opts]
 * @param {number} [opts.weeksBack=8]   How far back to look.
 * @param {Date}   [opts.now=new Date()]
 * @returns {{ days: string[], medianHourLabel: string, samples: number } | null}
 */
export function computeTrainingPattern(logs = [], { weeksBack = 8, now = new Date() } = {}) {
  if (!Array.isArray(logs) || logs.length === 0) return null;

  const recent = logs.filter((log) => {
    const ts = log?.created_at || log?.date;
    if (!ts) return false;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return false;
    return differenceInWeeks(now, d) <= weeksBack;
  });
  if (recent.length === 0) return null;

  // Count occurrences per day-of-week + collect hours per day.
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const hoursByDow = Array.from({ length: 7 }, () => []);
  for (const log of recent) {
    const ts = log?.created_at || log?.date;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) continue;
    const dow = d.getDay();
    counts[dow] += 1;
    hoursByDow[dow].push(d.getHours() + d.getMinutes() / 60);
  }

  const qualifyingDows = counts
    .map((c, i) => ({ dow: i, count: c }))
    .filter((d) => d.count >= MIN_OCCURRENCES)
    .sort((a, b) => b.count - a.count);
  if (qualifyingDows.length === 0) return null;

  // Pool ALL qualifying days' hours for the median (a user with a
  // 6 PM Mon and a 7 AM Sat shouldn't get one global median; in that
  // case the pattern is mixed — return median of the dominant day's
  // hours only).
  const dominant = qualifyingDows[0];
  const sortedHours = [...hoursByDow[dominant.dow]].sort((a, b) => a - b);
  const mid = sortedHours[Math.floor(sortedHours.length / 2)];
  if (!Number.isFinite(mid)) return null;

  const days = qualifyingDows
    .sort((a, b) => a.dow - b.dow)
    .map((d) => DAY_NAMES[d.dow]);

  return {
    days,
    medianHourLabel: formatHourLabel(mid),
    samples: recent.length,
  };
}

function formatHourLabel(hour) {
  // Round to nearest half-hour.
  const rounded = Math.round(hour * 2) / 2;
  const h = Math.floor(rounded);
  const m = (rounded - h) * 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m === 0 ? '00' : '30'} ${ampm}`;
}
