// Builds the `user_profiles` payload that onboarding submits.
//
// Extracted from Onboarding.jsx so it can be tested directly. It was ~90 lines
// of unit conversion, clamping and three-tier payload assembly inlined in a
// click handler, reachable only by completing a 14-step flow against a live
// Supabase — so in practice it was never tested at all, and the two defects
// below sat in it. Pure: no React, no I/O, no `@/api/db` import (see the
// Profile cache section of CLAUDE.md).

/**
 * The CHECK constraints that actually exist on `user_profiles`, verified
 * against production 2026-08-05.
 *
 * The code here used to carry a comment claiming migration 073 enforced
 * `age 13–120`, `height_inches 36–96` and `weight_lbs 50–800`, and the clamps
 * were built around it. None of those three is real: there is NO age
 * constraint, and the two that exist are far wider than the comment said. The
 * whole three-tier save fallback was designed to survive 23514 errors that
 * mostly could not happen. Kept here as documentation, and asserted against by
 * the tests so the two can't drift apart again.
 */
/**
 * Shortest username the flow accepts.
 *
 * Lives here rather than in Onboarding.jsx because two places enforce it — the
 * Continue button and the availability pre-check — and they had drifted to 3
 * and 2, so a two-character name was never checked for availability: the user
 * sailed through the rest of the flow and found out it was taken when the
 * final save came back 23505, which bounced them from the reveal screen back
 * to the age step. One constant, one meaning.
 */
export const MIN_USERNAME_LENGTH = 2;

/**
 * Can the user leave the "Tell us about yourself" step?
 *
 * All three answers on that step are required, and sex was not: the buttons
 * could be left untouched and Continue still went through. That mattered more
 * than an unanswered question usually does, because sex feeds
 * `_demographicScale` in the workout generator (starting loads) and BMR — and
 * an unset value silently takes the conservative middle, so nobody ever saw a
 * consequence, they just got a plan calibrated on a guess.
 *
 * Requiring it is only fair because declining is one of the four options.
 * "Prefer not to say" records `prefer_not_to_say`, which lands on that same
 * middle value — so this asks the user to make a choice, not to disclose. It
 * is deliberately a separate value from `other`: "Other" states something
 * about the user's sex, declining does not, and only one of those is an answer
 * to the question. The maths treats them identically; the data does not.
 *
 * Extracted and named so the rule is testable. Inline in the JSX it was one
 * `&&` chain inside a 400-line component, reachable only by driving the real
 * flow, which is how it went this long without the third condition.
 */
export function canLeaveAboutStep({ username, usernameError, gender } = {}) {
  const named = String(username ?? '').trim().length >= MIN_USERNAME_LENGTH;
  return named && !usernameError && Boolean(gender);
}

export const DB_CHECK_BOUNDS = {
  height_inches: { min: 0, max: 108, exclusiveMin: true, constraint: 'user_profiles_height_inches_sane' },
  height_cm:     { min: 0, max: 275, exclusiveMin: true, constraint: 'user_profiles_height_cm_sane' },
  weight_lbs:    { min: 0, max: 1500, exclusiveMin: true, constraint: 'user_profiles_weight_lbs_sane' },
  weight_kg:     { min: 0, max: 700, exclusiveMin: true, constraint: 'user_profiles_weight_kg_sane' },
  // age has no CHECK constraint at all.
};

/**
 * What the onboarding steps can actually produce, which is what the payload is
 * clamped to. These are the UNION of each control's own range and the range
 * its sibling unit converts into — 90 cm rounds to 35 in, which is below the
 * inch control's own floor of 36, so clamping the inches to 36 would quietly
 * move a value the user legitimately set in cm.
 *
 * Every bound here sits inside DB_CHECK_BOUNDS with room to spare, which is
 * the property the test asserts: a payload built from any reachable UI state
 * cannot trip a constraint.
 */
export const PROFILE_RANGES = {
  age:      { min: 13, max: 100 },
  heightIn: { min: 35, max: 96 },
  heightCm: { min: 90, max: 245 },
  weightLb: { min: 77, max: 400 },
  weightKg: { min: 35, max: 181 },
};

/** Defaults mirroring DEFAULT_DATA.stats — used when a draft value is junk. */
const FALLBACKS = { age: 26, heightIn: 70, heightCm: 178, weightLb: 165, weightKg: 75 };

