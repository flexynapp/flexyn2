// src/lib/nutritionAdherence.js
//
// How a day's calories sit against the goal, and — the part that matters — the
// difference between "you ate nothing" and "you logged nothing".
//
// The old history stat divided total calories by the number of day-groups, and
// a day whose only rows were water counted as a logged 0-calorie day. That is
// how 5 sparse days turned into "631 avg cal/day" against a 2,000 goal: a
// number that reads as starvation when it actually means gaps in logging.
//
// `adherenceOf` returns null for an unlogged day so callers cannot accidentally
// paint it as a zero-height bar, and `summarise` divides by logged days and
// hands back the denominator so the UI can state it.

// `label` is the English fallback for `adherence.<key>`, resolved in
// HistoryCalendarSheet's legend.
export const ADHERENCE = {
  over:  { key: 'over',  label: 'Over',      css: 'hsl(var(--primary))', text: 'text-primary' },
  on:    { key: 'on',    label: 'On target', css: 'hsl(var(--success))', text: 'text-success' },
  under: { key: 'under', label: 'Under',     css: 'hsl(var(--info))',    text: 'text-info' },
};

export const OVER_AT = 1.15;
export const UNDER_AT = 0.7;

/** @returns one of ADHERENCE, or null when the day was never logged. */
export function adherenceOf(calories, goal) {
  const cal = Number(calories);
  if (!Number.isFinite(cal) || cal <= 0) return null;
  const ratio = goal > 0 ? cal / goal : 1;
  if (ratio > OVER_AT) return ADHERENCE.over;
  if (ratio < UNDER_AT) return ADHERENCE.under;
  return ADHERENCE.on;
}

/**
 * Roll a `[{ date, calories }]` series up for display.
 *
 * `avg` is over logged days only, and `logged` / `total` are returned so the
 * caller can print the denominator instead of implying one.
 */
export function summarise(series = [], goal = 0) {
  const logged = series.filter(d => Number(d?.calories) > 0);
  // `logged` answers "how many days do the calorie stats average over"; a day
  // whose only meal totals 0 cal must not enter that mean. `recorded` answers
  // the different question "on how many days did you log at all", which is what
  // a consistency count and a calendar cell are actually claiming. A series that
  // does not carry the flag falls back to the calorie test, so old callers keep
  // their old numbers.
  const recorded = series.filter(d => (d?.logged != null ? d.logged : Number(d?.calories) > 0));
  const sum = logged.reduce((acc, d) => acc + Number(d.calories), 0);
  const counts = { over: 0, on: 0, under: 0 };
  for (const day of logged) {
    const tone = adherenceOf(day.calories, goal);
    if (tone) counts[tone.key] += 1;
  }
  return {
    avg: logged.length ? Math.round(sum / logged.length) : 0,
    total: series.length,
    logged: logged.length,
    recorded: recorded.length,
    peak: logged.length ? Math.round(Math.max(...logged.map(d => Number(d.calories)))) : 0,
    counts,
  };
}

/** Longest run of consecutive days on which anything was logged. */
export function longestStreak(series = []) {
  let best = 0;
  let run = 0;
  for (const day of series) {
    const on = day?.logged != null ? day.logged : Number(day?.calories) > 0;
    if (on) { run += 1; best = Math.max(best, run); }
    else run = 0;
  }
  return best;
}
