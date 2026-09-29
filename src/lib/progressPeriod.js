// src/lib/progressPeriod.js
//
// The period the Progress page summarises: this calendar week (Monday on),
// month or year, or all time. It used to be a rolling 7 / 30 / 365 days,
// which put three different "weeks" on one screen: the hero ring counts the
// calendar week, the stats card counted the last seven days, and the weekly
// review is an ISO week. With the ring reading 1 and the card reading 4 a
// scroll apart, one of them looked wrong (Progress audit, 2026-09-29).
//
// The comparison is like for like. "So far this week" is set against the
// same number of days at the start of last week, so a Monday is measured
// against last Monday rather than against a whole finished week, which is
// the demoralising case the rolling window was originally chosen to avoid.
//
// Pure: no React, no I/O. `now` is injectable for tests.

import {
  startOfDay, startOfWeek, startOfMonth, startOfYear,
  subWeeks, subMonths, subYears, addDays, differenceInCalendarDays,
} from 'date-fns';
import { parseLocalDate } from '@/lib/dateUtils';

export const PERIODS = ['week', 'month', 'year', 'all'];

/**
 * { start, prevStart, prevEnd } for a period, or null for 'all' (a lifetime
 * has no previous period). `start` is inclusive; `prevEnd` is exclusive and
 * sits the same number of days after `prevStart` as today is after `start`,
 * today included.
 */
export function periodBounds(period, now = new Date()) {
  if (!PERIODS.includes(period) || period === 'all') return null;
  const start = period === 'week' ? startOfWeek(now, { weekStartsOn: 1 })
    : period === 'month' ? startOfMonth(now)
      : startOfYear(now);
  const prevStart = period === 'week' ? subWeeks(start, 1)
    : period === 'month' ? subMonths(start, 1)
      : subYears(start, 1);
  const elapsedDays = differenceInCalendarDays(startOfDay(now), start) + 1;
  // A month or year can be shorter than the elapsed span (31 March against
  // February), so the previous window never runs into the current period.
  const prevEnd = new Date(Math.min(addDays(prevStart, elapsedDays).getTime(), start.getTime()));
  return { start, prevStart, prevEnd };
}

/** Rows whose local `date` falls in [from, to). `to` omitted = open-ended. */
export function rowsBetween(rows, from, to) {
  return (rows || []).filter((r) => {
    const d = r?.date ? parseLocalDate(r.date) : null;
    return !!d && d >= from && (!to || d < to);
  });
}

/** The current and previous-to-date rows for a period. prev is null for 'all'. */
export function splitByPeriod(rows, period, now = new Date()) {
  const b = periodBounds(period, now);
  if (!b) return { current: rows || [], prev: null };
  return {
    current: rowsBetween(rows, b.start),
    prev: rowsBetween(rows, b.prevStart, b.prevEnd),
  };
}
