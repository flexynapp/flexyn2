import { describe, it, expect } from 'vitest';
import { chargeFrames, chargeBeats, spring, landingFrames, impactFrames, flyFrames } from '@/lib/rankUpMotion';

const num = (t, re) => Number(t.match(re)[1]);

describe('rank up motion', () => {
  it('the charge ends still, so the break starts from a crest at rest', () => {
    const c = chargeFrames({ kind: 'tier', duration: 1700 });
    expect(c.end.rot).toBe(0);
    expect(c.crest).toHaveLength(121);
  });

  it('never sways faster than three times a second, which is what read as jitter', () => {
    const duration = 2300;
    const { crest } = chargeFrames({ kind: 'tier', duration });
    const rot = crest.map((k) => num(k.transform, /rotate\((-?[\d.]+)deg/));
    let crossings = 0;
    for (let i = 1; i < rot.length; i++) if (Math.sign(rot[i]) !== Math.sign(rot[i - 1]) && rot[i] !== 0) crossings++;
    // Two zero crossings a cycle.
    expect(crossings / 2 / (duration / 1000)).toBeLessThanOrEqual(3);
  });

  it('beats come closer together as the charge builds', () => {
    const b = chargeBeats('tier');
    for (let i = 2; i < b.length; i++) expect(b[i] - b[i - 1]).toBeLessThan(b[i - 1] - b[i - 2]);
  });

  it('springs settle exactly on their target', () => {
    const s = spring(2.2, 1, { duration: 900 });
    expect(s[0]).toBeCloseTo(2.2);
    expect(s.at(-1)).toBe(1);
    expect(Math.min(...s)).toBeLessThan(1);
  });

  it('a promotion lands inside its own duration and ends at rest', () => {
    const { frames, impact } = landingFrames({ kind: 'tier', duration: 900 });
    expect(impact).toBeGreaterThan(0);
    expect(impact).toBeLessThan(900);
    expect(frames.at(-1).transform).toBe('translateY(0px) scale(1)');
  });

  it('a level step starts where the charge left the crest', () => {
    const { frames } = landingFrames({ kind: 'level', duration: 720, startScale: 1.03, startY: -6 });
    expect(frames[0].transform).toBe('translate(0px, -6px) scale(1.03)');
    expect(frames.at(-1).transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('the screen dip and the halves start from rest and from the charge pose', () => {
    expect(impactFrames(6)[0].transform).toBe('translateY(0px)');
    expect(impactFrames(6).at(-1).transform).toBe('translateY(0px)');
    expect(flyFrames(1, { x: 0, y: -12, rot: 0, scale: 1.06 })[0].transform).toBe('translate(0px, -12px) rotate(0deg) scale(1.06)');
  });
});
