import { describe, it, expect } from 'vitest';
import { sessionMiles, runKcal, weeklyRunningLoad } from '../fueling';

describe('sessionMiles', () => {
  it('uses distance when present', () => {
    expect(sessionMiles({ target_distance_m: 1609.344 })).toBeCloseTo(1, 3);
  });
  it('estimates from duration (~8 min/mile) when no distance', () => {
    expect(sessionMiles({ target_duration_s: 24 * 60 })).toBeCloseTo(3, 5); // 24 min / 8
  });
  it('defaults an interval session (no distance/duration) to 3 miles', () => {
    expect(sessionMiles({})).toBe(3);
  });
});

describe('runKcal', () => {
  it('is ~0.73 kcal per lb per mile', () => {
    expect(runKcal(3, 165)).toBe(Math.round(3 * 0.73 * 165)); // 361
  });
});

describe('weeklyRunningLoad', () => {
  it('returns zeros when there are no cardio sessions', () => {
    expect(weeklyRunningLoad([{ kind: 'strength' }], 165)).toEqual({
      runDays: 0, weeklyKcal: 0, perRunDayKcal: 0, addCarbsG: 0,
    });
  });

  it('aggregates cardio sessions and routes ~60% of per-day kcal to carbs', () => {
    const ex = [
      { kind: 'cardio', target_distance_m: 1609.344 * 3 }, // 3 mi
      { kind: 'cardio', target_duration_s: 20 * 60 },      // 2.5 mi
      { kind: 'cardio' },                                  // interval → 3 mi
      { kind: 'strength', name: 'Bench Press' },           // ignored
    ];
    const load = weeklyRunningLoad(ex, 160);
    expect(load.runDays).toBe(3);
    expect(load.weeklyKcal).toBeGreaterThan(0);
    expect(load.perRunDayKcal).toBe(Math.round(load.weeklyKcal / 3));
    expect(load.addCarbsG).toBe(Math.round((load.perRunDayKcal * 0.6) / 4));
  });
});
