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

  // Was: a linear fallback paying every off-table day. That fallback minted
  // 200 coins a day in perpetuity past day 39 — 32,295 coins over six months,
  // more than every other faucet combined. Now milestone-only, matching
  // coinsForWorkoutStreakDay, which has always behaved this way.
  it('pays nothing on off-milestone days', () => {
    expect(coinsForStreakDay(4)).toBe(0);
    expect(coinsForStreakDay(10)).toBe(0);
    expect(coinsForStreakDay(50)).toBe(0);
    expect(coinsForStreakDay(365)).toBe(0);
  });

  // The compounding-faucet regression guard: no streak day, however long,
  // may out-pay the day-100 milestone.
  it('never exceeds the largest milestone, however long the streak', () => {
    let worst = 0;
    for (let d = 1; d <= 1000; d++) worst = Math.max(worst, coinsForStreakDay(d));
    expect(worst).toBe(1500);
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
