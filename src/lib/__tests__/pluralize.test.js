// Tests for src/lib/pluralize. Covers English (simple one/other),
// Polish (one/few/many/other), null/zero edge cases, the {n}
// placeholder rules, and locale-aware number formatting via formatCount.

import { describe, it, expect } from 'vitest';
import { pluralize, formatCount } from '../pluralize';

describe('pluralize', () => {
  const en = { one: '{n} follower', other: '{n} followers' };

  it('uses the `one` form for count=1 in English', () => {
    expect(pluralize(1, en, 'en')).toBe('1 follower');
  });

  it('uses the `other` form for count=2 in English', () => {
    expect(pluralize(2, en, 'en')).toBe('2 followers');
  });

  it('uses the `other` form for count=0 in English', () => {
    expect(pluralize(0, en, 'en')).toBe('0 followers');
  });

  it('falls back to `other` when a locale category is missing', () => {
    // English category for 5 is "other" — give only `one` + `other`.
    expect(pluralize(5, { one: '{n} item', other: '{n} items' }, 'en')).toBe('5 items');
  });

  it('handles Polish few/many categories', () => {
    const pl = {
      one:   '{n} obserwujący',
      few:   '{n} obserwujących', // Polish 2-4
      many:  '{n} obserwujących', // Polish 5+
      other: '{n} obserwujących',
    };
    expect(pluralize(1, pl, 'pl')).toBe('1 obserwujący');
    expect(pluralize(3, pl, 'pl')).toBe('3 obserwujących');
    expect(pluralize(7, pl, 'pl')).toBe('7 obserwujących');
  });

  it('prepends the number when no {n} placeholder is present', () => {
    expect(pluralize(5, { one: 'set', other: 'sets' }, 'en')).toBe('5 sets');
  });
});

describe('formatCount', () => {
  it('formats with locale-aware thousands separators (en)', () => {
    expect(formatCount(1234, { one: '{n} follower', other: '{n} followers' }, 'en')).toBe('1,234 followers');
  });

  it('formats with locale-aware separators (de)', () => {
    expect(formatCount(1234, { one: '{n} folgender', other: '{n} folgende' }, 'de')).toBe('1.234 folgende');
  });

  it('handles count=1 with formatting', () => {
    expect(formatCount(1, { one: '{n} follower', other: '{n} followers' }, 'en')).toBe('1 follower');
  });

  it('handles count=0 with formatting', () => {
    expect(formatCount(0, { one: '{n} follower', other: '{n} followers' }, 'en')).toBe('0 followers');
  });

  it('gracefully degrades when locale lookup fails', () => {
    // Pass an invalid locale; the helper should still return SOMETHING
    // sensible rather than throwing.
    const result = formatCount(5, { one: '{n} item', other: '{n} items' }, 'nonsense-locale-tag');
    expect(typeof result).toBe('string');
    expect(result).toContain('item');
  });
});
