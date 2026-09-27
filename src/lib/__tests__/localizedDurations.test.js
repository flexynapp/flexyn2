// Countdowns and compact ages must take their units from Intl, not from
// hardcoded English letters. French writes days as "j"; the DM inbox used to
// shorten "5 hours" to "5h" with a string replace that only matched English.
import { describe, it, expect } from 'vitest';
import { timeLeft } from '../timeLeft';
import { formatCompactAgo, formatUnit, relativeWord } from '../intlFormat';

const NOW = new Date('2026-09-27T12:00:00Z');
const later = (ms) => new Date(NOW.getTime() + ms);
const earlier = (ms) => new Date(NOW.getTime() - ms);
const H = 3_600_000;

describe('timeLeft', () => {
  it('keeps the English shape by default', () => {
    expect(timeLeft(later(3 * 24 * H + 4 * H), NOW)).toBe('3d 4h');
    expect(timeLeft(later(7 * H), NOW)).toBe('7h');
  });

  it('writes French days as "j", not "d"', () => {
    expect(timeLeft(later(3 * 24 * H + 4 * H), NOW, 'fr')).toBe('3j 4h');
  });

  it('is null once the moment has passed', () => {
    expect(timeLeft(earlier(1000), NOW, 'es')).toBeNull();
  });
});

describe('formatCompactAgo', () => {
  it('says "now" in the viewer language under a minute', () => {
    expect(formatCompactAgo(earlier(5000), 'en', NOW)).toBe('now');
    expect(formatCompactAgo(earlier(5000), 'es', NOW)).toBe('ahora');
  });

  it('uses narrow Intl units', () => {
    expect(formatCompactAgo(earlier(2 * H), 'en', NOW)).toBe('2h');
    expect(formatCompactAgo(earlier(3 * 24 * H), 'fr', NOW)).toBe('3j');
    expect(formatCompactAgo(earlier(11 * 60_000), 'es', NOW)).toBe(formatUnit(11, 'minute', 'es'));
  });

  it('renders nothing for a missing timestamp rather than the epoch', () => {
    expect(formatCompactAgo(null, 'en', NOW)).toBe('');
  });
});

describe('relativeWord', () => {
  it('capitalises "yesterday" when asked', () => {
    expect(relativeWord(-1, 'day', 'en', { cap: true })).toBe('Yesterday');
    expect(relativeWord(-1, 'day', 'es', { cap: true })).toBe('Ayer');
    expect(relativeWord(-1, 'day', 'fr', { cap: true })).toBe('Hier');
  });
});
