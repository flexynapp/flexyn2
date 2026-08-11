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

// Script ranges, kept separate so Japanese and Chinese can be told apart.
const RE_KANA   = /[぀-ゟ゠-ヿ]/g;  // hiragana + katakana
const RE_HAN    = /[一-鿿㐀-䶿]/g;  // CJK ideographs (both use these)
const RE_HANGUL = /[가-힯ᄀ-ᇿ]/g;
const RE_ARABIC = /[؀-ۿݐ-ݿ]/g;
const RE_DEVA   = /[ऀ-ॿ]/g;
const RE_CYRIL  = /[Ѐ-ӿ]/g;
const RE_LATIN  = /[A-Za-zÀ-ɏ]/g;

// Anything that carries no language signal: spaces, digits, punctuation,
// emoji, @mentions and #hashtags are all script-neutral noise.
const RE_NEUTRAL = /[\s\d\p{P}\p{S}]/gu;

function count(text, re) {
  return (text.match(re) || []).length;
}

/**
 * Heuristic: is this text ALREADY in the target language, such that
 * offering a Translate button would be pointless?
 *
 * Used to hide the button on Hub posts. Getting this wrong in the
 * "hide" direction is much worse than in the "show" direction — a
 * spurious button is a minor annoyance, a missing one means the user
 * simply cannot read the post. So this is deliberately conservative and
 * only claims "already translated" when the script clearly dominates.
 *
 * ── Two bugs this replaces ───────────────────────────────────────────
 *
 * 1. Japanese and Chinese were both matched on the shared CJK ideograph
 *    block, so they shadowed each other: a Japanese user could not
 *    translate a Chinese post, and a Chinese user could not translate a
 *    Japanese one (Japanese prose nearly always contains kanji). They're
 *    told apart properly now — kana means Japanese, and Chinese requires
 *    Han WITHOUT kana or hangul.
 *
 * 2. A single character used to be enough: `/[一-龯]/.test(text)` is true
 *    for "Great session 頑張った", which is 90% English, so the button
 *    vanished for ja and zh readers. One Cyrillic word in an English post
 *    did the same to Russian readers. Now the script has to account for
 *    most of the actual letters.
 */
export function isLikelyAlreadyInLanguage(text, lang) {
  if (!text || !lang) return false;

  // Strip script-neutral characters before measuring, so an emoji-heavy
  // or hashtag-heavy post isn't judged on punctuation.
  const letters = String(text).replace(RE_NEUTRAL, '');
  if (!letters) return false;

  const kana   = count(letters, RE_KANA);
  const han    = count(letters, RE_HAN);
  const hangul = count(letters, RE_HANGUL);
  const arabic = count(letters, RE_ARABIC);
  const deva   = count(letters, RE_DEVA);
  const cyril  = count(letters, RE_CYRIL);
  const latin  = count(letters, RE_LATIN);
  const total  = letters.length;

  // The target script must carry most of the message, not just appear in
  // it. Below this we show the button and let the user decide.
  const DOMINANT = 0.5;
  const ratio = (n) => n / total;

  switch (lang) {
    case 'ja':
      // Kana is unique to Japanese and decisive. Kanji alone is not —
      // that's what made Chinese posts look Japanese.
      return kana > 0 && ratio(kana + han) >= DOMINANT;
    case 'zh':
      // Han with no kana and no hangul. Chinese has no syllabary, so any
      // kana at all means the text is Japanese, not Chinese.
      return kana === 0 && hangul === 0 && ratio(han) >= DOMINANT;
    case 'ko':
      // Korean mixes in hanja occasionally, so count both — but hangul
      // must actually be present.
      return hangul > 0 && ratio(hangul + han) >= DOMINANT;
    case 'ar': return ratio(arabic) >= DOMINANT;
    case 'hi': return ratio(deva)   >= DOMINANT;
    case 'ru': return ratio(cyril)  >= DOMINANT;
    default: {
      // Latin-script targets (en/es/fr/de/pt/it/tr/pl/nl). If the text is
      // predominantly a NON-Latin script, it plainly isn't in this language,
      // so keep the button.
      if (ratio(latin) < DOMINANT) return false;
      // Otherwise fall through to the stopword vote below. This used to
      // `return false` unconditionally with the note "we can't tell English
      // from Spanish without a real language-ID model" — true, but it meant
      // an English viewer was offered a Translate button on every English
      // comment, and clicking it just made the button vanish (English → English
      // returns the same string, which the caller reads as a failure).
      const guess = guessLatinLanguage(text);
      return guess.lang === lang && guess.confident;
    }
  }
}

