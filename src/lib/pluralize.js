// src/lib/pluralize.js
//
// Natural pluralization across all 15 supported locales using the
// built-in Intl.PluralRules API. Catches the universal "1 followers"
// bug + supports complex-plural languages (Polish: one / few / many /
// other; Russian: same; Arabic: 6 forms).
//
// API
//
//   pluralize(count, forms, locale?)
//     Pick the grammatically correct form from a `forms` object:
//       { one: '{n} follower', other: '{n} followers' }
//     Polish gets:
//       { one: '{n} obserwujący', few: '{n} obserwujących', many: '{n} obserwujących', other: '{n} obserwujących' }
//
//   formatCount(count, forms, locale?)
//     Same as `pluralize` but also runs the number through Intl.NumberFormat
//     so "1234" displays as "1,234" / "1.234" / etc. per locale.
//
//   The `{n}` placeholder is replaced with the formatted number. If the
//   form doesn't contain `{n}` the formatted number is prepended:
//   formatCount(5, { one: 'follower', other: 'followers' })
//     → "5 followers"
//
// FALLBACKS
//
//   When the active locale's plural category isn't in `forms`, falls
//   back to `forms.other`. Always provide `other` at minimum.
//
//   For large numbers we still use the integer plural form
//   ("1.2K followers", not "1.2K follower").

const FALLBACK_LOCALE = 'en';

function pickCategory(count, locale) {
  try {
    return new Intl.PluralRules(locale).select(Math.abs(count));
  } catch {
    return count === 1 ? 'one' : 'other';
  }
}

function fillN(template, formatted) {
  if (typeof template !== 'string') return String(formatted);
  if (template.includes('{n}')) return template.replace(/\{n\}/g, formatted);
  // No placeholder → prepend the number with a space.
  return `${formatted} ${template}`;
}

/**
 * Pick the correct plural form. Number formatting is left to the caller;
 * use `formatCount` when you want locale-aware separators too.
 *
 * @param {number} count
 * @param {object} forms  { one, two, few, many, other, zero }; provide at minimum `other`.
 * @param {string} [locale]
 * @returns {string}
 */
export function pluralize(count, forms, locale = FALLBACK_LOCALE) {
  return fillN(pluralForm(count, forms, locale), String(count));
}

/**
 * Pick the correct plural form and return it UNFILLED — no number
 * prepended, no `{n}` substituted.
 *
 * `pluralize` and `formatCount` both bake the number into the string, which
 * is what you want for "2,340 followers" in running text. It's not what you
 * want when the number is its own element — a bolded count next to a muted
 * noun, say — because you end up rendering the count twice. Use this to get
 * just the noun and own the number yourself.
 *
 * @param {number} count
 * @param {object} forms  { one, two, few, many, other, zero }; provide at minimum `other`.
 * @param {string} [locale]
 * @returns {string}
 */
export function pluralForm(count, forms, locale = FALLBACK_LOCALE) {
  const safeForms = forms || {};
  const category = pickCategory(count, locale);
  const template = safeForms[category] ?? safeForms.other ?? '';
  // A template written for `pluralize` may carry the placeholder; strip it
  // (and the space it leaves behind) rather than leaking "{n}" into the UI.
  return typeof template === 'string'
    ? template.replace(/\{n\}/g, '').trim()
    : String(template ?? '');
}

/**
 * Format the count with locale-aware separators AND pick the right
 * plural form in one call. The default; prefer this in UI code.
 *
 * @param {number} count
 * @param {object} forms
 * @param {string} [locale]
 * @returns {string}
 */
export function formatCount(count, forms, locale = FALLBACK_LOCALE) {
  const safeForms = forms || {};
  const category = pickCategory(count, locale);
  const template = safeForms[category] ?? safeForms.other ?? '';
  let formatted;
  try {
    formatted = new Intl.NumberFormat(locale).format(count);
  } catch {
    formatted = String(count);
  }
  return fillN(template, formatted);
}
