import { describe, it, expect } from 'vitest';
import { escapeLikePattern } from '../sqlPattern';

// The bug this guards: onboarding's username availability check ran
// `.ilike('username', 'jordan_lifts')`. `_` is a single-character wildcard, so
// it matched an existing `jordanxlifts` and reported the name as taken — and
// because that error disables the Continue button, it blocked signup for every
// username containing an underscore, a shape the field's own placeholder
// recommends. The regexes below mirror Postgres' LIKE semantics so the
// assertions describe MATCHING behaviour, not just string output.

/** Translate a LIKE pattern (backslash escapes) into an equivalent RegExp. */
function likeToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {                       // escaped → next char is literal
      i++;
      out += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else if (ch === '%') out += '.*';
    else if (ch === '_') out += '.';
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

describe('escapeLikePattern', () => {
  it('escapes the underscore wildcard', () => {
    expect(escapeLikePattern('jordan_lifts')).toBe('jordan\\_lifts');
  });

  it('escapes percent and backslash too', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
  });

  it('leaves an ordinary username untouched', () => {
    expect(escapeLikePattern('jordanlifts')).toBe('jordanlifts');
  });

  it('coerces null and undefined to an empty pattern', () => {
    expect(escapeLikePattern(null)).toBe('');
    expect(escapeLikePattern(undefined)).toBe('');
  });

  describe('matching behaviour', () => {
    const escaped = escapeLikePattern('jordan_lifts');

    it.each(['jordanxlifts', 'jordan1lifts', 'jordan.lifts'])(
      'no longer collides with %s',
      (existing) => {
        expect(likeToRegExp('jordan_lifts').test(existing)).toBe(true);   // the bug
        expect(likeToRegExp(escaped).test(existing)).toBe(false);          // the fix
      },
    );

    it('still matches the identical name, case-insensitively', () => {
      expect(likeToRegExp(escaped).test('jordan_lifts')).toBe(true);
      expect(likeToRegExp(escaped).test('JORDAN_LIFTS')).toBe(true);
    });

    it('keeps caller-supplied wildcards working when placed outside the call', () => {
      const contains = `%${escapeLikePattern('jordan_lifts')}%`;
      expect(likeToRegExp(contains).test('xx-jordan_lifts-xx')).toBe(true);
      expect(likeToRegExp(contains).test('xx-jordanxlifts-xx')).toBe(false);
    });
  });
});
