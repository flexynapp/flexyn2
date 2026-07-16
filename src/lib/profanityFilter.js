// src/lib/profanityFilter.js
// Robust client-side profanity filter focused on strong profanity and slurs.
// Mild words (damn, crap, piss, ass, arse, hell) are intentionally allowed.
// Catches fancy-text generator bypasses (𝓯𝓾𝓬𝓴, 🅕🅤🅒🅚, ʄʊƈӄ, ɴɪɢɢᴇʀ, etc.)
//
// Defense layers (each catches a different obfuscation strategy):
//   1. Lowercase                              — case-flip bypass
//   2. Strip invisible / zero-width chars     — "n​i​g​g​e​r" with ZWSP between letters
//   3. Homoglyph map (Cyrillic / Greek /      — visually-identical scripts
//      IPA / Cherokee / fullwidth /
//      regional indicators / etc.)
//   4. NFKD decomposition                     — math alphanumerics, diacritics, enclosed letters
//   5. Second homoglyph pass                  — mappings exposed only after NFKD
//   6. Leet / shape-class folding             — i/l/1/|/!/¡ → i, o/0 → o, etc.
//   7. Strip all non-alphanumeric             — separators, punctuation, whitespace
//   8. Forward AND reverse fuzzy match        — catches "regin" backwards
//   9. Allowlist re-check on each hit         — protects "classroom", "assassin", etc.

const BLOCKED = [
  'fuck','fuk','fuq','phuck','phuk','fcuk','fack',
  'shit','shyt', // 'shiet' removed: redundant (caught by 'shit' fuzzy) and caused
                  // reverse-match false positive on benign phrases like "kill the lights".
  'bitch','biatch','beotch','biotch',
  'asshole','ashole','azzhole','arsehole',
  'bastard','cunt','kunt','kuntz','cock','kock','kawk','dick',
  'pussy','pussi','pusy','motherfucker','motherfuck','mofo',
  'bullshit','jackass','dumbass','dipshit','shithead','asshat',
  'wanker','twat','prick','douche','douchebag','whore','slut',
  'retard','retarded',
  'nigger','nigga','niglet','nibba','nibber',
  'jigaboo','porchmonkey','coon','sandnigger',
  'chink','gook','spic','kike','wetback','beaner',
  'paki','raghead','towelhead','sandmonkey','wop','dago','kraut',
  'faggot','fagot','faggit','phaggot','tranny','shemale','dyke','mongoloid',
  'pendejo','puta','puto','cabron','mierda','chinga','verga','chingar','pinche',
  'putain','salope','connard','connasse','encule','merde','merda',
  'scheisse','arschloch','fotze','wichser',
  'cazzo','stronzo','stronza','puttana','troia','vaffanculo',
  'caralho','porra','foda','kurwa','chuj','pierdolic','jebac',
  'blyat','blyad','suka','pizdec','pizda',
];

const ALLOWLIST = [
  'assassin','assassinate','assassination',
  'class','classic','classical','classify','classroom','classmate','classy','classes',
  'glass','grass','pass','passage','password','passes','passed','passing',
  'compass','compassion','mass','massage','bass','brass','massive',
  'embarrass','harass','overpass','underpass',
  'cocktail','peacock','shuttlecock','haycock','woodcock',
  'analysis','analyst','analytic','analytics','canal','banal',
  'button','mutton','rebuttal','shiitake',
  'titan','title','titanium','titanic','subtitle','entitle',
  'hoecake','hoedown',
  'scunthorpe','penistone','lightwater','clitheroe','arsenal',
  'cockburn','cockermouth','dickens','dickinson','hancock','babcock','cocker','cocky','peacocky',
  'cassette','massacre','embassy',

  // ── False-positive fixes ────────────────────────────────────────────────────
  // "shit" fuzzy pattern (s+.?h+.?i+.?t+) incorrectly matches these:
  'shift','shifts','shifting','shifted','shiftwork',
  'shirt','shirts',

  // "cunt" fuzzy pattern (c+.?u+.?n+.?t+) incorrectly matches these:
  'count','counts','counting','counted','recount','recounts','recounting',
  'account','accounts','accounting','accountant','accountants','accountability','accountable',
  'discount','discounts','discounting',
  'encounter','encounters','encountered','encountering',
  'bounty', // b-o-u-n-t-y: no c, safe — kept for clarity

  // "cock" fuzzy pattern (c+.?o+.?c+.?k+) — after l→i leet, "clock"→"ciock"
  // which matches the cock pattern. Same for crockery.
  'clock','clocks','clockwork','oclock',
  'crockery','crocker','crockett',
  'stock','stocks','stocking','stockings','stockpile','livestock',
  'knock','knocks','knocking','knockback',
  'frock','frocks',
  'block','blocks','blocking','blocker','blockers','blockchain',
  'flock','flocks',
  'dock','docks','docking',
  'mock','mocks','mocking',
  'rock','rocks','rocking','rocket','rockets',
  'shock','shocks','shocking',
  'socket','sockets',
  'pocket','pockets',
  'sprocket','sprockets',
  'lock','locks','locking','locker','lockers',
  'unlock','unlocks','unlocking',
];

