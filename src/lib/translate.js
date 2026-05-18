// src/lib/translate.js
//
// On-demand translation for user-generated content (Hub posts, comments).
//
// Engines (tried in order until one succeeds):
//   1. Lingva — free Google Translate proxy. Highest quality, no key, works
//      until the public endpoint goes down (which happens occasionally).
//   2. MyMemory — free TM-based translator. Lower quality but very stable.
//      Daily quota is ~5,000 chars per IP without an email.
//
// Both engines are tried automatically. If both fail, returns null and the
// caller surfaces "Translation unavailable" to the user. No images or data
// other than the post text leaves the device.

const LINGVA_ENDPOINTS = [
  'https://lingva.ml',                       // Primary public instance
  'https://translate.plausibility.cloud',    // Mirror
];
const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';
// Per-request timeout — short so a dead endpoint falls through quickly to
// the next engine instead of leaving the user staring at "Translating…".
const REQUEST_TIMEOUT_MS = 4000;
// Hard wall-clock cap on a full translateText() call (all engines combined).
// Beyond this we give up so the UI never hangs longer than this.
const TOTAL_TIMEOUT_MS = 9000;

// LRU-ish cache keyed by `${target}|${text.slice(0, 200)}`. Survives the page
// session — translations are deterministic enough to cache aggressively.
const _cache = new Map();
const CACHE_MAX = 500;

function _cacheGet(key) {
  if (!_cache.has(key)) return null;
  const v = _cache.get(key);
  _cache.delete(key);
  _cache.set(key, v);  // move to most-recently-used
  return v;
}

function _cacheSet(key, value) {
  if (_cache.has(key)) _cache.delete(key);
  _cache.set(key, value);
  while (_cache.size > CACHE_MAX) {
    _cache.delete(_cache.keys().next().value); // evict oldest
  }
}

/** Clear the entire translation cache. Useful on language change. */
export function clearTranslationCache() {
  _cache.clear();
}

/**
 * Translate `text` from `sourceLang` (or 'auto') to `targetLang`.
 *
 * @param {string} text — the source text (plain UTF-8, single language)
 * @param {string} targetLang — ISO 639-1 like 'es', 'fr', 'ja'
 * @param {string} [sourceLang='auto'] — explicit source, or 'auto' to detect
 * @returns {Promise<{ translatedText: string, sourceLang: string, engine: string } | null>}
 *          null on total failure (all engines failed)
 */
export async function translateText(text, targetLang, sourceLang = 'auto') {
  if (!text || !targetLang) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (sourceLang === targetLang) {
    return { translatedText: trimmed, sourceLang, engine: 'noop' };
  }

  const cacheKey = `${targetLang}|${trimmed.slice(0, 200)}`;
  const cached = _cacheGet(cacheKey);
  if (cached) return cached;

  // Race the whole translation against a wall-clock timeout. Returning null
  // here is the same surface as any other engine failure — the caller renders
  // "Translation unavailable" and the spinner stops.
  //
  // Cleanup rule: clear the setTimeout AND abort any in-flight engine fetches
  // as soon as Promise.race settles. Previously the timer fired up to 9s
  // after the user already had their answer, holding a closure over `resolve`
  // for no reason, and the per-engine AbortControllers (4s each) leaked
  // their network requests if the racer beat them.
  let timer;
  let didSettle = false;
  const abortController = new AbortController();
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => {
      if (didSettle) return;
      // Abort the in-flight network requests so we don't waste round-trips.
      try { abortController.abort('translate-total-timeout'); } catch { /* ignore */ }
      resolve(null);
    }, TOTAL_TIMEOUT_MS);
  });

  const workPromise = (async () => {
    // Chunk if needed
    if (trimmed.length > 480) {
      const chunks = chunkText(trimmed, 460);
      const translated = await Promise.all(
        chunks.map(c => _translateOne(c, targetLang, sourceLang, abortController.signal))
      );
      if (translated.some(t => t === null)) return null;
      const combined = {
        translatedText: translated.map(t => t.translatedText).join(' '),
        sourceLang: translated[0].sourceLang,
        engine: translated[0].engine,
      };
      // If auto-detect determined the text is already in the target language, noop.
      if (combined.sourceLang === targetLang) return { translatedText: trimmed, sourceLang: combined.sourceLang, engine: 'noop' };
      return combined;
    }
    const r = await _translateOne(trimmed, targetLang, sourceLang, abortController.signal);
    // If auto-detect determined the text is already in the target language, noop.
    if (r && r.sourceLang === targetLang) return { translatedText: trimmed, sourceLang: r.sourceLang, engine: 'noop' };
    return r;
  })();

  try {
    const result = await Promise.race([workPromise, timeoutPromise]);
    didSettle = true;
    if (timer) clearTimeout(timer);
    if (result) _cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    didSettle = true;
    if (timer) clearTimeout(timer);
    throw err;
  }
}

