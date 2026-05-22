// src/lib/timeUntil.js
//
// Short-form "time until X" formatter for countdowns. Built for the
// story-expiration pill ("Expires in 4h 12m") but reusable wherever a
// countdown to a near-future ISO timestamp is helpful.
//
// Returns:
//   "5h 12m"  — when the gap is >= 1 hour
//   "38m"     — when the gap is < 1 hour and >= 1 minute
//   "< 1m"    — when the gap is positive but < 60 seconds
//   null      — when the timestamp has already passed (or is invalid)
//
// Intentionally short-form English. i18n can be a follow-up — most
// story strings are still English-fallback today.

export function formatTimeUntil(iso, now = Date.now()) {
  if (!iso) return null;
  const target = typeof iso === 'string' ? Date.parse(iso) : new Date(iso).getTime();
  if (Number.isNaN(target)) return null;
  const deltaMs = target - now;
  if (deltaMs <= 0) return null;
  const totalMinutes = Math.floor(deltaMs / 60_000);
  if (totalMinutes < 1) return '< 1m';
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
