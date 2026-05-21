import { describe, it, expect } from 'vitest';
import { formatNumber, formatDate } from '../intl';

describe('formatNumber — locale-aware number formatting', () => {
  it('returns empty string for null / undefined / NaN', () => {
    expect(formatNumber(null,  'en')).toBe('');
    expect(formatNumber(undefined, 'en')).toBe('');
    expect(formatNumber('not a number', 'en')).toBe('');
  });

  it('groups thousands with comma in English', () => {
    expect(formatNumber(1234567, 'en')).toBe('1,234,567');
  });

  it('groups thousands with period in German', () => {
    expect(formatNumber(1234567, 'de')).toBe('1.234.567');
  });

  it('groups with non-breaking space in French', () => {
    // French uses U+202F NARROW NO-BREAK SPACE between groups.
    const out = formatNumber(1234567, 'fr');
    expect(out).toMatch(/^1 234 567$|^1 234 567$/);
  });

  it('falls back to en-US on an unknown locale rather than crashing', () => {
    expect(formatNumber(1000, 'xyz')).toBe('1,000');
  });

  it('respects maximumFractionDigits', () => {
    expect(formatNumber(3.14159, 'en', { maximumFractionDigits: 2 })).toBe('3.14');
  });
});

describe('formatDate — locale-aware date formatting', () => {
  const D = new Date('2026-04-15T12:00:00Z');

  it('returns empty string for null / invalid', () => {
    expect(formatDate(null, 'en')).toBe('');
    expect(formatDate('not a date', 'en')).toBe('');
  });

  it('accepts a Date instance or an ISO string', () => {
    expect(formatDate(D, 'en')).toEqual(formatDate('2026-04-15T12:00:00Z', 'en'));
  });

  it('uses different conventions across locales (English vs German)', () => {
    const en = formatDate(D, 'en');
    const de = formatDate(D, 'de');
    // We don't assert the exact format because Intl outputs vary by
    // ICU version; we only assert the two outputs differ, proving the
    // locale argument is actually being applied.
    expect(en).not.toEqual(de);
  });

  it('respects dateStyle option', () => {
    const out = formatDate(D, 'en', { dateStyle: 'long' });
    expect(out).toMatch(/april/i);
  });
});
