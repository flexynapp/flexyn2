// The two ends of each morph must be the real crest shapes, or the morph
// jumps when the finished crest replaces it.
import { describe, it, expect } from 'vitest';
import { stoneToShieldPath, wingsBetween } from '@/lib/crestMorph';
import { WING_FULL, WING_SMALL } from '@/components/leagues/LeagueTierIcon';

const nums = (d) => d.match(/-?\d+(\.\d+)?/g).map(Number);

describe('stoneToShieldPath', () => {
  it('ends on the shield outline LeagueTierIcon draws', () => {
    expect(nums(stoneToShieldPath(1))).toEqual(nums('M32 8 L50 14 L50 31 C50 43 42 51 32 57 C22 51 14 43 14 31 L14 14 Z'));
  });

  it('starts on the Diamond stone, every corner of it', () => {
    const pts = nums(stoneToShieldPath(0));
    // Gem outline at y = 2: M21 19 H43 L50 29 L32 56 L14 29 Z
    for (const [x, y] of [[21, 19], [43, 19], [50, 29], [32, 56], [14, 29]]) {
      const hit = pts.some((_, i) => i % 2 === 0 && pts[i] === x && pts[i + 1] === y);
      expect(hit, `${x},${y}`).toBe(true);
    }
  });

  it('follows the stone down for Legend', () => {
    expect(nums(stoneToShieldPath(0, 6))[1]).toBe(23);
  });

  it('keeps the same commands at every step, so nothing jumps', () => {
    const shape = (d) => d.replace(/-?\d+(\.\d+)?/g, '#');
    const first = shape(stoneToShieldPath(0));
    for (const k of [0.1, 0.33, 0.5, 0.9, 1]) expect(shape(stoneToShieldPath(k))).toBe(first);
  });

  it('clamps progress outside 0 to 1', () => {
    expect(stoneToShieldPath(-1)).toBe(stoneToShieldPath(0));
    expect(stoneToShieldPath(2)).toBe(stoneToShieldPath(1));
  });
});

describe('wingsBetween', () => {
  it('moves between two real wing settings', () => {
    expect(wingsBetween(WING_FULL, WING_SMALL, 0)).toEqual(WING_FULL);
    expect(wingsBetween(WING_FULL, WING_SMALL, 1)).toEqual(WING_SMALL);
    expect(wingsBetween(WING_FULL, WING_SMALL, 0.5).size).toBeCloseTo((0.95 + 0.72) / 2, 6);
  });
});
