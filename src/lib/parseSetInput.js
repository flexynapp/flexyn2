// src/lib/parseSetInput.js
//
// Tiny parser for "smart paste" into the workout logger. When the user
// pastes a string like "225 x 8" into the weight field, we recognize
// the shape, extract both weight and reps, and offer the caller a
// chance to fill both fields atomically. The reward is the "wait, how
// did it know?" moment that makes power users feel the app understands
// them. Pattern lifted from how Strong / Hevy users instinctively
// already write down sets.
//
// Supported shapes (all case-insensitive, whitespace-tolerant):
//   "225 x 8"        weight=225, reps=8
//   "225x8"          same (no spaces)
//   "225 × 8"        same (Unicode × multiplication sign)
//   "225 @ 8"        same (@ is common in lifting notation)
//   "225 8 reps"     same (trailing "reps")
//   "225lb x 8"      same, with unit hint "lb"
//   "100 kg x 12"    weight=100, reps=12, unit="kg"
//   "100kg 12reps"   same, no separator
//
// Returns `null` when the string doesn't match any recognized shape so
// the caller can fall through to default paste behavior.

const SEPARATOR = '(?:\\s*[x×@]\\s*|\\s+)';
const UNIT      = '(?:\\s*(lbs?|kgs?))?';
const REPS_TAIL = '(?:\\s*reps?)?';

// Pattern A: "weight [unit] sep reps [reps]"
// Pattern B (fallback): "weight unit reps [reps]" — no explicit separator needed when unit is present
const PATTERN_A = new RegExp(
  `^\\s*(\\d+(?:\\.\\d+)?)${UNIT}${SEPARATOR}(\\d+)${REPS_TAIL}\\s*$`,
  'i'
);

/**
 * Parse a pasted set string. Returns `{ weight, reps, unit }` on
 * success, or `null` if the input doesn't look like a set.
 *
 * `weight` is the raw number as typed (caller decides whether to
 * convert to lbs based on `unit`). `reps` is an integer. `unit` is
 * one of 'lb'|'kg' or null if not specified.
 */
export function parseSetInput(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const m = trimmed.match(PATTERN_A);
  if (!m) return null;

  const weight = parseFloat(m[1]);
  const reps = parseInt(m[3], 10);
  if (!Number.isFinite(weight) || !Number.isFinite(reps)) return null;
  if (weight < 0 || reps < 0) return null;

  // Bound reps at a generous max so "225 x 9999" doesn't silently
  // become a junk entry — the realistic-limits clamp in SetRow will
  // tighten this further per exercise.
  if (reps > 100) return null;

  const unitRaw = (m[2] || '').toLowerCase();
  const unit = unitRaw.startsWith('lb') ? 'lb'
             : unitRaw.startsWith('kg') ? 'kg'
             : null;

  return { weight, reps, unit };
}
