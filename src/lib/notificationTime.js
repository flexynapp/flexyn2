// src/lib/notificationTime.js
//
// Day bucketing + the timestamp that renders on a notification row.
//
// This replaces date-fns `formatDistanceToNow`, which both notification
// surfaces called with NO locale — so "3 hours ago" rendered in English
// under a screen that was otherwise fully translated, in all 15 languages.
// That is the trap the i18n section of CLAUDE.md documents: translation keys
// don't cover dates, and English can never show you the bug.
//
// Built on `Intl` rather than date-fns locales, per the same section: pulling
// in date-fns/locale would put 15 locale bundles on the startup path to
// reproduce something the platform already ships.
//
// Shape of the output, and why:
//
//   today      → relative, narrow    "5 min ago" / "hace 5 min" / "5分前"
//   yesterday  → clock time          "6:40 PM" / "18:40"
//   earlier    → short date          "Aug 4" / "4 ago"
//
// Only today is relative. Past that the section header already says which
// day it was, so a relative string would be repeating the header in a
// grammar that is much harder to get right in fifteen languages — and it is
// longer, in a 74px column. `Intl.RelativeTimeFormat` handles the pluralised
// cases the old `||`-style fallbacks never could.

import { toBcp47 } from '@/lib/intlFormat';

export const BUCKET = { TODAY: 'today', YESTERDAY: 'yesterday', EARLIER: 'earlier' };

function startOfDay(d) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

export function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value == null) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Which day-group a row belongs to. Compares CALENDAR days in the viewer's
 * own timezone, not elapsed hours — something posted at 11pm is "yesterday"
 * at 1am, not "2 hours ago and also today".
 */
export function bucketFor(value, now = new Date()) {
  const d = toDate(value);
  if (!d) return BUCKET.EARLIER;
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return BUCKET.TODAY;
  if (days === 1) return BUCKET.YESTERDAY;
  return BUCKET.EARLIER;
}

/**
 * The short timestamp for a row.
 *
 * @param {Date|string|number} value
 * @param {string} language  app language code ('en', 'es', …)
 * @param {Date}   [now]
 */
export function formatNotificationTime(value, language, now = new Date()) {
  const d = toDate(value);
  if (!d) return '';
  const locale = toBcp47(language);
  const bucket = bucketFor(d, now);

  try {
    if (bucket === BUCKET.TODAY) {
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' });
      const secs = Math.round((d - now) / 1000);
      const mins = Math.round(secs / 60);
      // Clamp a clock-skewed future stamp to "now" rather than rendering
      // "in 3 minutes" for a row that has already arrived.
      if (mins >= 0) return rtf.format(0, 'minute');
      if (mins > -60) return rtf.format(mins, 'minute');
      return rtf.format(Math.round(mins / 60), 'hour');
    }
    if (bucket === BUCKET.YESTERDAY) {
      return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(d);
    }
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(d);
  } catch {
    // A bad language code must not blank the whole column.
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
  }
}

/**
 * Split rows into day-groups, preserving the incoming (newest-first) order.
 * Returns `[{ bucket, rows }]` with empty groups dropped, so a list holding
 * only old rows renders one "Earlier" header rather than three headers and
 * two blanks.
 */
export function groupByDay(rows, now = new Date()) {
  const order = [BUCKET.TODAY, BUCKET.YESTERDAY, BUCKET.EARLIER];
  const groups = new Map(order.map(b => [b, []]));
  for (const r of rows) groups.get(bucketFor(r?.created_at, now)).push(r);
  return order
    .map(bucket => ({ bucket, rows: groups.get(bucket) }))
    .filter(g => g.rows.length > 0);
}
