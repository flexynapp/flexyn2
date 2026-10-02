import { describe, it, expect } from 'vitest';
import { mayBeInFirstWeek, msUntilLocalMidnight } from '../firstWeekCheckin';

describe('firstWeekCheckin helpers', () => {
  const now = new Date(2026, 9, 2, 23, 59, 0);

  it('counts down to just past local midnight', () => {
    expect(msUntilLocalMidnight(now)).toBe(61 * 1000);
  });

  it('gates on account age with a day of slack', () => {
    const daysAgo = (n) => new Date(now.getTime() - n * 864e5).toISOString();
    expect(mayBeInFirstWeek(daysAgo(0), now)).toBe(true);
    expect(mayBeInFirstWeek(daysAgo(7.5), now)).toBe(true);
    expect(mayBeInFirstWeek(daysAgo(9), now)).toBe(false);
  });

  it('lets the caller decide what an unknown sign-up date means', () => {
    expect(mayBeInFirstWeek(null, now)).toBe(true);
    expect(mayBeInFirstWeek(null, now, { unknown: false })).toBe(false);
  });
});
