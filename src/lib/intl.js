// src/lib/intl.js
//
// Locale-aware number + date formatting helpers.
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
// numbers or dates render.

import { useMemo } from 'react';
import { useLanguage } from '@/lib/LanguageContext';

// Our internal language codes are ISO 639-1 ("en", "es", "zh", "ar"…)
// which Intl APIs accept directly. The few that need region tagging
// for proper formatting are mapped here:
//   • zh → zh-CN (Mainland-style numerals + Han calendar conventions)
//   • pt → pt-BR (Brazil is the larger user base)
const LOCALE_OVERRIDES = {
  zh: 'zh-CN',
  pt: 'pt-BR',
};

function toBcp47(lang) {
  return LOCALE_OVERRIDES[lang] || lang || 'en';
}

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
  return useMemo(() => {
    const locale = toBcp47(language);
    return (n, opts) => {
      if (n == null || Number.isNaN(Number(n))) return '';
      try {
        return new Intl.NumberFormat(locale, opts).format(Number(n));
      } catch {
        // Some browsers throw on unrecognized locales; fall back to en-US
        // rather than crash render.
        return new Intl.NumberFormat('en-US', opts).format(Number(n));
      }
    };
  }, [language]);
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
  return useMemo(() => {
    const locale = toBcp47(language);
    return (d, opts) => {
      if (d == null) return '';
      const date = d instanceof Date ? d : new Date(d);
      if (Number.isNaN(date.getTime())) return '';
      try {
        return new Intl.DateTimeFormat(locale, opts).format(date);
      } catch {
        return new Intl.DateTimeFormat('en-US', opts).format(date);
      }
    };
  }, [language]);
}

/**
 * Non-hook version for callers that already know the language (e.g.
 * data-layer helpers that receive `language` as an arg).
 */
export function formatNumber(n, language, opts) {
  if (n == null || Number.isNaN(Number(n))) return '';
  const locale = toBcp47(language);
  try {
    return new Intl.NumberFormat(locale, opts).format(Number(n));
  } catch {
    return new Intl.NumberFormat('en-US', opts).format(Number(n));
  }
}

export function formatDate(d, language, opts) {
  if (d == null) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  const locale = toBcp47(language);
  try {
    return new Intl.DateTimeFormat(locale, opts).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', opts).format(date);
  }
}
