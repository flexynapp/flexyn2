/**
 * ============================================================
 * INTERNATIONALIZATION RULES — READ BEFORE ADDING UI STRINGS
 * ============================================================
 * ALL user-facing strings MUST go through t('key.path').
 * NEVER hardcode display text directly in JSX.
 *
 * ⚠️  Adding the English value verbatim to all 14 other language blocks is NOT
 *    a translation. The strengthened i18n-check will warn on English-identical
 *    values in non-English languages. Either translate properly, or — if the
 *    value is intentionally identical (a brand name, a widely-known code,
 *    etc.) — add the key to ALLOW_IDENTICAL in i18n-check.js.
 *
 * ⚠️  CRITICAL RULE: When you add a new t('key') call anywhere in the app,
 *    you MUST add that key to `src/locales/en.json` IMMEDIATELY. Without an
 *    English entry the key displays as raw text for ALL users regardless of
 *    their language setting, because English is the fallback.
 *
 * Catalogs live in `src/locales/<lang>.json` — flat, sorted, key → string.
 * They are the SOURCE OF TRUTH and are committed. There is no build step:
 * edit the JSON and the change is live. This shape is what translation
 * management systems (Crowdin, Lokalise, Phrase) read natively, so the
 * files can round-trip through a translator without a converter.
 *
 * Translation POLICY — which keys stay English, which are machine-drafted
 * and awaiting native review — lives beside them in `src/locales/_meta.json`,
 * deliberately OUT of the catalogs so the catalogs stay pure key → string.
 *
 * Supported languages: en, es, fr, de, pt, it, ja, ko, zh,
 *                      ar, hi, ru, tr, pl, nl
 * ============================================================
 */

// ────────────────────────────────────────────────────────────────────────────
// LAZY PER-LANGUAGE LOADING
//
// Previously every language for every translation part was bundled into the
// entry chunk (~1 MB raw / ~240 KB gzip). Most users only ever see one
// language, so we dynamic-import a single per-language catalog from
// `src/locales/<lang>.json`. English users download ~70 KB raw / ~25 KB
// gzip; non-English users download their language + English (as a fallback
// dictionary) for roughly double that.
//
// Vite's dynamic-import code-splitting puts each language into its own
// chunk. JSON imports are parsed by the browser's JSON parser rather than
// evaluated as JS, which is measurably faster for objects this size.
// ────────────────────────────────────────────────────────────────────────────

// In-memory cache, populated as languages are loaded.
const _translations = {};

// Static glob — Vite sees ALL possible locales/*.json files at build time,
// generates a chunk for each, and the runtime can dynamic-import them by
// language code. Using import.meta.glob with `eager: false` (default) means
// each module becomes a separate lazy chunk.
//
// `_meta.json` sits in the same directory but is POLICY, not a catalog —
// it must never be loadable as a language, or `loadLanguage('_meta')` would
// populate the cache with a shape `getTranslation` can't read. Filtered out
// here rather than by moving the file, so the policy stays next to the
// catalogs it describes.
const _langImporters = Object.fromEntries(
  Object.entries(import.meta.glob('../locales/*.json')).filter(
    ([p]) => !p.endsWith('/_meta.json')
  )
);

/**
 * Load a language into the in-memory cache. Returns true on success.
 * If the catalog isn't found, returns false and a `[i18n]` warning is
 * logged. Callers MUST handle the false return by falling back to English.
 */
export async function loadLanguage(lang) {
  if (_translations[lang]) return true;
  const key = `../locales/${lang}.json`;
  const importer = _langImporters[key];
  if (!importer) {
    console.warn(`[i18n] No catalog for language "${lang}" (expected src/locales/${lang}.json).`);
    return false;
  }
  try {
    const mod = await importer();
    _translations[lang] = mod.default || mod;
    return true;
  } catch (err) {
    console.warn(`[i18n] Failed to load language "${lang}":`, err);
    return false;
  }
}

/**
 * Synchronous translation lookup. Returns the translated string for `key`
 * in `lang`, falls back to English if missing, and finally returns the
 * raw key if even English is missing or hasn't been loaded yet.
 *
 * The caller MUST have awaited `loadLanguage(lang)` (and at least
 * `loadLanguage('en')` as fallback) before relying on this function.
 * LanguageProvider does that at mount time and gates rendering until
 * both resolve.
 */
export function getTranslation(lang, key) {
  const langVal = _translations[lang]?.[key];
  if (langVal != null) return langVal;
  const enVal = _translations['en']?.[key];
  if (import.meta.env.DEV && lang !== 'en' && enVal != null) {
    console.warn(`[i18n] Missing translation — lang: "${lang}", key: "${key}"`);
  }
  return enVal ?? key;
}

/** True when the language's aggregate has been loaded into cache. */
export function isLanguageLoaded(lang) {
  return _translations[lang] != null;
}

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English',    nativeLabel: 'English',    flag: '🇺🇸' },
  { code: 'es', label: 'Spanish',    nativeLabel: 'Español',    flag: '🇪🇸' },
  { code: 'fr', label: 'French',     nativeLabel: 'Français',   flag: '🇫🇷' },
  { code: 'de', label: 'German',     nativeLabel: 'Deutsch',    flag: '🇩🇪' },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português',  flag: '🇧🇷' },
  { code: 'it', label: 'Italian',    nativeLabel: 'Italiano',   flag: '🇮🇹' },
  { code: 'ja', label: 'Japanese',   nativeLabel: '日本語',       flag: '🇯🇵' },
  { code: 'ko', label: 'Korean',     nativeLabel: '한국어',        flag: '🇰🇷' },
  { code: 'zh', label: 'Chinese',    nativeLabel: '中文',         flag: '🇨🇳' },
  { code: 'ar', label: 'Arabic',     nativeLabel: 'العربية',     flag: '🇸🇦' },
  { code: 'hi', label: 'Hindi',      nativeLabel: 'हिन्दी',         flag: '🇮🇳' },
  { code: 'ru', label: 'Russian',    nativeLabel: 'Русский',    flag: '🇷🇺' },
  { code: 'tr', label: 'Turkish',    nativeLabel: 'Türkçe',     flag: '🇹🇷' },
  { code: 'pl', label: 'Polish',     nativeLabel: 'Polski',     flag: '🇵🇱' },
  { code: 'nl', label: 'Dutch',      nativeLabel: 'Nederlands', flag: '🇳🇱' },
];
