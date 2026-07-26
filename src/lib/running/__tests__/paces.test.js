import { describe, it, expect } from 'vitest';
import {
  predictSeconds, to5kSeconds, paceZones, goalFiveK, fiveKSplits,
  repTime, runningTargets, formatPace,
} from '../paces';

describe('Riegel prediction', () => {
  it('predicts a faster per-mile pace at a shorter distance', () => {
    // 10K in 40:00 → 5K should be under 20:00 and over 19:00.
    const fiveK = to5kSeconds(10000, 40 * 60);
    expect(fiveK).toBeLessThan(20 * 60);
    expect(fiveK).toBeGreaterThan(19 * 60);
  });
  it('is identity at the same distance', () => {
    expect(Math.round(predictSeconds(5000, 1500, 5000))).toBe(1500);
  });
});

describe('paceZones (offsets from 5K pace)', () => {
  const z = paceZones(25 * 60); // 25:00 5K → ~8:03/mi

  it('orders zones rep < interval < threshold < marathon < easy < long', () => {
    expect(z.rep.perMile).toBeLessThan(z.interval.perMile);
    expect(z.interval.perMile).toBeLessThan(z.threshold.perMile);
    expect(z.threshold.perMile).toBeLessThan(z.marathon.perMile);
    expect(z.marathon.perMile).toBeLessThan(z.easy.perMile);
    expect(z.easy.perMile).toBeLessThan(z.long.perMile);
  });

  it('puts interval pace at ~5K pace and easy ~75s/mi slower', () => {
    expect(z.interval.perMile).toBeCloseTo((25 * 60) / (5000 / 1609.344), 0);
    expect(z.easy.perMile - z.interval.perMile).toBeCloseTo(75, 0);
    expect(z.threshold.perMile - z.interval.perMile).toBeCloseTo(25, 0);
  });

  it('derives per-km from per-mile', () => {
    expect(z.interval.perKm).toBeLessThan(z.interval.perMile); // km is shorter → smaller number
  });
});

describe('goalFiveK', () => {
  it('returns a faster but realistic goal (5–45 s/mi gain)', () => {
    const cur = 25 * 60;
    const goal = goalFiveK(cur);
    expect(goal).toBeLessThan(cur);
    const gainPerMile = (cur - goal) / (5000 / 1609.344);
    expect(gainPerMile).toBeGreaterThanOrEqual(5);
    expect(gainPerMile).toBeLessThanOrEqual(45);
  });
});

describe('fiveKSplits + repTime', () => {
  it('computes km / mile / 400m splits', () => {
    const s = fiveKSplits(24 * 60); // 24:00
    expect(formatPace(s.perKm)).toBe('4:48');
    expect(Math.round(s.per400)).toBe(Math.round(s.perKm * 0.4));
    expect(s.halfway).toBe(12 * 60);
  });
  it('repTime scales a per-km pace to the rep distance', () => {
    expect(repTime(300, 1000)).toBe(300);  // 5:00/km → 5:00 per 1000m
    expect(repTime(300, 400)).toBe(120);   // → 2:00 per 400m
  });
});

describe('runningTargets', () => {
  it('bundles current, goal, zones and splits', () => {
    const t = runningTargets(25 * 60);
    expect(t.currentFiveKSeconds).toBe(1500);
    expect(t.goalFiveKSeconds).toBeLessThan(1500);
    expect(t.zones.interval).toBeTruthy();
    expect(t.goalSplits.perKm).toBeGreaterThan(0);
  });
});
