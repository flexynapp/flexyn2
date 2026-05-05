// src/lib/translation.js
//
// On-demand translation for user-generated content (Hub posts, comments).
// Uses the MyMemory free API — no API key required, ~5,000 chars/day free
// per IP. Falls through gracefully on rate-limit or network failure.
//
// Why not pre-translate? Pre-translating Hub posts would require either a
// paid LLM call per post or a translation pipeline running server-side. This
// approach: cheap, on-demand, only translates posts the user actually wants
// to read in another language.
//
// On migration to a paid translator (Google Cloud, DeepL, Anthropic), the
// only file that needs to change is this one — the API surface (translateText)
// stays the same.

const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';

// LRU-ish cache keyed by `${target}|${text.slice(0, 200)}`. Survives the page
// session — translations are deterministic enough to cache aggressively.
const _cache = new Map();
const CACHE_MAX = 500;

function _cacheGet(key) {
  if (!_cache.has(key)) return null;
  // Bump to most-recently-used by re-inserting
  const v = _cache.get(key);
  _cache.delete(key);
  _cache.set(key, v);
  return v;
}

function _cacheSet(key, value) {
  if (_cache.has(key)) _cache.delete(key);
  _cache.set(key, value);
  while (_cache.size > CACHE_MAX) {
    // Evict oldest
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
}

/**
 * Translate `text` from `sourceLang` (or 'auto') to `targetLang`.
 *
 * @param {string} text — the source text (plain UTF-8, single language)
 * @param {string} targetLang — ISO 639-1 like 'es', 'fr', 'ja'
 * @param {string} [sourceLang='auto'] — explicit source, or 'auto' to detect
 * @returns {Promise<{ translatedText: string, sourceLang: string } | null>}
 *          null on failure (rate limit, network, no result)
 */
export async function translateText(text, targetLang, sourceLang = 'auto') {
  if (!text || !targetLang) return null;
  // Trim and normalize. MyMemory's q= max length is 500 chars per request —
  // chunk longer text. Most Hub posts are well under 500.
  const trimmed = text.trim();
  if (!trimmed) return null;

  // No-op if source and target are the same
  if (sourceLang === targetLang) {
    return { translatedText: trimmed, sourceLang };
  }

  const cacheKey = `${targetLang}|${trimmed.slice(0, 200)}`;
  const cached = _cacheGet(cacheKey);
  if (cached) return cached;

  // Chunk if needed (≥500 chars)
  if (trimmed.length > 500) {
    const chunks = chunkText(trimmed, 480);
    const translated = await Promise.all(
      chunks.map(c => _translateOne(c, targetLang, sourceLang))
    );
    if (translated.some(t => t === null)) return null;
    const combined = {
      translatedText: translated.map(t => t.translatedText).join(' '),
      sourceLang: translated[0].sourceLang,
    };
    _cacheSet(cacheKey, combined);
    return combined;
  }

  const result = await _translateOne(trimmed, targetLang, sourceLang);
  if (result) _cacheSet(cacheKey, result);
  return result;
}

async function _translateOne(text, targetLang, sourceLang) {
  // MyMemory uses the format `src|tgt`. 'auto' is supported via 'autodetect'.
  const langpair = sourceLang === 'auto'
    ? `autodetect|${targetLang}`
    : `${sourceLang}|${targetLang}`;
  const url = `${MYMEMORY_ENDPOINT}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langpair)}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      console.warn('[translation] HTTP error', response.status);
      return null;
    }
    const data = await response.json();
    const translatedText = data?.responseData?.translatedText;
    if (!translatedText) return null;

    // MyMemory occasionally echoes the source text when source = target or
    // detection fails. Filter out obvious "no translation" responses.
    if (translatedText.toUpperCase().includes('MYMEMORY WARNING')) {
      return null;
    }

    return {
      translatedText,
      sourceLang: data?.responseData?.detectedSourceLanguage
        || data?.matches?.[0]?.source
        || sourceLang,
    };
  } catch (err) {
    console.warn('[translation] request failed:', err);
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
      // Walk back to a sentence boundary
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
 * language? Avoids redundant translate calls when content is already in the
 * user's language. Cheap pure-JS check — not perfect, but catches the common
 * cases (English text shown to English users, etc).
 */
export function isLikelyAlreadyInLanguage(text, lang) {
  if (!text || !lang) return false;
  // Script-class checks. If the dominant script doesn't match the target
  // language's script family, definitely not already translated.
  const SCRIPT_HINTS = {
    ja: /[぀-ゟ゠-ヿ一-龯]/, // Hiragana, Katakana, CJK
    zh: /[一-龯]/,                            // CJK
    ko: /[가-힯]/,                            // Hangul
    ar: /[؀-ۿ]/,                            // Arabic
    hi: /[ऀ-ॿ]/,                            // Devanagari
    ru: /[Ѐ-ӿ]/,                            // Cyrillic
  };
  const hint = SCRIPT_HINTS[lang];
  if (hint) return hint.test(text);
  // Latin-script languages (en, es, fr, de, pt, it, tr, pl, nl) — if no
  // non-Latin scripts are present, it could be any of them. Conservative
  // answer: don't claim "already in target language" — let the user decide.
  return false;
}