// ── Unicode lookalike / homoglyph map ─────────────────────────────
// Single-codepoint mappings. Multi-codepoint sequences are handled via NFKD.
const HOMOGLYPHS = {
  // Cyrillic basic
  'а':'a','А':'a','е':'e','Е':'e','о':'o','О':'o','р':'p','Р':'p',
  'с':'c','С':'c','у':'y','У':'y','х':'x','Х':'x','і':'i','І':'i',
  'к':'k','К':'k','м':'m','М':'m','н':'h','Н':'h','т':'t','Т':'t',
  'в':'b','В':'b','ѕ':'s','Ѕ':'s','ј':'j','Ј':'j','ԁ':'d','ո':'n','օ':'o','ա':'a',
  // Cyrillic with strokes/hooks (fancy-text generator outputs)
  'һ':'h','Һ':'h','ӏ':'i','Ӏ':'i','ԛ':'q','Ԛ':'q','ԝ':'w','Ԝ':'w',
  'ҙ':'z','Ҙ':'z','ӡ':'z','Ӡ':'z',
  'ғ':'f','Ғ':'f','ӄ':'k','Ӄ':'k','ҟ':'k','Ҟ':'k','ѵ':'v','Ѵ':'v',
  'џ':'u','Џ':'u',
  // Greek
  'α':'a','ε':'e','ο':'o','υ':'u','ν':'v','ρ':'p','τ':'t','ι':'i',
  'κ':'k','μ':'m','χ':'x','γ':'y',
  // Roman numerals
  'ⅰ':'i','ⅼ':'l','ⅽ':'c','ⅾ':'d','ⅿ':'m','ⅴ':'v',
  // Fullwidth
  'ａ':'a','ｂ':'b','ｃ':'c','ｄ':'d','ｅ':'e','ｆ':'f','ｇ':'g','ｈ':'h',
  'ｉ':'i','ｊ':'j','ｋ':'k','ｌ':'l','ｍ':'m','ｎ':'n','ｏ':'o','ｐ':'p',
  'ｑ':'q','ｒ':'r','ｓ':'s','ｔ':'t','ｕ':'u','ｖ':'v','ｗ':'w','ｘ':'x',
  'ｙ':'y','ｚ':'z',
  // Small Capitals (Phonetic Extensions, U+1D00 block) — fancy-text generators
  'ᴀ':'a','ʙ':'b','ᴄ':'c','ᴅ':'d','ᴇ':'e','ꜰ':'f','ɢ':'g','ʜ':'h',
  'ɪ':'i','ᴊ':'j','ᴋ':'k','ʟ':'l','ᴍ':'m','ɴ':'n','ᴏ':'o','ᴘ':'p',
  'ǫ':'q','ʀ':'r','ᴛ':'t','ᴜ':'u','ᴠ':'v','ᴡ':'w','ʏ':'y','ᴢ':'z',
  // IPA / phonetic letter lookalikes (U+0250–U+02AF)
  // Note: ʄ (U+0284) is technically an IPA "j" but is used as "f" in fancy-text
  // generators due to visual hook resemblance — mapped to "f" for bypass coverage.
  'ɐ':'a','ɑ':'a','ɒ':'a','ɓ':'b','ɔ':'c','ƈ':'c','ɕ':'c',
  'ɖ':'d','ɗ':'d','ɘ':'e','ə':'e','ɛ':'e','ɜ':'e','ɝ':'e','ɞ':'e',
  'ɟ':'j','ʄ':'f','ɠ':'g','ɡ':'g','ɣ':'y','ɤ':'o','ɥ':'h',
  'ɦ':'h','ɧ':'h','ɨ':'i','ɫ':'l','ɬ':'l','ɭ':'l','ɮ':'l',
  'ɯ':'m','ɰ':'m','ɱ':'m','ɲ':'n','ɳ':'n','ɵ':'o','ɶ':'o',
  'ɷ':'o','ɸ':'p','ɹ':'r','ɺ':'r','ɻ':'r','ɼ':'r','ɽ':'r','ɾ':'r',
  'ɿ':'r','ʁ':'r','ʂ':'s','ʃ':'s','ʅ':'s','ʆ':'s','ʇ':'t',
  'ʈ':'t','ʉ':'u','ʊ':'u','ʋ':'v','ʌ':'v','ʍ':'w','ʎ':'y',
  'ʐ':'z','ʑ':'z','ʒ':'z',
  // Latin Extended with strokes/bars (don't NFKD-decompose)
  'ŧ':'t','Ŧ':'t','đ':'d','Đ':'d','ð':'d','Ð':'d',
  'ħ':'h','Ħ':'h','ł':'l','Ł':'l','ø':'o','Ø':'o',
  'ƀ':'b','Ƀ':'b','ƃ':'b','Ƃ':'b',
  'ƒ':'f','Ƒ':'f','ƕ':'h','Ƕ':'h','ƙ':'k','Ƙ':'k',
  'ƞ':'n','Ɲ':'n','ƥ':'p','Ƥ':'p',
  'ƫ':'t','Ƭ':'t','ƭ':'t','ƴ':'y','Ƴ':'y','ƶ':'z','Ƶ':'z',
  // Cherokee letters are added programmatically below (see buildCherokeeMap)
  // using explicit codepoints to avoid char-literal/codepoint mismatch bugs.
  // Armenian letters that occasionally appear in mixed-script bypasses
  'ե':'e',
  // Hebrew/other vertical-stroke chars used as 'i'
  'ו':'i',
};

