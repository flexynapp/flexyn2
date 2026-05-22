// src/lib/textCase.js
//
// Smart title-casing applied on input blur. Turns "bench press" into
// "Bench Press" so user libraries (workouts, regimens, goals) look
// intentional instead of scruffy. Apple Notes / Notion pattern for
// document titles.
//
// Rules:
//   1. Capitalize the first letter of every word (split on whitespace).
//   2. Lowercase common stop words mid-string (a, an, the, of, etc.)
//      UNLESS they're the first word.
//   3. Preserve all-caps acronyms (BCAA, DB, KB, OHP, EMOM, RPE, ...).
//      Acronym whitelist below.
//   4. Don't auto-title-case strings the user explicitly entered in
//      ALL CAPS (if >50% of letters are uppercase, leave as-is).
//
// API
//
//   titleCase(str, { acronyms })  → re-cased string
//
// Apply onBlur, NEVER onChange (don't edit while the user types — it
// fights the cursor).

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'of', 'in', 'on', 'at',
  'to', 'for', 'with', 'by', 'as', 'vs', 'via',
]);

// Domain-specific acronyms that should keep their all-caps form.
// Keeping this small + curated; extend as users request.
const DEFAULT_ACRONYMS = new Set([
  // Lifting / equipment
  'BCAA', 'DB', 'KB', 'BB', 'OHP', 'RDL', 'SLDL', 'GHR', 'BFR',
  // Programming / training
  'EMOM', 'AMRAP', 'HIIT', 'LISS', 'WOD', 'RPE', 'RIR', 'PPL',
  // Nutrition
  'BMR', 'TDEE', 'IIFYM', 'IF', 'OMAD',
  // Generic
  'XP', 'PR', 'AM', 'PM', 'AI', 'API', 'BBQ',
]);

function shouldPreserveAcronym(word, acronyms) {
  // Already all-caps and >= 2 letters → could be an acronym.
  const upper = word.toUpperCase();
  if (word === upper && word.length >= 2 && /^[A-Z]+$/.test(word)) {
    return true;
  }
  // Known acronym from the whitelist (case-insensitive).
  return acronyms.has(upper);
}

function isMostlyUppercase(str) {
  const letters = str.match(/[A-Za-z]/g);
  if (!letters || letters.length < 2) return false;
  const upper = letters.filter((c) => c === c.toUpperCase()).length;
  return upper / letters.length > 0.5;
}

/**
 * Title-case a string with smart preservation of stop words + acronyms.
 *
 * @param {string} input
 * @param {object} [opts]
 * @param {Set<string>} [opts.acronyms]  Override the default whitelist.
 * @returns {string}
 */
export function titleCase(input, { acronyms = DEFAULT_ACRONYMS } = {}) {
  if (typeof input !== 'string') return input;
  const trimmed = input.replace(/\s+/g, ' ').trim();
  if (!trimmed) return trimmed;

  // If the user explicitly typed mostly uppercase, respect it.
  if (isMostlyUppercase(trimmed)) return trimmed;

  return trimmed
    .split(' ')
    .map((word, idx) => {
      if (!word) return word;

      // Preserve known acronyms (whitelist) and obvious all-caps tokens.
      if (shouldPreserveAcronym(word, acronyms)) return word.toUpperCase();

      const lower = word.toLowerCase();

      // Stop words → lowercase, but never the first word.
      if (idx > 0 && STOP_WORDS.has(lower)) return lower;

      // Hyphenated word (e.g., "pull-up", "warm-up") → title-case each segment.
      if (word.includes('-')) {
        return word
          .split('-')
          .map((seg, i) => {
            if (!seg) return seg;
            if (shouldPreserveAcronym(seg, acronyms)) return seg.toUpperCase();
            const segLower = seg.toLowerCase();
            // The leading segment of the very first word is uppercase;
            // subsequent hyphen-segments are also title-cased
            // unless they're stop words.
            if (idx === 0 || i === 0) {
              return segLower.charAt(0).toUpperCase() + segLower.slice(1);
            }
            if (STOP_WORDS.has(segLower)) return segLower;
            return segLower.charAt(0).toUpperCase() + segLower.slice(1);
          })
          .join('-');
      }

      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}
