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

// Largest unit first: we want "2 months ago", not "9 weeks ago".
const RELATIVE_UNITS = [
  ['year',   31_536_000],
  ['month',   2_592_000],
  ['week',      604_800],
  ['day',        86_400],
  ['hour',        3_600],
  ['minute',         60],
];

/**
 * An ALWAYS-relative timestamp: "just now", "2 hours ago", "3 months ago".
 *
 * Distinct from `formatNotificationTime`, which is deliberately relative only
 * for today and switches to a clock time or a date beyond that — a
 * notification row sits under a day header that already says which day it is.
 * A comment has no such header, so the age has to carry itself the whole way.
 *
 * Built on `Intl.RelativeTimeFormat` rather than date-fns' `formatDistanceToNow`
 * for the reason in CLAUDE.md's i18n section: date-fns binds no locale unless
 * you ship 15 locale bundles, so it renders English under a fully-translated
 * screen and no translation-key audit can see it.
 *
 * @param {Date|string|number} value
 * @param {string} language  app language code ('en', 'es', …)
 * @param {Date}   [now]
 */
export function formatRelativeTime(value, language, now = new Date()) {
  // Guard null/undefined/'' BEFORE constructing: `new Date(null)` is the
  // epoch, not an Invalid Date, so a row with no timestamp would otherwise
  // render a confident "57 years ago" instead of nothing.
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const locale = toBcp47(language);
  const seconds = (date.getTime() - now.getTime()) / 1000;
  const abs = Math.abs(seconds);

  const build = (loc) => {
    const rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' });
    // Under a minute — including a clock-skewed future stamp — reads as now.
    // "in 12 seconds" on a comment that already exists is a bug, not a tense.
    if (abs < 60) return rtf.format(0, 'second');
    for (const [unit, secs] of RELATIVE_UNITS) {
      if (abs >= secs) return rtf.format(Math.round(seconds / secs), unit);
    }
    return rtf.format(0, 'second');
  };

  try {
    return build(locale);
  } catch {
    // A bad language code must not blank the timestamp entirely.
    try { return build('en-US'); } catch { return ''; }
  }
}

/**
 * The viewer's IANA time zone, e.g. "America/New_York".
 *
 * Display only. The value the SERVER acts on is a minutes-east offset that
 * AuthContext already sends on every bootstrap — this is the human-readable
 * form of the same fact, so Settings can say what was detected.
 *
 * Falls back to a UTC offset string rather than returning nothing: an older
 * WebView without `resolvedOptions().timeZone` would otherwise render an
 * empty row, which reads as a broken setting rather than as an unsupported
 * platform. "UTC+05:30" is less friendly than "Asia/Kolkata" and is still an
 * answer.
 */
export function detectTimeZone(now = new Date()) {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) return tz;
  } catch { /* fall through */ }
  // getTimezoneOffset is minutes WEST of UTC, so the sign inverts for display.
  const mins = -now.getTimezoneOffset();
  if (!Number.isFinite(mins)) return 'UTC';
  const sign = mins < 0 ? '-' : '+';
  const abs = Math.abs(mins);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}