// Cherokee block sweep (U+13A0–U+13F4). Many Cherokee letters render visually
// identical to Latin uppercase letters in non-Cherokee fonts, which is the
// most common rendering on Western devices. Coverage based on Unicode TR39
// confusables data and observed slur-bypass patterns.
(function buildCherokeeMap() {
  const cherokee = [
    [0x13A0,'d'],[0x13A1,'r'],[0x13A2,'i'],[0x13A4,'y'],[0x13A5,'i'],
    [0x13A6,'g'],[0x13A9,'g'],[0x13AA,'a'],[0x13AB,'j'],[0x13AC,'e'],
    [0x13B3,'w'],[0x13B6,'g'],[0x13B7,'m'],[0x13BB,'h'],[0x13BD,'y'],
    [0x13BE,'z'],[0x13C0,'g'],[0x13C1,'n'],[0x13C2,'h'],[0x13C3,'z'],
    [0x13C6,'t'],[0x13CC,'w'],[0x13CF,'b'],[0x13D2,'r'],[0x13D4,'w'],
    [0x13D8,'d'],[0x13D9,'v'],[0x13DA,'s'],[0x13DC,'l'],[0x13DE,'l'],
    [0x13DF,'c'],[0x13E2,'p'],[0x13ED,'p'],[0x13EE,'g'],[0x13F4,'b'],
  ];
  for (const [cp, ch] of cherokee) {
    HOMOGLYPHS[String.fromCodePoint(cp)] = ch;
    // toLowerCase() converts Cherokee uppercase (U+13A0+) to Cherokee Small
    // Letters (U+AB70+), a SEPARATE Unicode block. Since lowercasing runs
    // before the homoglyph pass, we must map both ranges. Use the language's
    // own case-folding to find the lowercase form — robust against any
    // codepoints that don't follow the standard +0x97D0 offset.
    const lower = String.fromCodePoint(cp).toLowerCase();
    if (lower !== String.fromCodePoint(cp)) HOMOGLYPHS[lower] = ch;
  }
})();

