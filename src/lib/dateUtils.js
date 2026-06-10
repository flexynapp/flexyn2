// src/lib/dateUtils.js
//
// Shared date helpers. The most important one — parseLocalDate — fixes
// a class of bug that has surfaced multiple times in the audit: when
// Postgres returns a `DATE` column as the bare string 'YYYY-MM-DD', the
// JS built-in `new Date('YYYY-MM-DD')` interprets it as UTC midnight,
// which is the PREVIOUS local day for any user west of UTC during their
// evening. That silently shifts streak counts, "days since last
// workout" math, and per-day cache keys by one day at the boundary.
//
// Always run user-facing date strings through parseLocalDate before
// passing them to date-fns / Math arithmetic.

/**
 * Parse a date value as a LOCAL Date object.
 * - 'YYYY-MM-DD' (or 'YYYY-MM-DD…') → constructed in local TZ, never UTC.
 * - Anything else (timestamps, ISO with time component) → delegates to
 *   `new Date(value)` since those already carry an explicit offset.
 * - Falsy / unparseable → null.
 */
export function parseLocalDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
    // Date-only-with-time-prefix like '2025-11-22T00:00:00' is also
    // ambiguous when consumed without a Z — leave it to the JS Date
    // constructor since the time component is already explicit.
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Format a Date as a LOCAL 'YYYY-MM-DD' string.
 *
 * DO NOT use `d.toISOString().slice(0, 10)` for this — that returns the
 * UTC calendar day, which is off by one for part of every day in any
 * non-UTC timezone (tomorrow for users east of UTC in their evening,
 * yesterday for users west of UTC in their early morning).
 *
 * @param {Date} d
 * @returns {string|null}  'YYYY-MM-DD' in the local timezone, or null
 *                         for a missing / Invalid Date input.
 */
export function toLocalDateString(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Today's date as a LOCAL 'YYYY-MM-DD' string.
 */
export function todayLocalDateString() {
  return toLocalDateString(new Date());
}
