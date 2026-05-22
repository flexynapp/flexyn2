// Tests for src/lib/highlightMatches.js — the segment-splitter used by
// the in-thread DM search overlay to render highlighted matches.

import { describe, it, expect } from 'vitest';
import { highlightMatches, countMatches } from '../highlightMatches';

describe('highlightMatches', () => {
  it('returns the whole string as one non-match segment when query is empty', () => {
    expect(highlightMatches('hello world', '')).toEqual([{ text: 'hello world', match: false }]);
    expect(highlightMatches('hello world', null)).toEqual([{ text: 'hello world', match: false }]);
    expect(highlightMatches('hello world', '   ')).toEqual([{ text: 'hello world', match: false }]);
  });

  it('splits around a single match (case-insensitive)', () => {
    expect(highlightMatches('hello WORLD', 'world')).toEqual([
      { text: 'hello ', match: false },
      { text: 'WORLD', match: true },
    ]);
  });

  it('splits multiple matches', () => {
    expect(highlightMatches('foo bar foo', 'foo')).toEqual([
      { text: 'foo', match: true },
      { text: ' bar ', match: false },
      { text: 'foo', match: true },
    ]);
  });

  it('handles a match at the very end', () => {
    expect(highlightMatches('abc def', 'def')).toEqual([
      { text: 'abc ', match: false },
      { text: 'def', match: true },
    ]);
  });

  it('handles non-string input gracefully', () => {
    expect(highlightMatches(null, 'x')).toEqual([{ text: '', match: false }]);
    expect(highlightMatches(undefined, 'x')).toEqual([{ text: '', match: false }]);
  });
});

describe('countMatches', () => {
  it('counts case-insensitive matches', () => {
    expect(countMatches('foo Foo FOO', 'foo')).toBe(3);
  });

  it('returns 0 for empty / null inputs', () => {
    expect(countMatches('', 'x')).toBe(0);
    expect(countMatches('x', '')).toBe(0);
    expect(countMatches(null, 'x')).toBe(0);
    expect(countMatches('x', null)).toBe(0);
  });

  it('does not overlap matches', () => {
    // "aaa" + query "aa" should count 1 (non-overlapping)
    expect(countMatches('aaa', 'aa')).toBe(1);
  });
});
