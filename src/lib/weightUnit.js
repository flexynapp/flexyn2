import { toBcp47 } from './intlFormat';

export const WEIGHT_UNITS = {
  lbs: 'lbs',
  kg: 'kg',
  stone: 'stone',
};

/**
 * Convert lbs (stored value) → display unit.
 *
 * IMPORTANT: Supabase returns numeric columns as STRINGS in some cases
 * (numeric/decimal types). The previous version returned the raw string
 * when unit === 'lbs', which then crashed downstream with
 * "n.toFixed is not a function" because strings lack that method.
 * Coerce to Number unconditionally; non-finite values become 0.
 */
export function fromLbs(lbs, unit) {
  const n = Number(lbs);
  if (!Number.isFinite(n)) return 0;
  if (unit === 'kg') return n / 2.20462;
  if (unit === 'stone') return n / 14;
  return n;
}

/** Convert display unit → lbs (stored value). Same coercion guard as fromLbs. */
export function toLbs(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (unit === 'kg') return n * 2.20462;
  if (unit === 'stone') return n * 14;
  return n;
}

/** Format a lbs-stored weight for display in user's unit */
export function formatWeight(lbs, unit, decimals) {
  // Empty string from an uncontrolled input had been falling through
  // as `Number('') === 0` → "0 lbs", which displayed a confident zero
  // where "—" was correct (the field was blank, not zero). Match the
  // null/NaN branch for any non-numeric or whitespace-only input.
  // (Audit 17 #T3.)
  if (lbs == null) return '—';
  if (typeof lbs === 'string' && lbs.trim() === '') return '—';
  const n = Number(lbs);
  if (!Number.isFinite(n)) return '—';
  const converted = fromLbs(n, unit);
  const dp = decimals ?? (unit === 'kg' ? 1 : unit === 'stone' ? 2 : 0);
  return `${groupedNumber(converted, dp)} ${unit}`;
}

// "18450 lbs" sat beside "5,000 XP" on the same screen (2026-10-02). The
// figure is grouped for reading, in the page's language: LanguageContext
// sets <html lang>, and this module stays free of React so data and pure
// callers can keep importing it. formatWeightNumber below is NOT grouped,
// because its output feeds inputs and Number() cannot parse "18,450".
function groupedNumber(n, dp) {
  let lang = 'en';
  try { lang = (typeof document !== 'undefined' && document.documentElement.lang) || 'en'; }
  catch { /* no DOM */ }
  try {
    return n.toLocaleString(toBcp47(lang), { minimumFractionDigits: dp, maximumFractionDigits: dp });
  } catch {
    return n.toFixed(dp);
  }
}

/** Same as formatWeight but returns just the number string (no unit suffix) */
export function formatWeightNumber(lbs, unit, decimals) {
  // Mirror formatWeight's empty-string guard so a blank input round-trips
  // as '' instead of being silently coerced to '0'. (Audit 17 #T3.)
  if (lbs == null) return '';
  if (typeof lbs === 'string' && lbs.trim() === '') return '';
  const n = Number(lbs);
  if (!Number.isFinite(n)) return '';
  const converted = fromLbs(n, unit);
  const dp = decimals ?? (unit === 'kg' ? 1 : unit === 'stone' ? 2 : 0);
  return converted.toFixed(dp);
}
