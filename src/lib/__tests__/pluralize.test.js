// Tests for src/lib/pluralize. Covers English (simple one/other),
// Polish (one/few/many/other), null/zero edge cases, the {n}
// placeholder rules, and locale-aware number formatting via formatCount.

import { describe, it, expect } from 'vitest';
import { pluralize, pluralForm, formatCount } from '../pluralize';

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

describe('pluralForm', () => {
  const bare = { one: 'follower', other: 'followers' };
  const templated = { one: '{n} follower', other: '{n} followers' };

  it('returns the noun alone, with no number prepended', () => {
    // This is the whole point: pluralize(0, bare) is "0 followers", which
    // double-renders the count when the caller already shows the number in
    // its own element. The profile metrics row hit exactly that.
    expect(pluralize(0, bare, 'en')).toBe('0 followers');
    expect(pluralForm(0, bare, 'en')).toBe('followers');
    expect(pluralForm(1, bare, 'en')).toBe('follower');
    expect(pluralForm(2300, bare, 'en')).toBe('followers');
  });

  it('strips a {n} placeholder rather than leaking it into the UI', () => {
    expect(pluralForm(1, templated, 'en')).toBe('follower');
    expect(pluralForm(5, templated, 'en')).toBe('followers');
  });

  it('picks complex plural categories the same way pluralize does', () => {
    const pl = {
      one: 'obserwujący',
      few: 'obserwujących',
      many: 'obserwujących',
      other: 'obserwujących',
    };
    expect(pluralForm(1, pl, 'pl')).toBe('obserwujący');
    expect(pluralForm(3, pl, 'pl')).toBe('obserwujących');
  });

  it('falls back to `other` when the category is absent', () => {
    expect(pluralForm(1, { other: 'following' }, 'en')).toBe('following');
  });

  it('survives missing forms without throwing', () => {
    expect(pluralForm(3, null, 'en')).toBe('');
    expect(pluralForm(3, {}, 'en')).toBe('');
  });
});
