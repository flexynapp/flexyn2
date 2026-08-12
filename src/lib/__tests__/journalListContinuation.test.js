/**
 * Enter inside a list.
 *
 * The bug Sean reported was reported twice, from both directions: "if I hit
 * enter after making a bullet point — not only a bullet point, just a dash —
 * it does not create another dash." So the rule has to hold for a marker the
 * TOOLBAR wrote and for one a person typed, which is the same code path only
 * because this function looks at the text rather than at what produced it.
 */
import { describe, it, expect } from 'vitest';
import { continueList } from '@/lib/journalListContinuation';

/** Caret at the end of `body`, the common case while typing. */
const atEnd = (body) => continueList(body, body.length);

describe('continueList — bullets', () => {
  it('carries a dash onto the next line', () => {
    const r = atEnd('- squats');
    expect(r.body).toBe('- squats\n- ');
    expect(r.caret).toBe('- squats\n- '.length);
  });

  it('carries an asterisk marker too, preserving which one was used', () => {
    expect(atEnd('* squats').body).toBe('* squats\n* ');
  });

  it('preserves indentation so a nested list stays nested', () => {
    expect(atEnd('  - deep').body).toBe('  - deep\n  - ');
  });

  it('continues from a marker typed by hand, not just one the toolbar wrote', () => {
    // There is no state saying "we are in a list" — the text IS the state.
    // This is the case Sean called out explicitly.
    expect(atEnd('- one\n- two').body).toBe('- one\n- two\n- ');
  });
});

describe('continueList — ordered lists', () => {
  it('increments the number', () => {
    expect(atEnd('1. squats').body).toBe('1. squats\n2. ');
  });

  it('keeps the delimiter style', () => {
    expect(atEnd('1) squats').body).toBe('1) squats\n2) ');
  });

  it('increments from the line it is on, not from 1', () => {
    expect(atEnd('1. a\n2. b\n3. c').body).toBe('1. a\n2. b\n3. c\n4. ');
  });
});

describe('continueList — ending a list', () => {
  it('Enter on an empty bullet removes the marker instead of adding another', () => {
    // Without this the only exit from a list is to backspace the marker the
    // editor just inserted, which reads as the editor fighting you.
    const r = atEnd('- one\n- ');
    expect(r.body).toBe('- one\n');
    expect(r.caret).toBe('- one\n'.length);
  });

  it('Enter on an empty numbered item ends the list', () => {
    expect(atEnd('1. one\n2. ').body).toBe('1. one\n');
  });

  it('treats a whitespace-only item as empty', () => {
    expect(atEnd('- one\n-    ').body).toBe('- one\n');
  });
});

describe('continueList — when it must NOT act', () => {
  it('returns null on an ordinary line so the browser inserts the newline', () => {
    expect(atEnd('just a sentence')).toBeNull();
  });

  it('returns null on an empty body', () => {
    expect(atEnd('')).toBeNull();
  });

  it('ignores a dash with no space — "-5 lbs" is not a list item', () => {
    expect(atEnd('-5 lbs today')).toBeNull();
  });

  it('ignores a bare hyphen used mid-sentence', () => {
    expect(atEnd('felt good - strong even')).toBeNull();
  });

  it('rejects a non-numeric caret rather than throwing', () => {
    expect(continueList('- a', null)).toBeNull();
    expect(continueList(null, 0)).toBeNull();
  });
});

describe('continueList — caret in the middle of an item', () => {
  it('splits the item and carries the marker onto the remainder', () => {
    // "- squats| and press" → Enter → "- squats" / "-  and press"
    const body = '- squats and press';
    const caret = '- squats'.length;
    const r = continueList(body, caret);
    expect(r.body).toBe('- squats\n-  and press');
    expect(r.caret).toBe('- squats\n- '.length);
  });

  it('decides on the text BEFORE the caret, so an empty prefix ends the list', () => {
    // Caret sits right after "- ", with text following it. The prefix is an
    // empty item, so this ends the list rather than splitting it.
    const body = '- trailing';
    const r = continueList(body, 2);
    expect(r.body).toBe('trailing');
  });
});
