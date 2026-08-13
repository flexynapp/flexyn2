import { describe, it, expect } from 'vitest';
import { ADHERENCE, adherenceOf, summarise, longestStreak } from '@/lib/nutritionAdherence';

describe('adherenceOf', () => {
  it('returns null for a day that was never logged', () => {
    // The distinction the old stat collapsed. A null here is what stops the
    // UI painting an unlogged day as a zero-height bar, i.e. as "ate nothing".
    expect(adherenceOf(0, 2000)).toBeNull();
    expect(adherenceOf(null, 2000)).toBeNull();
    expect(adherenceOf(undefined, 2000)).toBeNull();
    expect(adherenceOf(NaN, 2000)).toBeNull();
  });

  it('bands a logged day against the goal', () => {
    expect(adherenceOf(2400, 2000)).toBe(ADHERENCE.over);    // > 1.15
    expect(adherenceOf(1940, 2000)).toBe(ADHERENCE.on);      // within band
    expect(adherenceOf(800, 2000)).toBe(ADHERENCE.under);    // < 0.7
  });

  it('puts the band edges on the inclusive side of "on target"', () => {
    expect(adherenceOf(2300, 2000)).toBe(ADHERENCE.on);      // exactly 1.15
    expect(adherenceOf(1400, 2000)).toBe(ADHERENCE.on);      // exactly 0.70
  });

  it('treats a missing goal as on target rather than dividing by zero', () => {
    expect(adherenceOf(1500, 0)).toBe(ADHERENCE.on);
  });
});

describe('summarise', () => {
  const goal = 2000;

  it('averages over LOGGED days, not calendar days', () => {
    // This is the "631 avg cal/day" bug. Five day-groups, three of which had
    // no meals: the old stat divided the total by 5 and reported a number that
    // reads as starvation against a 2,000 goal.
    const series = [
      { date: '2026-08-08', calories: 1180 },
      { date: '2026-08-09', calories: 0 },
      { date: '2026-08-10', calories: 0 },
      { date: '2026-08-11', calories: 800 },
      { date: '2026-08-12', calories: 870 },
    ];
    const s = summarise(series, goal);
    expect(s.logged).toBe(3);
    expect(s.total).toBe(5);
    expect(s.avg).toBe(950);                 // 2850 / 3, not 2850 / 5 = 570
    expect(s.peak).toBe(1180);
  });

  it('counts the adherence bands', () => {
    const series = [
      { date: 'a', calories: 2480 },
      { date: 'b', calories: 1940 },
      { date: 'c', calories: 800 },
      { date: 'd', calories: 0 },
    ];
    expect(summarise(series, goal).counts).toEqual({ over: 1, on: 1, under: 1 });
  });

  it('reports zeros rather than NaN when nothing was logged', () => {
    const s = summarise([{ date: 'a', calories: 0 }, { date: 'b', calories: 0 }], goal);
    expect(s).toMatchObject({ avg: 0, logged: 0, total: 2, peak: 0 });
  });

  it('handles an empty series', () => {
    expect(summarise([], goal)).toMatchObject({ avg: 0, logged: 0, total: 0 });
  });
});

describe('longestStreak', () => {
  it('finds the longest consecutive run of logged days', () => {
    const series = [1, 1, 0, 1, 1, 1, 0, 1].map((c, i) => ({ date: `d${i}`, calories: c * 500 }));
    expect(longestStreak(series)).toBe(3);
  });

  it('is 0 when nothing was logged', () => {
    expect(longestStreak([{ calories: 0 }, { calories: 0 }])).toBe(0);
    expect(longestStreak([])).toBe(0);
  });
});
