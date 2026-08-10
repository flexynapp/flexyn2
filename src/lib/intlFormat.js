// src/lib/intlFormat.js
//
// The NON-HOOK half of src/lib/intl.js: pure `Intl` wrappers that take
// `language` as an argument instead of reading it from context.
//
// ── Why this is a separate file ──────────────────────────────────────────
//
// Not obvious, and it cost a red test suite to find. `intl.js` imports
// `LanguageContext` for its hooks; LanguageContext imports `@/api/db`; and
// `db.js` registers a `supabase.auth.onAuthStateChange` listener at MODULE
// SCOPE. So importing anything from `intl.js` — even a pure function that
// never touches React — drags that listener in and breaks every test that
// stubs the supabase client. `scheduledWorkouts.test.js` died on exactly
// that the moment its module imported `formatDate`.
//
// CLAUDE.md's Profile-cache section documents the same trap one hop in
// ("import @/api/profileCache, never @/api/db, from a data module"). This is
// that edge, one hop further out, and it had made the non-hook helpers
// unusable by the two kinds of caller they were written for: data modules,
// and the pure `aiCoach` text generators.
//
// `intl.js` re-exports everything here, so every existing `@/lib/intl`
// importer is unaffected. **Import from THIS file anywhere outside a React
// component.**

// Our internal language codes are ISO 639-1 ("en", "es", "zh", "ar"…)
// which Intl APIs accept directly. The few that need region tagging
// for proper formatting are mapped here:
//   • zh → zh-CN (Mainland-style numerals + Han calendar conventions)
//   • pt → pt-BR (Brazil is the larger user base)
const LOCALE_OVERRIDES = {
  zh: 'zh-CN',
  pt: 'pt-BR',
};

export function toBcp47(lang) {
  return LOCALE_OVERRIDES[lang] || lang || 'en';
}

/**
 * Non-hook number formatter for callers that already know the language
 * (data-layer helpers, the pure aiCoach generators).
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

/** Non-hook date formatter. Same contract as `useDateFormatter`. */
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

/**
 * Non-hook list formatter. `useListFormatter` is a thin wrapper over this.
 *
 * Always `type: 'conjunction'`. `type: 'unit'` looks like the right choice
 * for a bare enumeration and is not: it emits NO separator in Chinese and
 * still injects "und"/"et" in German and French. See
 * `src/lib/__tests__/listFormatter.test.js`, which pins that measurement.
 */
export function formatList(items, language, opts) {
  const list = (items || []).filter(Boolean).map(String);
  if (list.length === 0) return '';
  const locale = toBcp47(language);
  // Intl.ListFormat is ES2021 and absent on older WebViews. A plain join is
  // a worse separator, not a broken screen, so degrade rather than throw.
  if (typeof Intl.ListFormat !== 'function') return list.join(', ');
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction', ...opts }).format(list);
  } catch {
    return new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction', ...opts }).format(list);
  }
}
