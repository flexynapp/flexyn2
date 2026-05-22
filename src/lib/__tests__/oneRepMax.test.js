// Tests for src/lib/oneRepMax — Epley formula + best-of-sets helper.

import { describe, it, expect } from 'vitest';
import { epleyOneRepMax, bestOneRepMax, REP_RANGE_MAX } from '../oneRepMax';

describe('epleyOneRepMax', () => {
  it('returns the raw weight for a single-rep set', () => {
    expect(epleyOneRepMax(225, 1)).toBe(225);
  });

  it('applies Epley above 1 rep (225 × 8 → ~285)', () => {
    const rm = epleyOneRepMax(225, 8);
    expect(rm).toBeCloseTo(225 * (1 + 8 / 30), 4);
    expect(rm).toBeGreaterThan(225);
    expect(rm).toBeLessThan(300);
  });

  it('returns 0 for non-positive weight', () => {
    expect(epleyOneRepMax(0, 5)).toBe(0);
    expect(epleyOneRepMax(-50, 5)).toBe(0);
  });

  it('returns 0 for non-positive reps', () => {
    expect(epleyOneRepMax(225, 0)).toBe(0);
  });

  it('returns 0 for high-rep sets out of Epley accuracy range', () => {
    expect(epleyOneRepMax(50, REP_RANGE_MAX + 1)).toBe(0);
    expect(epleyOneRepMax(50, 100)).toBe(0);
  });

  it('returns 0 for non-numeric input', () => {
    expect(epleyOneRepMax('foo', 5)).toBe(0);
    expect(epleyOneRepMax(225, null)).toBe(0);
    expect(epleyOneRepMax(undefined, undefined)).toBe(0);
  });
});

describe('bestOneRepMax', () => {
  it('picks the best 1RM across multiple sets', () => {
    const sets = [
      { weight: 135, reps: 10 },
      { weight: 225, reps: 5 },
      { weight: 185, reps: 8 },
    ];
    expect(bestOneRepMax(sets)).toBeCloseTo(225 * (1 + 5 / 30), 4);
  });

  it('handles empty arrays', () => {
    expect(bestOneRepMax([])).toBe(0);
    expect(bestOneRepMax(undefined)).toBe(0);
  });

  it('skips invalid sets gracefully', () => {
    const sets = [{ weight: null, reps: 8 }, { weight: 225, reps: 5 }];
    expect(bestOneRepMax(sets)).toBeCloseTo(225 * (1 + 5 / 30), 4);
  });
});
