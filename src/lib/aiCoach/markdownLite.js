// src/lib/aiCoach/markdownLite.js
//
// The coach writes its replies in markdown — responders.js alone bolds nine
// different lines ("**You've trained 4 times in the last 7 days.**") — but
// MessageBubble renders them as plain pre-wrapped text, so every one of those
// emphasis markers reached the user as literal asterisks. Bold is the strongest
// scanning cue in a wall of chat text; shipping it inverted made the most
// important line in each reply the noisiest one.
//
// This is deliberately NOT a markdown parser. The coach's copy uses exactly one
// inline construct (**bold**), lists are already plain "• " bullets rendered by
// whitespace-pre-wrap, and links are never emitted. Anything richer would be a
// dependency and an XSS surface for a formatting vocabulary of one.
//
// Pure — returns segments, renders nothing. The component maps them to <strong>.

/**
 * Split text into ordered { text, bold } segments on **…** pairs.
 *
 * Unmatched or empty markers are left verbatim: "2 * 3 ** 4" is arithmetic, and
 * a dangling "**" at the end of a truncated LLM reply should read as the text
 * it is rather than swallow the rest of the message into a bold run.
 *
 * @param {string} input
 * @returns {Array<{ text: string, bold: boolean }>}
 */
export function parseBoldSegments(input) {
  const text = typeof input === 'string' ? input : '';
  if (!text) return [];

  const segments = [];
  // Non-greedy, no newlines inside a run: an unclosed marker then dies at the
  // end of its own line instead of bolding every paragraph that follows it.
  const re = /\*\*([^\n*][^\n]*?)\*\*/g;
  let last = 0;
  let m;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), bold: false });
    segments.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), bold: false });

  return segments;
}