// Function words, which are the cheapest reliable signal for language ID on
// Latin script: they are high-frequency, short, and mostly non-overlapping
// between these nine languages. This is not a language model and does not
// pretend to be — it answers one narrow question well enough to decide
// whether to show a button.
const STOPWORDS = {
  en: ['the','and','is','to','of','a','in','it','you','that','for','on','with','this','was','are','not','but','have','be','at','my','me','so','just','what','all','get','like','from','they','we','do','if','can','out','up','how','about','one','when','there'],
  es: ['el','la','los','las','de','que','y','en','un','una','es','por','con','no','para','se','del','al','lo','como','más','pero','sus','le','ya','muy','sí','porque','esta','este','está','son','tiene','hacer','todo','bien','yo','tu','mi','eso'],
  fr: ['le','la','les','de','des','et','est','un','une','en','que','qui','dans','pour','pas','sur','au','ce','il','elle','je','tu','nous','vous','avec','plus','mais','ou','son','sa','ses','tout','fait','être','avoir','bien','comme','très','moi','du'],
  de: ['der','die','das','und','ist','ich','nicht','ein','eine','zu','den','mit','sich','auf','für','von','dem','es','du','wir','war','aber','auch','noch','wie','so','nur','kann','hat','sind','bei','oder','über','was','mehr','sehr','mein','dass','man','im'],
  pt: ['de','que','não','uma','um','para','com','por','os','as','do','da','em','no','na','se','mais','como','mas','você','eu','ele','ela','isso','muito','bem','já','tem','foi','são','vai','fazer','tudo','pode','quando','porque','sobre','meu','minha','também'],
  it: ['il','lo','la','le','di','che','non','una','un','per','con','sono','del','della','nel','più','ma','anche','come','se','mi','ti','ci','questo','questa','molto','bene','fare','tutto','quando','perché','sulla','loro','mio','solo','già','essere','ho','hai','cosa'],
  tr: ['bir','ve','bu','için','ile','çok','daha','ama','ne','gibi','olarak','var','yok','her','de','da','mi','mı','ben','sen','biz','onu','şey','kadar','sonra','önce','böyle','şu','o','en','ki','olan','oldu','değil','hem','tüm','yine','iyi','büyük','zaman'],
  pl: ['nie','się','to','na','jest','że','do','w','z','co','jak','ale','tak','po','za','czy','tylko','już','bardzo','przez','dla','o','od','ja','ty','my','oni','ma','być','może','jego','jej','tego','tym','wszystko','dobrze','teraz','gdzie','kiedy','bo'],
  nl: ['de','het','een','en','van','is','dat','in','te','niet','op','zijn','met','voor','maar','er','aan','ook','als','dan','die','ik','je','we','wat','heb','heeft','naar','uit','over','nog','wel','bij','door','om','geen','deze','veel','zo','waar'],
};
const STOPWORD_SETS = Object.fromEntries(
  Object.entries(STOPWORDS).map(([k, v]) => [k, new Set(v)])
);

/**
 * Guess which Latin-script language a string is in, by counting function words.
 *
 * Returns `{ lang, confident }`. `confident` is false for anything too short
 * or too close to call — the caller shows the Translate button in a faded
 * state rather than hiding it, because being wrong in that direction only
 * costs a dim button, while wrongly hiding it strands a reader who genuinely
 * cannot read the comment.
 */
export function guessLatinLanguage(text) {
  const tokens = String(text || '')
    .toLowerCase()
    .split(/[^\p{L}\p{M}']+/u)
    .filter(Boolean);
  if (tokens.length < 3) return { lang: null, confident: false };

  const scores = {};
  for (const lang of Object.keys(STOPWORD_SETS)) {
    const set = STOPWORD_SETS[lang];
    scores[lang] = tokens.reduce((n, tok) => n + (set.has(tok) ? 1 : 0), 0);
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topLang, topScore] = ranked[0];
  const runnerUp = ranked[1]?.[1] ?? 0;

  // No function words matched at all — could be anything (a single noun
  // phrase, a brand name, slang). Not a call we should make.
  if (topScore === 0) return { lang: null, confident: false };

  // Confident when the winner both clears a floor and beats the runner-up
  // clearly. The languages here share tokens ("de" in es/fr/pt/nl, "la" in
  // es/fr/it), so a one-word lead is noise, not a signal.
  const confident = topScore >= 2 && topScore >= runnerUp * 2;
  return { lang: topLang, confident };
}

/**
 * Three-way answer for the Translate affordance:
 *   'same'      → the text is already in the viewer's language; hide it
 *   'unsure'    → can't tell; show it faded
 *   'different' → worth offering; show it normally
 */
export function translationHint(text, lang) {
  if (!text || !lang) return 'unsure';
  if (isLikelyAlreadyInLanguage(text, lang)) return 'same';
  const letters = String(text).replace(RE_NEUTRAL, '');
  if (!letters) return 'unsure';
  // A dominant non-Latin script we don't read is unambiguously worth offering.
  if (count(letters, RE_LATIN) / letters.length < 0.5) return 'different';
  const guess = guessLatinLanguage(text);
  if (!guess.confident) return 'unsure';
  return guess.lang === lang ? 'same' : 'different';
}
