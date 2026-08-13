// src/lib/submitDedupe.js
//
// Content-level duplicate suppression for meal logging.
//
// Nutrition.jsx already had a TIMING guard (`guardSubmit`), and it only ever
// wrapped the two water buttons — every meal path called saveMutation.mutate
// directly behind nothing but React Query's asynchronous `isPending`.
// Production holds two byte-identical "Sautéed diced onion and red bell pepper"
// rows 530 ms apart: past the 400 ms re-arm, and past `onSettled`, which
// reopens the guard the moment the first save lands. No timing threshold fixes
// that without also blocking a legitimate retry after a network error.
//
// So dedupe on WHAT was submitted rather than on when. This lives in lib rather
// than inside the 2,000-line page component for one reason: it sits on the
// app's primary write path, and a mistake here reproduces the dead Log Meal
// button — an early return that skipped the mutation once left the form's
// in-flight ref latched forever. That is worth a test, and a closure inside a
// component cannot have one.

export const DEFAULT_DEDUPE_MS = 2500;

const num = (primary, fallback) => {
  const n = Number(primary ?? fallback);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The identity of a logged meal, for duplicate purposes.
 *
 * Reads the `_g` alias first and the bare column second, mirroring
 * `nutritionData.create()`, which dual-writes `protein_g → protein`. Call sites
 * disagree about which shape they send, and two payloads that persist to the
 * same row must produce the same signature.
 */
export function entrySignature(payload = {}) {
  return JSON.stringify([
    payload.date ?? null,
    payload.meal_type ?? null,
    String(payload.food_name ?? '').trim().toLowerCase(),
    num(payload.calories),
    num(payload.protein_g, payload.protein),
    num(payload.carbs_g, payload.carbs),
    num(payload.fat_g, payload.fat),
  ]);
}

/**
 * Build a duplicate filter.
 *
 * Returns `accept(payload, now?)` → true when the submission should proceed.
 * `isExempt` opts a payload out entirely: water is exempt because tapping the
 * same glass twice is the feature there, not a mistake.
 *
 * @param {object}   [opts]
 * @param {number}   [opts.windowMs]  suppression window; long enough to swallow
 *   a double-tap (the production pair was 530 ms apart), short enough that
 *   deliberately logging the same item twice — rescanning a second identical
 *   yoghurt — still goes through.
 * @param {(p:object)=>boolean} [opts.isExempt]
 */
export function makeDuplicateFilter({ windowMs = DEFAULT_DEDUPE_MS, isExempt } = {}) {
  const seen = new Map();
  return function accept(payload, now = Date.now()) {
    if (isExempt?.(payload)) return true;
    const signature = entrySignature(payload);
    for (const [key, at] of seen) if (now - at > windowMs) seen.delete(key);
    if (seen.has(signature)) return false;
    seen.set(signature, now);
    return true;
  };
}
