// Tests for calorieCycling.js's pure resolveToday helper.

import { describe, it, expect } from 'vitest';
import { resolveToday } from '../calorieCycling';

const FALLBACK = { calories: 2200, protein_g: 165, carbs_g: 250, fat_g: 73 };

describe('resolveToday', () => {
  it('returns fallback when cycling is null', () => {
    expect(resolveToday(null, true,  FALLBACK)).toEqual(FALLBACK);
    expect(resolveToday(null, false, FALLBACK)).toEqual(FALLBACK);
  });

  it('returns fallback when both branches are null', () => {
    expect(resolveToday({ training: null, rest: null }, true, FALLBACK)).toEqual(FALLBACK);
  });

  it('picks training branch when a workout was logged today', () => {
    const cycling = { training: { calories: 2600, protein_g: 200 }, rest: { calories: 2000 } };
    const out = resolveToday(cycling, true, FALLBACK);
    expect(out.calories).toBe(2600);
    expect(out.protein_g).toBe(200);
    // Fallback values flow through for unset keys
    expect(out.fat_g).toBe(73);
  });

  it('picks rest branch on a rest day', () => {
    const cycling = { training: { calories: 2600 }, rest: { calories: 2000 } };
    const out = resolveToday(cycling, false, FALLBACK);
    expect(out.calories).toBe(2000);
  });

  it('falls back when the chosen branch is null', () => {
    const cycling = { training: null, rest: { calories: 1800 } };
    const out = resolveToday(cycling, true, FALLBACK);
    expect(out).toEqual(FALLBACK);
  });
});