const LB_PER_KG = 2.20462;
const KG_PER_LB = 0.453592;

export function safeInt(v, fallback) {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

export function clampInt(n, { min, max }) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Resolve height and weight into BOTH units, NaN-safe and clamped.
 *
 * The conversions are spelled out because a previous version of this code had
 * a sign bug — it multiplied kg by 0.453592 (the lb→kg factor) to get pounds,
 * producing a 34 lb payload for a 75 kg user. That failed the weight check,
 * both fallback tiers failed with it, and every metric user was stranded on
 * the reveal screen with "Could not save your profile. Tap Save to retry."
 *
 *   lb → kg:  lb * 0.453592
 *   kg → lb:  kg * 2.20462
 */
export function resolveMeasurements(stats = {}) {
  const heightUnit = stats.heightUnit === 'cm' ? 'cm' : 'in';
  const weightUnit = stats.weightUnit === 'kg' ? 'kg' : 'lb';

  const heightIn = heightUnit === 'in'
    ? safeInt(stats.heightIn, FALLBACKS.heightIn)
    : Math.round(safeInt(stats.heightCm, FALLBACKS.heightCm) / 2.54);
  const heightCm = heightUnit === 'cm'
    ? safeInt(stats.heightCm, FALLBACKS.heightCm)
    : Math.round(safeInt(stats.heightIn, FALLBACKS.heightIn) * 2.54);

  const weightLb = weightUnit === 'lb'
    ? safeInt(stats.weightLb, FALLBACKS.weightLb)
    : Math.round(safeInt(stats.weightKg, FALLBACKS.weightKg) * LB_PER_KG);
  const weightKg = weightUnit === 'kg'
    ? safeInt(stats.weightKg, FALLBACKS.weightKg)
    : Math.round(safeInt(stats.weightLb, FALLBACKS.weightLb) * KG_PER_LB);

  return {
    age:      clampInt(safeInt(stats.age, FALLBACKS.age), PROFILE_RANGES.age),
    heightIn: clampInt(heightIn, PROFILE_RANGES.heightIn),
    heightCm: clampInt(heightCm, PROFILE_RANGES.heightCm),
    weightLb: clampInt(weightLb, PROFILE_RANGES.weightLb),
    weightKg: clampInt(weightKg, PROFILE_RANGES.weightKg),
    heightUnit,
    weightUnit,
  };
}

/**
 * Parse what someone typed into the height field, in the current unit.
 *
 * Returns a number in that unit, or `null` when the input can't be read as a
 * height — the caller keeps the previous value rather than committing a guess.
 *
 * ft·in accepts the shapes people actually type:
 *
 *   "70"     → 70 in         two digits ≥ the floor read as total inches
 *   "5"      → 60 in         a bare small number is feet, not inches
 *   "5'10"   → 70 in         also "5 10", "5.10", "5'10\""
 *   "511"    → 71 in         3-digit shorthand: feet, then inches
 *
 * That last one is the fix for audit 18 #9. The old regex matched `(\d{1,2})`
 * then `(\d{0,2})`, so "511" parsed as 51 feet 1 inch → 613 in → clamped to
 * the 96 in ceiling: someone typing their height the way half the US writes it
 * got 8'0" with no indication anything had gone wrong. The same path turned
 * "180" (a cm value typed while the toggle still said ft·in) into 8'0" too.
 * Now "511" reads as 5'11", and "180" — 1 foot 80 inches, which is not a
 * height — returns null and leaves the value alone.
 */
export function parseHeightInput(raw, unit) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;

  if (unit === 'cm') {
    const n = parseInt(trimmed.replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }

  // Explicit feet/inches: a separator is present.
  const separated = trimmed.match(/^(\d{1,2})\s*['’ .]\s*(\d{1,2})\s*["”]?$/);
  if (separated) {
    const ft = parseInt(separated[1], 10);
    const inch = parseInt(separated[2], 10);
    return inch < 12 ? ft * 12 + inch : null;
  }

  // Feet alone, marked as feet: "6'" is six feet, not an error.
  const feetOnly = trimmed.match(/^(\d{1,2})\s*['’]$/);
  if (feetOnly) {
    const ft = parseInt(feetOnly[1], 10);
    return ft >= 1 && ft <= 8 ? ft * 12 : null;
  }

  // Bare digits.
  const bare = trimmed.match(/^(\d{1,3})["”]?$/);
  if (!bare) return null;
  const digits = bare[1];
  const n = parseInt(digits, 10);

  if (digits.length === 3) {
    // Feet-then-inches shorthand. Rejecting inches ≥ 12 is what stops a cm
    // value pasted into the imperial field from being accepted as a height.
    const ft = Math.floor(n / 100);
    const inch = n % 100;
    return inch < 12 ? ft * 12 + inch : null;
  }
  // One or two digits: a total-inches height, or a small number of feet.
  // Anything between (like "34") is neither, and used to be read as 34 feet
  // and clamped to 8'0".
  if (n >= PROFILE_RANGES.heightIn.min) return n;
  return n >= 1 && n <= 8 ? n * 12 : null;
}

/**
 * Assemble the three save tiers.
 *
 * @param {object}  input.data  the onboarding draft
 * @param {string}  input.nowIso  completion timestamp (injected so this stays pure)
 * @returns {{ core, detail, full, minimal }}
 */
export function buildProfilePayload({ data, nowIso }) {
  const stats = data?.stats || {};
  const m = resolveMeasurements(stats);

  // Enough on its own to call onboarding "done". If every richer tier fails,
  // this is what gets the user into the app to fix details from Settings,
  // rather than stranding them on the reveal screen forever.
  const core = {
    username:                String(data?.username ?? '').trim(),
    onboarding_complete:     true,
    onboarding_completed:    true,
    onboarding_completed_at: nowIso,
  };

  const detail = {
    fitness_goals:     Array.isArray(data?.goal) ? data.goal.join(',') : (data?.goal || ''),
    fitness_goals_arr: Array.isArray(data?.goal) ? data.goal : [],
    fitness_level:     data?.level ?? null,
    training_days:     Array.isArray(data?.days) ? data.days : [],
    // Comma-joined stable IDS ('late_night'), never display labels — the
    // column is TEXT and used to hold whatever English the UI rendered, so its
    // meaning depended on the reader's locale.
    preferred_workout_time: Array.isArray(data?.preferredTime)
      ? data.preferredTime.join(',')
      : (data?.preferredTime || ''),
    // Age, height and weight are saved only when the user moved them off
    // the starting value. Continue works on every one of these steps, so an
    // untouched 26 / 5'10" / 165 lb was stored as the user's real stats and
    // read everywhere as an answer. Left out, the column stays NULL, which
    // every consumer already reads as unknown. The units are still saved.
    ...(stats.userTouchedAge ? { age: m.age } : {}),
    // NUMBERS, not strings. These four columns are `numeric`; the client used
    // to wrap them in String(), a leftover from when they were TEXT. Postgres
    // accepted the quoted form via an implicit cast, so it worked — but it
    // meant any non-numeric string would raise 22P02 and fall into the tier-2
    // and tier-3 fallbacks instead of failing where the mistake was.
    ...(stats.userTouchedHeight ? { height_cm: m.heightCm, height_inches: m.heightIn } : {}),
    height_unit:   m.heightUnit === 'cm' ? 'metric' : 'imperial',
    ...(stats.userTouchedWeight ? { weight_kg: m.weightKg, weight_lbs: m.weightLb } : {}),
    weight_unit:   m.weightUnit === 'kg' ? 'kg' : 'lbs',
    // Biological sex (mig 161) — drives sex-specific strength ceilings, volume
    // caps and BMR. NULL when unset; consumers treat NULL as their own
    // default. updateMe's strip-and-retry drops it on pre-mig-158 hosts.
    gender: stats.gender || null,
    // "Where do you train?" / "How long is a session?" from the sharpen step
    // (mig 384). Same ids as the Coach's quick generator, which reads them
    // back as its defaults. NULL = not answered. Strip-and-retry drops them
    // on a host without the columns, so saving never depends on the migration.
    training_equipment: data?.sharpen?.equipment || null,
    session_minutes:    Number.isFinite(data?.sharpen?.sessionMinutes) ? data.sharpen.sessionMinutes : null,
  };

  return {
    core,
    detail,
    // Tier 1 — everything, including the JSONB assessment.
    full: { ...detail, fitness_assessment: data?.assessment || {}, ...core },
    // Tier 2 — drop fitness_assessment in case its JSONB validation or
    // schema-cache state is what's failing.
    minimal: { ...detail, ...core },
  };
}
