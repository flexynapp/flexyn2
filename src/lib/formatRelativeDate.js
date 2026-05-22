// src/lib/formatRelativeDate.js
//
// One universal cascading format for every timestamp the user sees.
// Mixed date formats across an app are a quality smell — it screams
// "different developers wrote different parts." This helper makes
// every "when did X happen" rendering follow the same shape:
//
//   < 1 minute ago   → "just now"
//   < 1 hour          → "23m ago"
//   today (same day) → "Today at 4:23 PM"
//   yesterday        → "Yesterday at 4:23 PM"
//   < 7 days          → "Monday at 4:23 PM"
//   same year        → "May 12"
//   older            → "May 12, 2024"
//
// Variants:
//   'standard'  full cascade above
//   'short'     drops "at HH:MM" — useful for compact rows
//                 ("Today" / "Mon" / "May 12")
//   'withTime'  always includes time-of-day, even for older dates
//
// Locale-aware: pass a date-fns locale via the `locale` option. Without
// one, falls back to en-US conventions. Future dates work via the
// sign-flipped "in X" cascade (used for scheduled workouts, recovery
// dates, etc).

import {
  differenceInMinutes,
  differenceInCalendarDays,
  isToday,
  isYesterday,
  format,
  isAfter,
} from 'date-fns';

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function inOrAgo(value, now, includeTime, locale) {
  const past = isAfter(now, value);
  const minutes = Math.abs(differenceInMinutes(value, now));
  const days = Math.abs(differenceInCalendarDays(value, now));

  if (minutes < 1) return past ? 'just now' : 'in a moment';

  if (minutes < 60) {
    const m = Math.round(minutes);
    return past ? `${m}m ago` : `in ${m}m`;
  }

  // Today (calendar-day, honoring local timezone). Short variant
  // drops the "at HH:MM" suffix for compact rows.
  if (isToday(value)) {
    if (!includeTime) return 'Today';
    const t = format(value, 'p', { locale });
    return `Today at ${t}`;
  }

  if (isYesterday(value)) {
    if (!includeTime) return 'Yesterday';
    const t = format(value, 'p', { locale });
    return `Yesterday at ${t}`;
  }

  // Within the past or upcoming week (calendar days).
  if (days < 7) {
    const day = format(value, 'EEEE', { locale });
    const t = format(value, 'p', { locale });
    return includeTime ? `${day} at ${t}` : day;
  }

  // Same year — drop the year.
  const sameYear = value.getFullYear() === now.getFullYear();
  if (sameYear) {
    const md = format(value, 'MMM d', { locale });
    return includeTime ? `${md} at ${format(value, 'p', { locale })}` : md;
  }

  // Older / further future — full date.
  const mdy = format(value, 'MMM d, yyyy', { locale });
  return includeTime ? `${mdy} at ${format(value, 'p', { locale })}` : mdy;
}

/**
 * Format a date relative to `now` (defaults to `new Date()`).
 *
 * @param {Date|string|number} value
 * @param {object} [opts]
 * @param {Date} [opts.now]
 * @param {'standard'|'short'|'withTime'} [opts.variant]
 * @param {object} [opts.locale]  date-fns locale, e.g. `import('date-fns/locale/es')`
 * @returns {string}
 */
export function formatRelativeDate(value, opts = {}) {
  const date = toDate(value);
  if (!date) return '';
  const now = opts.now instanceof Date ? opts.now : new Date();
  const variant = opts.variant || 'standard';
  const includeTime = variant !== 'short';
  return inOrAgo(date, now, includeTime, opts.locale);
}
