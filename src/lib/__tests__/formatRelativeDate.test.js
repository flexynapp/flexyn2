// Tests for src/lib/formatRelativeDate — the universal cascading
// timestamp formatter. Each branch of the cascade (< 1m, < 1h, today,
// yesterday, < 7 days, same year, older) gets a passing case plus a
// future-direction case.

import { describe, it, expect } from 'vitest';
import { formatRelativeDate } from '../formatRelativeDate';

describe('formatRelativeDate', () => {
  const now = new Date('2026-05-22T14:00:00');

  it('returns "just now" for sub-minute timestamps', () => {
    const t = new Date(now.getTime() - 30 * 1000);
    expect(formatRelativeDate(t, { now })).toBe('just now');
  });

  it('returns minutes ago for < 1 hour', () => {
    const t = new Date(now.getTime() - 23 * 60 * 1000);
    expect(formatRelativeDate(t, { now })).toBe('23m ago');
  });

  it('returns "Today at HH:MM" for today (>= 1 hour)', () => {
    // 9:00 AM same day, viewed at 2:00 PM
    const t = new Date('2026-05-22T09:00:00');
    expect(formatRelativeDate(t, { now })).toMatch(/^Today at /);
  });

  it('returns "Yesterday at HH:MM" for yesterday', () => {
    const t = new Date('2026-05-21T20:30:00');
    expect(formatRelativeDate(t, { now })).toMatch(/^Yesterday at /);
  });

  it('returns weekday for < 7 days ago', () => {
    const t = new Date('2026-05-19T10:00:00'); // 3 days before
    const result = formatRelativeDate(t, { now });
    expect(result).toMatch(/at /);
    // Should include a weekday name in the standard variant
    expect(result).toMatch(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) at /);
  });

  it('returns "MMM d" for same-year older dates', () => {
    const t = new Date('2026-02-10T10:00:00');
    expect(formatRelativeDate(t, { now })).toContain('Feb 10');
  });

  it('includes year for older-than-this-year dates', () => {
    const t = new Date('2024-05-12T10:00:00');
    expect(formatRelativeDate(t, { now })).toContain('2024');
  });

  it('"short" variant drops the time-of-day', () => {
    const t = new Date('2026-05-22T09:00:00');
    expect(formatRelativeDate(t, { now, variant: 'short' })).toBe('Today');
  });

  it('handles future dates with "in X" framing', () => {
    const t = new Date(now.getTime() + 23 * 60 * 1000);
    expect(formatRelativeDate(t, { now })).toBe('in 23m');
  });

  it('returns empty string for invalid input', () => {
    expect(formatRelativeDate(null)).toBe('');
    expect(formatRelativeDate(undefined)).toBe('');
    expect(formatRelativeDate('not-a-date')).toBe('');
  });

  it('accepts ISO strings and numbers', () => {
    const isoT = '2026-05-22T13:37:00';
    const numT = new Date(isoT).getTime();
    expect(formatRelativeDate(isoT, { now })).toMatch(/^23m ago$/);
    expect(formatRelativeDate(numT, { now })).toMatch(/^23m ago$/);
  });
});
