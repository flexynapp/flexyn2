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

// ────────────────────────────────────────────────────────────────────────────
// PSEUDOLOCALIZATION (dev only)
//
// The coverage audit compares catalogs against each other, and
// scripts/i18n-hardcoded.mjs greps for literals that never reached one. Both
// are static, and both are blind to the same thing: a string assembled at
// runtime, read out of a data file, or produced by a helper that no regex
// associates with UI. Pseudolocalization catches those by construction —
// every string that DID come through `t()` is visibly mangled, so anything
// still rendering in plain English did not.
//
// Turn it on in dev with:  localStorage.setItem('fn-pseudo', '1')  and reload.
//
// The transform does three jobs at once:
//   • accents every letter    — proves the string went through t()
//   • wraps in ⟦…⟧            — shows where the string starts and ends, which
//                               makes concatenation ("⟦Save⟧⟦ changes⟧") and
//                               truncation ("⟦Notificatio…") obvious
//   • pads Latin text by ~35% — German and Russian run long, and this is the
//                               cheapest way to find a button that cannot
//                               hold its own label before a translator does
//
// Placeholders ({name}, {count}) are left alone — mangling them would break
// interpolation and hide real bugs behind fake ones.
const PSEUDO_MAP = {
  a:'á',b:'ƀ',c:'ç',d:'ð',e:'é',f:'ƒ',g:'ĝ',h:'ĥ',i:'í',j:'ĵ',k:'ķ',l:'ł',m:'ɱ',
  n:'ñ',o:'ó',p:'ƥ',q:'ɋ',r:'ř',s:'ş',t:'ţ',u:'ú',v:'ṽ',w:'ŵ',x:'ẋ',y:'ý',z:'ž',
  A:'Á',B:'Ɓ',C:'Ç',D:'Ð',E:'É',F:'Ƒ',G:'Ĝ',H:'Ĥ',I:'Í',J:'Ĵ',K:'Ķ',L:'Ł',M:'Ϻ',
  N:'Ñ',O:'Ó',P:'Ƥ',Q:'Ɋ',R:'Ř',S:'Ş',T:'Ţ',U:'Ú',V:'Ṽ',W:'Ŵ',X:'Ẋ',Y:'Ý',Z:'Ž',
};

let _pseudoOn = null;
function pseudoEnabled() {
  if (_pseudoOn === null) {
    try { _pseudoOn = import.meta.env.DEV && localStorage.getItem('fn-pseudo') === '1'; }
    catch { _pseudoOn = false; }
  }
  return _pseudoOn;
}

/** Exported for tests; `getTranslation` applies it automatically in dev. */
export function pseudoize(str) {
  if (typeof str !== 'string' || !str) return str;
  // Split on {placeholders} so their contents survive untouched.
  const parts = str.split(/(\{[a-zA-Z0-9_]+\})/g);
  let letters = 0;
  const mangled = parts.map((p) => {
    if (/^\{[a-zA-Z0-9_]+\}$/.test(p)) return p;
    return p.replace(/[A-Za-z]/g, (c) => { letters++; return PSEUDO_MAP[c] || c; });
  }).join('');
  // ~35% expansion, matched to how far German/Russian overrun English.
  const pad = '·'.repeat(Math.ceil(letters * 0.35));
  return `⟦${mangled}${pad}⟧`;
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
  if (pseudoEnabled()) {
    const v = _translations[lang]?.[key] ?? _translations['en']?.[key];
    // A missing key stays a raw key path — pseudoizing it would disguise the
    // one failure this function already surfaces.
    return v == null ? key : pseudoize(v);
  }
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

/**
 * Every language that HAS a catalog in src/locales/. Not what the app offers —
 * see SUPPORTED_LANGUAGES below for that.
 *
 * Tooling reads this one: the DEV completeness checker, the coverage baseline,
 * and the audit scripts all need to see a shelved catalog, or a locale would
 * silently rot the moment it left the picker.
 */
export const ALL_LANGUAGES = [
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

/**
 * Languages the app actually OFFERS — the picker, and the only values
 * `setLanguage` and the stored/server preference will accept.
 *
 * English, Spanish and French, as of 2026-08-14. Spanish rejoined at 99.6% of the
 * English catalog — everything except the keys _meta.json holds English by
 * policy. It is a machine draft awaiting a native pass; see _meta.json.
 *
 * The other fourteen sat at ~49% of the English catalog: a user choosing
 * العربية got a screen half in Arabic and half in English, which reads as a
 * broken app rather than as an unfinished translation. Not offering the
 * language reads as a decision. Measured before deciding — no account had ever
 * selected a non-English locale (3 explicitly English, the rest unset), and
 * finishing all fourteen is ~135,000 words, roughly $16k of professional
 * post-editing, against a real cohort of about 26 profiles.
 *
 * The catalogs are NOT deleted. ~1,450 genuine translations per language stay
 * in src/locales/, still guarded by the no-regression baseline so they cannot
 * quietly rot, and still checked by the DEV checker. Re-offering one is this
 * list plus a translation pass to finish it — no code to write, nothing to
 * recover. That is the whole reason for shelving rather than removing.
 *
 * Before adding one back: finish it first. A locale belongs here when it is
 * complete, not when it is started. `npm run i18n:audit` prints where each
 * one stands.
 */
export const SUPPORTED_LANGUAGES = ALL_LANGUAGES.filter((l) => ['en', 'es', 'fr'].includes(l.code));
