// src/lib/__tests__/journalDictation.test.js
//
// Dictation always appended to the END of the entry, so speaking a
// correction into the middle of a session write-up filed it at the
// bottom — further from where the user was looking the longer the entry
// got.
//
// The sequential case is the one worth pinning: speech arrives in
// chunks, and inserting each at the ORIGINAL caret would lay them down
// back to front, so "felt sharp" then "and quick" would read "and quick
// felt sharp".

import { describe, it, expect } from 'vitest';
import { insertDictation } from '../journalDictation';

describe('insertDictation', () => {
  it('inserts at the caret rather than the end', () => {
    const r = insertDictation('Warm-up done. Main work next.', 14, 'felt sharp');
    expect(r.text).toBe('Warm-up done. felt sharp Main work next.');
  });

  it('walks the caret forward so consecutive chunks stay in spoken order', () => {
    let state = { text: 'Warm-up done. Main work next.', caret: 14 };
    for (const chunk of ['felt sharp', 'and quick']) {
      const r = insertDictation(state.text, state.caret, chunk);
      state = { text: r.text, caret: r.caret };
    }
    expect(state.text).toBe('Warm-up done. felt sharp and quick Main work next.');
    // The failure this guards: re-using the original caret every time.
    expect(state.text).not.toContain('and quick felt sharp');
  });

  it('appends when there is no caret — the mic was tapped away from the field', () => {
    const r = insertDictation('Bench felt heavy.', null, 'shoulder twinge');
    expect(r.text).toBe('Bench felt heavy. shoulder twinge');
  });

  it('appends rather than PREPENDS when the caret is nonsense', () => {
    // A stale selectionStart of 0 after a blur would put the sentence at
    // the very top of the entry, which is a worse wrong answer than the
    // end. Out-of-range values fall back to appending.
    expect(insertDictation('Bench felt heavy.', 999, 'x').text).toBe('Bench felt heavy. x');
    expect(insertDictation('Bench felt heavy.', -1, 'x').text).toBe('Bench felt heavy. x');
  });

  it('honours a real caret of 0 — that is a deliberate position, not a stale one', () => {
    expect(insertDictation('rest of it', 0, 'Start').text).toBe('Start rest of it');
  });

  it('adds a space only where one is missing', () => {
    expect(insertDictation('', null, 'First words').text).toBe('First words');
    expect(insertDictation('Line one\n', null, 'Line two').text).toBe('Line one\nLine two');
    expect(insertDictation('Ends with space ', null, 'next').text).toBe('Ends with space next');
  });

  it('is a no-op for an empty or whitespace transcript', () => {
    const r = insertDictation('Bench felt heavy.', 5, '   ');
    expect(r.text).toBe('Bench felt heavy.');
    expect(r.caret).toBe(5);
  });

  it('treats a missing body as empty rather than throwing', () => {
    expect(insertDictation(undefined, null, 'words').text).toBe('words');
  });
});
