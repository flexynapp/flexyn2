// src/lib/journalListContinuation.js
//
// What Enter does inside a list in the journal editor.
//
// The journal body is a plain textarea holding markdown, so Enter inserted a
// bare newline and nothing else: type "- squats", press Enter, and the next
// line started with no dash. Sean hit this from both directions — after the
// bullet BUTTON and after typing a dash by hand — and read it as the bullet
// control doing nothing, because the only visible evidence either way is
// whether the next line continues the list.
//
// Pure and caret-based rather than a keydown handler, so the rules can be
// tested as data. The editor calls it, and falls through to the browser's
// default newline when it returns null.

/** `- item` / `* item`, capturing indent, marker and content. */
const BULLET_RE = /^(\s*)([-*])[ \t]+(.*)$/;
/** `1. item` / `1) item`, capturing indent, number, delimiter and content. */
const ORDERED_RE = /^(\s*)(\d+)([.)])[ \t]+(.*)$/;

/**
 * Decide what Enter should do at `caret` inside `body`.
 *
 * @param {string} body
 * @param {number} caret  selectionStart; only a COLLAPSED caret continues a
 *   list — with a range selected, Enter is a replace and the default wins.
 * @returns {{body: string, caret: number} | null} null = let the browser do it
 */
export function continueList(body, caret) {
  if (typeof body !== 'string' || typeof caret !== 'number' || caret < 0) return null;

  const lineStart = body.lastIndexOf('\n', caret - 1) + 1;
  // Only the text BEFORE the caret decides this. Pressing Enter in the middle
  // of "- squats and press" should carry the marker onto the split remainder,
  // which is what taking the line up to the caret gives us.
  const lineToCaret = body.slice(lineStart, caret);

  const bullet = BULLET_RE.exec(lineToCaret);
  const ordered = bullet ? null : ORDERED_RE.exec(lineToCaret);
  if (!bullet && !ordered) return null;

  const indent = (bullet || ordered)[1];
  const content = bullet ? bullet[3] : ordered[4];

  // Enter on an EMPTY item ends the list rather than adding another empty one.
  // Without this the only way out of a list is to backspace the marker the
  // editor just wrote for you, which is the behaviour people read as the
  // editor fighting them.
  if (content.trim() === '') {
    return {
      body: body.slice(0, lineStart) + body.slice(caret),
      caret: lineStart,
    };
  }

  const marker = bullet
    ? `${indent}${bullet[2]} `
    // Renumbering the whole list on every keystroke is not worth it: markdown
    // renderers (ours included) number an ordered list by position, so the
    // literal digits never reach the screen. Incrementing keeps the SOURCE
    // readable for someone editing it by hand.
    : `${indent}${Number(ordered[2]) + 1}${ordered[3]} `;

  const insert = `\n${marker}`;
  return {
    body: body.slice(0, caret) + insert + body.slice(caret),
    caret: caret + insert.length,
  };
}
