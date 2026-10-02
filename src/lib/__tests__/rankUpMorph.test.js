import { describe, it, expect } from 'vitest';
import { bodyPath, crestShape, greyPalette, morphAt, morphEase } from '@/lib/rankUpMorph';

const nums = (d) => d.match(/-?\d+(\.\d+)?/g).map(Number);

describe('rankUpMorph', () => {
  it('starts on the first crest and lands exactly on the second', () => {
    const a = crestShape('diamond');
    const b = crestShape('platinum');
    expect(nums(morphAt(a, b, 0).body)).toEqual(a.body);
    expect(nums(morphAt(a, b, 1).body)).toEqual(b.body);
  });

  it('draws every body on the same ten points, so any two can be blended', () => {
    ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'legend'].forEach((t) => {
      expect(crestShape(t).body).toHaveLength(20);
    });
    expect(bodyPath(crestShape('gold').body, crestShape('legend').body, 0.5)).toMatch(/^M[\d. ]+L[\d. ]+L[\d. ]+C[\d. ]+C[\d. ]+L[\d. ]+Z$/);
  });

  it('grows wings out of nothing for a first placement', () => {
    const a = crestShape('bronze');
    const b = crestShape('gold');
    expect(a.wing.size).toBe(0);
    expect(morphAt(a, b, 0).wingOpacity).toBe(0);
    expect(morphAt(a, b, 1).wingOpacity).toBe(1);
  });

  it('brings the spike and crown in and out with their leagues', () => {
    expect(morphAt(crestShape('platinum'), crestShape('gold'), 1).spike).toBe(0);
    expect(morphAt(crestShape('diamond'), crestShape('legend'), 1).crown).toBe(1);
  });

  it('eases from rest to rest', () => {
    expect(morphEase(0)).toBe(0);
    expect(morphEase(1)).toBe(1);
    expect(morphEase(0.5)).toBeCloseTo(0.5);
    expect(morphEase(0.05)).toBeLessThan(0.01);
  });

  it('greys a palette the way the sequence greys a real crest', () => {
    const g = greyPalette({ mid: '#cd7f32' }, 1);
    // grayscale(1) brightness(0.45) of bronze: luminance 138, times 0.45.
    expect(g.mid).toBe('#3e3e3e');
    expect(greyPalette({ mid: '#cd7f32' }, 0).mid).toBe('#cd7f32');
  });
});
