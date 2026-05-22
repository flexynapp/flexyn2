// Tests for src/lib/timeUntil.js — the short-form countdown formatter
// shown next to story expiration timestamps in StoryViewer.

import { describe, it, expect } from 'vitest';
import { formatTimeUntil } from '../timeUntil';

const NOW = new Date('2025-05-21T12:00:00').getTime();

describe('formatTimeUntil', () => {
  it('renders hours + minutes for multi-hour gaps', () => {
    const target = new Date('2025-05-21T16:12:00').toISOString();
    expect(formatTimeUntil(target, NOW)).toBe('4h 12m');
  });

  it('renders hours only when the minute offset is zero', () => {
    const target = new Date('2025-05-21T18:00:00').toISOString();
    expect(formatTimeUntil(target, NOW)).toBe('6h');
  });

  it('renders minutes only when the gap is < 1 hour', () => {
    const target = new Date('2025-05-21T12:38:00').toISOString();
    expect(formatTimeUntil(target, NOW)).toBe('38m');
  });

  it('returns "< 1m" for a sub-minute positive gap', () => {
    const target = new Date('2025-05-21T12:00:30').toISOString();
    expect(formatTimeUntil(target, NOW)).toBe('< 1m');
  });

  it('returns null when the timestamp has already passed', () => {
    const target = new Date('2025-05-21T11:00:00').toISOString();
    expect(formatTimeUntil(target, NOW)).toBeNull();
  });

  it('returns null on exactly-now', () => {
    const target = new Date(NOW).toISOString();
    expect(formatTimeUntil(target, NOW)).toBeNull();
  });

  it('returns null for null / undefined / invalid input', () => {
    expect(formatTimeUntil(null, NOW)).toBeNull();
    expect(formatTimeUntil(undefined, NOW)).toBeNull();
    expect(formatTimeUntil('not-a-date', NOW)).toBeNull();
  });

  it('accepts Date objects in addition to ISO strings', () => {
    expect(formatTimeUntil(new Date(NOW + 90 * 60_000), NOW)).toBe('1h 30m');
  });
});