// Build Negative-Circled / Negative-Squared / Squared letter mappings
// (U+1F130–U+1F149, U+1F150–U+1F169, U+1F170–U+1F189) at module load.
(function buildEnclosedLetterMap() {
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(97 + i); // a-z
    HOMOGLYPHS[String.fromCodePoint(0x1F130 + i)] = letter; // Squared (🄰-🅉)
    HOMOGLYPHS[String.fromCodePoint(0x1F150 + i)] = letter; // Negative Circled (🅐-🅩)
    HOMOGLYPHS[String.fromCodePoint(0x1F170 + i)] = letter; // Negative Squared (🅰-🆉)
  }
})();

// Build Regional Indicator Symbol Letter mappings (U+1F1E6–U+1F1FF).
// These are the flag-emoji building blocks. When sent in isolation (or in
// odd-numbered groups so they don't pair into flags) they render as boxed
// letters and are a real-world slur-bypass vector ("🇳🇮🇬🇬🇪🇷").
(function buildRegionalIndicatorMap() {
  for (let i = 0; i < 26; i++) {
    HOMOGLYPHS[String.fromCodePoint(0x1F1E6 + i)] = String.fromCharCode(97 + i);
  }
})();

// Leet-speak / shape-class folding. Every character on the LEFT collapses to
// the canonical letter on the RIGHT. This is where the visual-confusion
// classes (i/l/1/|/!, o/0, a/4/@, e/3, etc.) are resolved into one form.
//
// CRITICAL: 'l' → 'i' is here. This catches the I/l/1 visual-confusion bypass
// (e.g., "NlGGER" with a lowercase L). Because BLOCKED and ALLOWLIST are
// re-normalized at module load with this same map, blocked words that legit-
// imately contain 'l' (niglet, mongoloid, bullshit, salope, ...) still match.
const LEET_MAP = {
  '@':'a','4':'a','λ':'a','ª':'a','^':'a',
  '8':'b','ß':'b','β':'b',
  '(':'c','{':'c','¢':'c','©':'c','<':'c',
  '3':'e','€':'e',
  '6':'g','9':'g',
  '#':'h',
  // I/l/1/|/!/¡/ı/)/} all collapse to 'i' — covers N)gger, N}gger, etc.
  '1':'i','!':'i','|':'i','¡':'i','ı':'i','l':'i',')':'i','}':'i',
  '0':'o','°':'o','ω':'o',
  '5':'s','$':'s','§':'s',
  '7':'t','+':'t',
  '2':'z',
};

function applyMap(str, map) { let out = ''; for (const ch of str) out += map[ch] ?? ch; return out; }
function stripDiacritics(str) { return str.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); }

function stripInvisible(str) {
  return str
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g, '')
    .replace(/[\u{E0020}-\u{E007F}]/gu, ''); // Tag characters (invisible Unicode tags)
}

function normalizeBase(text) {
  let s = text.toLowerCase();
  s = stripInvisible(s);
  // Apply homoglyphs BEFORE NFKD: single-codepoint lookalikes (Cyrillic, IPA,
  // small caps, with-stroke Latin, Cherokee, regional indicators) get mapped first.
  s = applyMap(s, HOMOGLYPHS);
  // NFKD then handles Mathematical Alphanumerics (𝐟 → f), squared letters
  // that decompose, and combining-mark diacritics.
  s = stripDiacritics(s);
  // Re-lowercase: NFKD on Mathematical Bold/Italic/Sans/etc. UPPERCASE letters
  // (𝐍, 𝙉, 𝗡 …) decomposes to ASCII UPPERCASE, which would otherwise survive
  // the rest of the pipeline because HOMOGLYPHS keys are non-ASCII.
  s = s.toLowerCase();
  // Second homoglyph pass for codepoints exposed after NFKD decomposition.
  s = applyMap(s, HOMOGLYPHS);
  s = applyMap(s, LEET_MAP);
  return s;
}

function normalizeAggressive(text) { return normalizeBase(text).replace(/[^a-z0-9]/g, ''); }
function normalizeSoft(text) { return normalizeBase(text).replace(/[^a-z0-9]+/g, ' ').trim(); }

