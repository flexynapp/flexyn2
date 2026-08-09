// src/lib/journalDictation.js
//
// Where a dictated chunk lands in the entry.
//
// It always went on the END, so dictating a correction into the middle of
// an entry filed it at the bottom instead — and the longer the entry, the
// further from where the user was looking.
//
// Extracted from JournalView because it cannot be driven from the outside
// there: `startDictation` is an ES module binding, so a test cannot stub
// the speech engine, and the mic button does not even render on a browser
// without speech support. The placement rule is the part that can be
// wrong; the wiring around it is a `.click()`.

/**
 * @param {string} prev    current body text
 * @param {number|null} caret  where to insert, or null for "no caret known"
 * @param {string} chunk   the finalised transcript
 * @returns {{ text: string, caret: number }} new body and where the caret
 *          now sits, so the NEXT chunk continues after this one instead of
 *          re-inserting at the original point and reversing the sentence.
 */
export function insertDictation(prev, caret, chunk) {
  const body = prev || '';
  const words = (chunk || '').trim();
  if (!words) return { text: body, caret: caret == null ? body.length : caret };

  // A null caret means the mic was tapped while the textarea was not
  // focused, so we never had a real position. Append — the old behaviour,
  // and the safe direction: a stale selectionStart of 0 would PREPEND the
  // sentence to the entry, which is a worse wrong answer than appending.
  const at = caret == null || caret > body.length || caret < 0 ? body.length : caret;

  const before = body.slice(0, at);
  const after = body.slice(at);
  // Space on BOTH sides, and only where one is missing. Spacing just the
  // leading edge is enough when you always append — there is nothing after
  // the caret — and it is why the first version of this read
  // "felt sharpMain work next." the moment the caret moved into the middle
  // of an entry. Appending hid the bug that inserting exposes.
  const sepBefore = before && !/\s$/.test(before) ? ' ' : '';
  const sepAfter = after && !/^\s/.test(after) ? ' ' : '';

  return {
    text: before + sepBefore + words + sepAfter + after,
    // Sits immediately after the spoken words, NOT after the trailing
    // space: the next chunk applies its own leading-space rule, and
    // counting the trailing one here would double it.
    caret: at + sepBefore.length + words.length,
  };
}
