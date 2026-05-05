import { describe, it, expect } from 'vitest';
import { coinsForStreakDay, eliteCapsuleOnStreakDay } from '../data/loginStreak';

describe('coinsForStreakDay', () => {
  it('returns 0 for non-positive days', () => {
    expect(coinsForStreakDay(0)).toBe(0);
    expect(coinsForStreakDay(-3)).toBe(0);
  });

  it('returns the table values exactly for milestone days', () => {
    expect(coinsForStreakDay(1)).toBe(5);
    expect(coinsForStreakDay(7)).toBe(100);
    expect(coinsForStreakDay(30)).toBe(500);
    expect(coinsForStreakDay(100)).toBe(1500);
  });

  it('falls through to a positive linear curve for off-table days', () => {
    expect(coinsForStreakDay(4)).toBeGreaterThan(0);
    expect(coinsForStreakDay(10)).toBeGreaterThan(0);
    expect(coinsForStreakDay(50)).toBeGreaterThan(0);
  });

  it('caps the linear curve so very long streaks do not produce silly numbers', () => {
    const huge = coinsForStreakDay(9999);
    expect(huge).toBeLessThanOrEqual(2000);
  });
});

describe('eliteCapsuleOnStreakDay', () => {
  it('drops on day 30, 60, 100', () => {
    expect(eliteCapsuleOnStreakDay(30)).toBe(true);
    expect(eliteCapsuleOnStreakDay(60)).toBe(true);
    expect(eliteCapsuleOnStreakDay(100)).toBe(true);
  });

  it('does not drop on other days', () => {
    [1, 7, 14, 21, 29, 31, 50, 99, 101].forEach(d => {
      expect(eliteCapsuleOnStreakDay(d), `day ${d}`).toBe(false);
    });
  });
});
