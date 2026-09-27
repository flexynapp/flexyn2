// src/lib/intl.js
//
// Locale-aware number + date + list formatting HOOKS.
//
// Why this file exists: places across the app were calling
// `.toLocaleString()` and `.toLocaleDateString()` with no locale
// argument, which falls back to the BROWSER's locale instead of the
// app's selected language. The result: an Arabic user with an
// English-locale browser saw English digit grouping (1,234,567)
// instead of Arabic-Indic digits (١٬٢٣٤٬٥٦٧). The whole point of
// i18n is to render the app in the user's chosen language regardless
// of OS / browser settings, so locale must come from useLanguage().
//
// The hooks below pull the active language from LanguageContext and
// return formatters bound to it. Use them anywhere user-visible
// numbers, dates or lists render.
//
// **The pure implementations live in `./intlFormat`**, which imports no
// React and no context. That split is load-bearing, not tidiness: this
// file imports LanguageContext → `@/api/db` → a module-scope
// `supabase.auth.onAuthStateChange` listener, so importing it from a data
// module or from the pure aiCoach generators breaks any test that stubs the
// supabase client. Outside a React component, import `./intlFormat`.
// Re-exported here so `@/lib/intl` keeps working for every existing caller.

import { useMemo } from 'react';
import { useLanguage } from '@/lib/LanguageContext';
import { formatNumber, formatDate, formatList } from '@/lib/intlFormat';

export { formatNumber, formatDate, formatList, formatRelativeTime, formatDuration, detectTimeZone, toBcp47 } from '@/lib/intlFormat';

/**
 * Returns a number formatter bound to the app's current language.
 * Memoized — safe to call inside render without re-creating per render.
 *
 *   const fmt = useNumberFormatter();
 *   fmt(1234567)  // "1,234,567" (en) / "١٬٢٣٤٬٥٦٧" (ar) / "1.234.567" (de)
 *   fmt(123.456, { maximumFractionDigits: 1 })  // "123.5" / "123,5"
 */
export function useNumberFormatter() {
  const { language } = useLanguage();
  return useMemo(() => (n, opts) => formatNumber(n, language, opts), [language]);
}

/**
 * Returns a date formatter bound to the app's current language.
 *
 *   const fmt = useDateFormatter();
 *   fmt(new Date())                          // "5/21/2026" / "21/5/2026"
 *   fmt(new Date(), { dateStyle: 'long' })   // "May 21, 2026" / "21 de mayo de 2026"
 */
export function useDateFormatter() {
  const { language } = useLanguage();
  return useMemo(() => (d, opts) => formatDate(d, language, opts), [language]);
}

/**
 * Returns a list formatter bound to the app's current language.
 *
 *   const list = useListFormatter();
 *   list(['body weight', 'height', 'age'])
 *     // en → "body weight, height, and age"
 *     // ar → "body weight وheight وage"
 *     // ja → "body weight、height、age"
 *
 * Why this is not `arr.join(', ')`: the separator is locale data, not
 * punctuation. Arabic joins with `و` and Japanese with `、`, so a hardcoded
 * comma is wrong in both — and English needs the "and" that a join can
 * never produce.
 */
export function useListFormatter() {
  const { language } = useLanguage();
  return useMemo(() => (items, opts) => formatList(items, language, opts), [language]);
}