// ── Pre-normalize the BLOCKED and ALLOWLIST at module load ────────
// Because LEET_MAP folds 'l' → 'i' (and other shape-class collapses), the
// same canonicalization MUST be applied to the wordlists themselves —
// otherwise the needle "niglet" would never match the haystack "nigiet"
// (which is what "niglet" canonicalizes to). All comparisons happen in
// canonical space.
const NORMALIZED_BLOCKED = BLOCKED.map(w => normalizeAggressive(w));
const NORMALIZED_ALLOWLIST = ALLOWLIST.map(w => normalizeAggressive(w));

function fuzzyContains(haystack, needle) {
  if (needle.length < 4) return haystack.includes(needle);
  const escaped = needle.split('').map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = escaped.map(c => `${c}+`).join('.?');
  return new RegExp(pattern).test(haystack);
}

function repeatContains(haystack, needle) {
  const escaped = needle.split('').map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = escaped.map(c => `${c}+`).join('');
  return new RegExp(pattern).test(haystack);
}

function checkBlocklist(haystack, needle) {
  return needle.length >= 4 ? fuzzyContains(haystack, needle) : repeatContains(haystack, needle);
}

// Word-boundary variant for very short needles. Anchors the repeat pattern at a
// \b so a 3-letter slur ("wop", "fuk") only matches at the start of a token —
// NOT mid-string inside an innocent concatenation ("two plates" → "twoplates",
// "low options" → "lowoptions"). Run against the SOFT (space-preserving) text.
function boundedContains(haystack, needle) {
  const escaped = needle.split('').map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = '\\b' + escaped.map(c => `${c}+`).join('');
  return new RegExp(pattern).test(haystack);
}