/** Try each engine in order until one returns a usable result.
 *  externalSignal — when aborted (by the wall-clock timeout) all in-flight
 *  engine fetches abort instead of running to completion. */
async function _translateOne(text, targetLang, sourceLang, externalSignal) {
  // Engine 1: Lingva (try each public mirror)
  for (const base of LINGVA_ENDPOINTS) {
    if (externalSignal?.aborted) return null;
    const r = await _viaLingva(text, targetLang, sourceLang, base, externalSignal);
    if (r) return r;
  }
  // Engine 2: MyMemory fallback
  if (externalSignal?.aborted) return null;
  const r = await _viaMyMemory(text, targetLang, sourceLang, externalSignal);
  if (r) return r;
  return null;
}

async function _fetchWithTimeout(url, ms = REQUEST_TIMEOUT_MS, externalSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('per-request-timeout'), ms);
  // Bridge the external (wall-clock) signal into this controller so a
  // top-level timeout cancels in-flight engine calls instead of letting
  // them run for their full per-request budget.
  const onExternalAbort = () => controller.abort('external-abort');
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort('external-already-aborted');
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    return await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

async function _viaLingva(text, targetLang, sourceLang, base, externalSignal) {
  const src = sourceLang === 'auto' ? 'auto' : sourceLang;
  const url = `${base}/api/v1/${encodeURIComponent(src)}/${encodeURIComponent(targetLang)}/${encodeURIComponent(text)}`;
  try {
    const response = await _fetchWithTimeout(url, REQUEST_TIMEOUT_MS, externalSignal);
    if (!response.ok) return null;
    const data = await response.json();
    const translatedText = data?.translation;
    if (!translatedText || typeof translatedText !== 'string') return null;
    if (translatedText.trim() === text.trim()) return null; // no-op response
    return {
      translatedText,
      sourceLang: data?.info?.detectedSource || src,
      engine: 'lingva',
    };
  } catch {
    return null;
  }
}

async function _viaMyMemory(text, targetLang, sourceLang, externalSignal) {
  const langpair = sourceLang === 'auto'
    ? `autodetect|${targetLang}`
    : `${sourceLang}|${targetLang}`;
  const url = `${MYMEMORY_ENDPOINT}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langpair)}`;
  try {
    const response = await _fetchWithTimeout(url, REQUEST_TIMEOUT_MS, externalSignal);
    if (!response.ok) return null;
    const data = await response.json();
    const translatedText = data?.responseData?.translatedText;
    if (!translatedText) return null;
    // MyMemory embeds error strings directly in translatedText — filter them all.
    if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|PLEASE SELECT|DISTINCT LANGUAGE|INVALID LANGUAGE|YOU USED ALL AVAILABLE/i.test(translatedText)) return null;
    // Reject responses that look like all-caps API errors (typical MyMemory pattern)
    if (translatedText === translatedText.toUpperCase() && translatedText.length > 10 && !/\d/.test(translatedText)) return null;
    return {
      translatedText,
      sourceLang: data?.responseData?.detectedSourceLanguage
        || data?.matches?.[0]?.source
        || sourceLang,
      engine: 'mymemory',
    };
  } catch {
    return null;
  }
}

/**
 * Split a long string into chunks of ≤maxChars, preferring sentence/word
 * boundaries so translation remains coherent.
 */
function chunkText(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + maxChars, text.length);
    if (end < text.length) {
      const slice = text.slice(i, end);
      const lastSentence = Math.max(
        slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '),
        slice.lastIndexOf('.\n'), slice.lastIndexOf('!\n'), slice.lastIndexOf('?\n'),
      );
      if (lastSentence > maxChars / 2) {
        end = i + lastSentence + 1;
      } else {
        const lastSpace = slice.lastIndexOf(' ');
        if (lastSpace > maxChars / 2) end = i + lastSpace;
      }
    }
    chunks.push(text.slice(i, end).trim());
    i = end;
  }
  return chunks.filter(Boolean);
}

/**
 * Heuristic: does this text look like it could already be in the target
 * language? Skips redundant Translate buttons when the post is in the
 * user's language. Cheap pure-JS check based on script class.
 */
export function isLikelyAlreadyInLanguage(text, lang) {
  if (!text || !lang) return false;
  const SCRIPT_HINTS = {
    ja: /[぀-ゟ゠-ヿ一-龯]/,
    zh: /[一-龯]/,
    ko: /[가-힯]/,
    ar: /[؀-ۿ]/,
    hi: /[ऀ-ॿ]/,
    ru: /[Ѐ-ӿ]/,
  };
  const hint = SCRIPT_HINTS[lang];
  if (hint) return hint.test(text);
  // Latin-script targets — can't tell English from Spanish from French
  // without a real LID model. Conservative: don't claim already-translated.
  return false;
}
