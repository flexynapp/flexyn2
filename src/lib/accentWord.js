// Which word of a headline gets painted with the accent colour.
//
// Onboarding's two heroes animate a heading word by word, so the accented word
// cannot be marked up inside the string — the string has to survive being split
// on spaces in fifteen languages. Instead a separate `accentWord` value names
// the word to paint, and each hero compares it against the words it is
// rendering. This module is that comparison, and it lives here because it had
// been written twice, inline, slightly differently, and was wrong both times.
//
// Two rules the callers depend on:
//
//   Punctuation is stripped from BOTH sides. It used to be stripped from the
//   word only, so an accent word written with its punctuation — "for?" against
//   a heading token that strips to "for" — matched nothing. Five call sites
//   shipped that way and lost their accent in English as well as in
//   translation.
//
//   An empty accent word matches nothing. French sets a "?" off with a
//   non-breaking space, so the mark arrives as its own token and strips to the
//   empty string; without this guard a blank accent word would paint it.

// The marks that ride along with a word in the locales the app offers: ASCII
// sentence punctuation, the Spanish inverted pair, French guillemets, and the
// colon/semicolon pair French spaces out.
const PUNCT = /[.,!?¡¿;:«»…]/g;

/** Strip the punctuation a word may carry, leaving the word itself. */
export const bare = (s) => String(s ?? '').replace(PUNCT, '');

/** True when `word` is the accented word of a headline. */
export const isAccent = (word, accentWord) => {
  const accent = bare(accentWord);
  return accent !== '' && bare(word) === accent;
};

/** How many words of `heading` the accent word matches. Exactly 1 is correct. */
export const accentHits = (heading, accentWord) =>
  String(heading ?? '').split(' ').filter((w) => isAccent(w, accentWord)).length;
