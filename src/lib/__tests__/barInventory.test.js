// Tests for src/lib/barInventory.js — plate calc + active bar storage.

import { describe, it, expect, beforeEach } from 'vitest';
import { platesPerSide, getActiveBarLbs, setActiveBarLbs, BAR_PRESETS } from '../barInventory';

beforeEach(() => { localStorage.clear(); });

describe('platesPerSide', () => {
  it('returns null when target is below bar weight', () => {
    expect(platesPerSide(40, 45)).toBe(null);
    expect(platesPerSide(0, 45)).toBe(null);
    expect(platesPerSide(-5, 45)).toBe(null);
  });

  it('returns [] when target equals bar', () => {
    expect(platesPerSide(45, 45)).toEqual([]);
  });

  it('greedy-fills from heaviest plate down', () => {
    // 225 lb total = 45 bar + 2x 45 + 2x 45 → 90 per side
    expect(platesPerSide(225, 45)).toEqual([{ plate: 45, count: 2 }]);
    // 315 = 45 + 270 = 135 per side = 3x 45
    expect(platesPerSide(315, 45)).toEqual([{ plate: 45, count: 3 }]);
    // 245 = 45 + 200 = 100 per side = 45 + 35 + 10 + 10... actually 45+45+10
    const r245 = platesPerSide(245, 45);
    expect(r245.find(p => p.plate === 45)?.count).toBe(2);
    expect(r245.find(p => p.plate === 10)?.count).toBe(1);
  });

  it('respects a non-standard bar weight', () => {
    // 105 lb on a 35 lb women's bar → 35 per side → single 35-lb plate
    // (greedy from [45,35,25,10,5,2.5] picks 35 first).
    const r = platesPerSide(105, 35);
    expect(r).toEqual([{ plate: 35, count: 1 }]);
  });

  it('handles a gym without 35-lb plates', () => {
    // 105 lb on a 35 bar, plate inventory excludes 35 → 25 + 10
    const r = platesPerSide(105, 35, [45, 25, 10, 5, 2.5]);
    expect(r.find(p => p.plate === 25)?.count).toBe(1);
    expect(r.find(p => p.plate === 10)?.count).toBe(1);
  });

  it('handles fractional plates (2.5)', () => {
    // 50 lb on a 45 bar → 2.5 per side
    const r = platesPerSide(50, 45);
    expect(r).toEqual([{ plate: 2.5, count: 1 }]);
  });

  it('rejects bad inputs', () => {
    expect(platesPerSide(null, 45)).toBe(null);
    expect(platesPerSide(NaN, 45)).toBe(null);
    expect(platesPerSide(100, -1)).toBe(null);
  });
});

describe('getActiveBarLbs / setActiveBarLbs', () => {
  it('defaults to 45 when nothing stored', () => {
    expect(getActiveBarLbs()).toBe(45);
  });

  it('persists + reads a custom bar', () => {
    setActiveBarLbs(35);
    expect(getActiveBarLbs()).toBe(35);
  });

  it('rejects out-of-range values silently', () => {
    setActiveBarLbs(-1);
    expect(getActiveBarLbs()).toBe(45); // unchanged
    setActiveBarLbs(500);
    expect(getActiveBarLbs()).toBe(45);
  });
});

describe('BAR_PRESETS', () => {
  it('includes the standard Olympic bar at 45 lb', () => {
    expect(BAR_PRESETS.find(p => p.lbs === 45)).toBeTruthy();
  });
  it('includes a 0 lb dumbbell entry for non-barbell context', () => {
    expect(BAR_PRESETS.find(p => p.lbs === 0)).toBeTruthy();
  });
});
