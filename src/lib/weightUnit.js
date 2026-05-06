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
  const n = Number(lbs);
  if (lbs == null || !Number.isFinite(n)) return '—';
  const converted = fromLbs(n, unit);
  const dp = decimals ?? (unit === 'kg' ? 1 : unit === 'stone' ? 2 : 0);
  return `${converted.toFixed(dp)} ${unit}`;
}

/** Same as formatWeight but returns just the number string (no unit suffix) */
export function formatWeightNumber(lbs, unit, decimals) {
  const n = Number(lbs);
  if (lbs == null || !Number.isFinite(n)) return '';
  const converted = fromLbs(n, unit);
  const dp = decimals ?? (unit === 'kg' ? 1 : unit === 'stone' ? 2 : 0);
  return converted.toFixed(dp);
}
