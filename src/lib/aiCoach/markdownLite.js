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

// Characters that separate a clause, not a number range: an em dash anywhere,
// or an en dash / hyphen with spaces on both sides. "160–180 g" keeps its en
// dash; "a session — it does not" does not.
const CLAUSE_DASH = /\s*—\s*|\s+[–-]\s+/g;

function capitalise(s) {
  return s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s;
}

/**
 * Tidy a coach reply for display. The model is told the house format, and a
 * probe of the live function on 2026-09-29 found it drifting anyway: an em
 * dash in nine replies of ten (Kegan's standing rule is no dashes in display
 * copy), `*italic*` markers that render as literal asterisks, and bullets
 * that start lowercase after a capitalised first one. The rule-based
 * fallback in responders.js carries the same dashes. Fixing it here covers
 * both sources and every reply already saved in someone's history.
 *
 *  - a clause dash becomes a comma, never touching a numeric range
 *  - "- ", "* " and "– " list markers become "• ", and a bullet starts
 *    with a capital
 *  - a lone *italic* or a "# heading" loses its marker
 *
 * @param {string} input
 * @returns {string}
 */
export function cleanCoachText(input) {
  const text = typeof input === 'string' ? input.replace(/\r\n?/g, '\n') : '';
  if (!text) return '';

  const lines = text.split('\n').map((raw) => {
    let line = raw.replace(/^\s*#{1,6}\s+(.+)$/, '**$1**');
    const bullet = line.match(/^\s*(?:[-*–•])\s+(.*)$/);
    if (bullet) line = `• ${capitalise(bullet[1].trim())}`;
    return line;
  });

  return lines.map(undash).join('\n')
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1$2')
    .replace(/,\s*([.,;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Words that open a continuation rather than a new sentence, in the three
// released languages. Before one of these a dash becomes a comma.
const CONJUNCTION = /^(and|but|or|so|yet|y|pero|o|así|mais|et|ou|donc)\b/i;

// The rewrite follows the house rules for removing a dash (CLAUDE.md, i18n
// section): two dashes around an aside become two commas, a dash before a
// conjunction becomes a comma, and anything else becomes two sentences.
function undash(line) {
  const hits = [...line.matchAll(CLAUSE_DASH)].filter((m) =>
    line.slice(0, m.index).trim() && line.slice(m.index + m[0].length).trim());
  if (!hits.length) return line;
  const paired = hits.length === 2
    && !/[.!?]/.test(line.slice(hits[0].index + hits[0][0].length, hits[1].index));
  let out = '';
  let last = 0;
  for (const m of hits) {
    out += line.slice(last, m.index);
    const rest = line.slice(m.index + m[0].length);
    if (/[.,;:!?]$/.test(out)) {
      out += ' ';
    } else if (paired || CONJUNCTION.test(rest)) {
      out += ', ';
    } else {
      out += '. ';
      last = m.index + m[0].length;
      const next = line.charAt(last);
      out += next.toLocaleUpperCase();
      last += 1;
      continue;
    }
    last = m.index + m[0].length;
  }
  return out + line.slice(last);
}

/**
 * Group a cleaned reply into paragraphs and bullet lists, so a wrapped bullet
 * can hang under its own text instead of running back under the "•".
 *
 * @param {string} input  already passed through cleanCoachText
 * @returns {Array<{ type: 'p', text: string } | { type: 'list', items: string[] }>}
 */
export function parseCoachBlocks(input) {
  const text = typeof input === 'string' ? input : '';
  const blocks = [];
  for (const chunk of text.split(/\n\s*\n/)) {
    let para = [];
    let list = null;
    const flushPara = () => {
      if (para.length) blocks.push({ type: 'p', text: para.join('\n') });
      para = [];
    };
    for (const line of chunk.split('\n')) {
      const bullet = line.match(/^\s*•\s*(.*)$/);
      if (bullet) {
        flushPara();
        if (!list) { list = { type: 'list', items: [] }; blocks.push(list); }
        list.items.push(bullet[1]);
      } else if (line.trim()) {
        list = null;
        para.push(line);
      }
    }
    flushPara();
  }
  return blocks;
}