// ── Star/symbol masking bypass detector ───────────────────────────────────
// Catches "ni**er", "f**k", "b*tch" and similar patterns where asterisks or
// hash signs mask one or more letters in the middle of a slur. Strategy:
//   1. Find runs of [*#] that are sandwiched between alphanumeric characters.
//   2. For each such run, check if any blocked word (a) shares the same
//      non-masked prefix/suffix and (b) has a plausible masked mid-section.
//   3. Allow list check: only flag if the matched blocked word isn't explained
//      by a legitimate allowlist word that also appears in the original text.
//
// This check is skipped entirely when the input contains no * or #, so it
// has zero cost for the normal (non-bypass) path.
function checkStarMasked(text) {
  if (!/[*#]/.test(text)) return false;
  const base = normalizeBase(text);
  const aggressiveOrig = normalizeAggressive(text); // original (for allowlist context)
  // Match: alpha+ then star/hash run then alpha+
  const maskPattern = /([a-z0-9]+)[*#]+([a-z0-9]+)/g;
  let m;
  while ((m = maskPattern.exec(base)) !== null) {
    const prefix = m[1];
    const suffix = m[2];
    const minLen = prefix.length + suffix.length;
    for (const blocked of NORMALIZED_BLOCKED) {
      // At least 1 letter must be masked; gap can't be implausibly long (>8).
      const maskedLen = blocked.length - minLen;
      if (maskedLen < 1 || maskedLen > 8) continue;
      if (!blocked.startsWith(prefix)) continue;
      if (!blocked.endsWith(suffix)) continue;
      // Allowlist check — require the allowlist word to also appear in the
      // original text (not just the blocked word) to prevent blanket excuses.
      const explained = NORMALIZED_ALLOWLIST.some(
        allowed => checkBlocklist(allowed, blocked) && aggressiveOrig.includes(allowed)
      );
      if (!explained) return true;
    }
  }
  return false;
}

/**
 * Returns true if `text` contains blocked profanity.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {'public'|'dm'} [options.context='public']
 *   Pass context:'dm' to skip filtering — direct messages between consenting
 *   adults are private and not moderated. All public surfaces (posts, comments,
 *   workout notes, meal names, usernames) use the default 'public' context.
 */
// ── Reverse-check skip list ───────────────────────────────────────────────────
// These words are still checked FORWARD but NOT in the reversed string.
// Reason: they're non-English words (Portuguese/Russian/Polish/German/Italian)
// that nobody bypasses by typing backwards, and their reversed patterns
// produce false positives in common English phrases.
const SKIP_REVERSE = new Set([
  'porra','foda','caralho',              // Portuguese — "narrow passage" FP
  'kurwa','chuj','pierdolic','jebac',    // Polish
  'blyat','blyad','suka','pizdec','pizda', // Russian
  'scheisse','arschloch','fotze','wichser', // German
  'cazzo','stronzo','stronza','puttana','troia','vaffanculo', // Italian
]);
const SKIP_REVERSE_NORMALIZED = new Set(
  [...SKIP_REVERSE].map(w => normalizeAggressive(w))
);

// ── Context-explained map ─────────────────────────────────────────────────────
// Some blocked words (usually short leet-variants) fuzzy-match across word
// boundaries in innocent compound strings. If ANY context word appears in the
// normalized soft text, the hit is suppressed.
//
// Format: { normalizedBlockedWord: [contextWord, ...] }
// Context words are raw (pre-normalization); normalization is applied at call time.
const CONTEXT_EXPLAINED_RAW = {
  // "kunt" (variant of cunt) fuzzy-matches "cockburnstreet", "scunthorpe" etc.
  kunt: ['cockburn', 'scunthorpe', 'cunthorpe'],
  // "kock" (variant of cock) fuzzy-matches "ciockwork" (clockwork after l→i)
  kock: ['clock', 'clockwork', 'block', 'flock', 'dock', 'lock', 'knock', 'rock', 'stock', 'mock', 'frock'],
  // "kawk" (variant of cock) fuzzy-matches reversed "walk" or "chalk" phrases
  kawk: ['walk', 'chalk', 'stalk', 'talk', 'hawk', 'block'],
};
// Pre-normalize the context words once at module load
const CONTEXT_EXPLAINED = Object.fromEntries(
  Object.entries(CONTEXT_EXPLAINED_RAW).map(([k, words]) => [k, words.map(normalizeAggressive)])
);

/**
 * Returns true if `text` contains blocked profanity.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {'public'|'dm'} [options.context='public']
 *   Pass context:'dm' to skip filtering — direct messages between consenting
 *   adults are private and not moderated. All public surfaces (posts, comments,
 *   workout notes, meal names, usernames) use the default 'public' context.
 */
export function containsProfanity(text, { context = 'public' } = {}) {
  // Direct messages are private — no filter applied.
  if (context === 'dm') return false;

  if (!text || typeof text !== 'string') return false;
  const aggressive = normalizeAggressive(text);
  const reversed   = aggressive.split('').reverse().join('');
  const soft       = normalizeSoft(text);

  // Build hit list: forward check for all words; reverse check only for
  // English-origin slurs (SKIP_REVERSE excludes foreign-language words).
  const hits = NORMALIZED_BLOCKED.filter((w) => {
    // Short needles (≤3 chars: "wop", "fuk", "fuq") only match as a bounded
    // token in the space-preserving text. A 3-letter substring otherwise fires
    // inside innocent concatenations — "two plates" → "twoplates" contains
    // "wop", "low options" → "lowoptions" too. Boundary matching still catches
    // the real slur ("you wop", "wops").
    if (w.length < 4) return boundedContains(soft, w);
    // Longer needles: forward fuzzy on the space-stripped text, plus a reverse
    // pass — but reverse only for words ≥5. Reversing a 3–4 letter slur isn't a
    // real evasion, and reverse-fuzzy of short words matches common food words
    // ("chips" → spic, "dogs and" → dago, "power" → wop).
    return checkBlocklist(aggressive, w) ||
      (w.length >= 5 && !SKIP_REVERSE_NORMALIZED.has(w) && checkBlocklist(reversed, w));
  });

  if (hits.length > 0) {
    for (const hit of hits) {
      // Primary allowlist check: an allowlist entry must (a) fuzzy-contain the
      // blocked word AND (b) actually appear in the input text.
      let explained = NORMALIZED_ALLOWLIST.some(
        allowed => checkBlocklist(allowed, hit) && soft.includes(allowed)
      );

      // Secondary: context-word explanation for short leet-variants that fuzzy-
      // match across word boundaries ("kunt" in "cockburnstreet", etc.).
      if (!explained) {
        const ctxWords = CONTEXT_EXPLAINED[hit];
        if (ctxWords) {
          explained = ctxWords.some(cw => soft.includes(cw));
        }
      }

      if (!explained) return true;
    }
  }

  // Final pass: star/hash masking bypass (e.g. "ni**er", "f**k")
  return checkStarMasked(text);
}