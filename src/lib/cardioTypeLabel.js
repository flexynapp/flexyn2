// src/lib/cardioTypeLabel.js
//
// One place that turns a `cardio_logs.type` into something a human reads.
//
// The type is `<mode>_<env>` — running_outside, biking_stationary — and
// eight call sites used to build the translation key by template and pass
// it straight to `t()`:
//
//     t(`cardio.type.${log.type}`)
//
// That is fine while every type has a key and silently awful when one
// does not, because `getTranslation` ends with `return enVal ?? key`. A
// missing key renders as the KEY PATH. Swimming shipped without
// `cardio.type.swimming_pool` or `cardio.type.swimming_openwater`, so a
// pool swim put the literal string "cardio.type.swimming_pool" on screen
// in the manual form's heading, the detail modal's title, the Repeat-last
// row and three Hub surfaces — including a shared post, where it was
// visible to other people.
//
// Both keys exist now. This helper is here so the NEXT type to be added
// without one degrades to readable text instead of a key path: adding a
// mode or an environment is a two-line change in CardioSection, and
// nothing about it forces you to remember this file.
//
// Pure — takes `tFallback` rather than importing React, matching
// goalProgress.js. Callers pass the one from useLanguage().

/**
 * "swimming_openwater" -> "Swimming openwater".
 *
 * Only ever seen for a type with no key, so it optimises for "obviously a
 * fallback, still readable" over polish. Deliberately NOT title-cased on
 * every word: `titleCase('swimming_pool')` gives "Swimming Pool", which
 * reads as the noun — the thing you swim in — rather than the activity.
 */
function humanize(type) {
  const words = String(type).split('_').filter(Boolean).join(' ');
  if (!words) return '';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * @param {string}   type       — a cardio_logs.type, e.g. 'running_outside'.
 *                                Empty / null is allowed: some Hub payloads
 *                                carry an activity with no type at all.
 * @param {Function} tFallback  — from useLanguage(). MUST be tFallback and
 *                                not t: `t(key) || fallback` cannot work
 *                                here, because a missing key returns the
 *                                key string, which is truthy.
 * @returns {string}
 */
export function cardioTypeLabel(type, tFallback) {
  const clean = String(type || '').trim();
  // No type at all — the Hub's old `|| 'cardio'` branch. `cardio.title`
  // is translated in all 15 languages, so this degrades to a real word
  // rather than to a new English-only key.
  if (!clean) return tFallback('cardio.title', 'Cardio');
  return tFallback(`cardio.type.${clean}`, humanize(clean));
}

export default cardioTypeLabel;
