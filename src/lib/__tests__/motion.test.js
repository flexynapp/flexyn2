// src/lib/__tests__/motion.test.js
//
// Pins the shared motion vocabulary. The numbers are the design: entrances
// between 180 and 260ms, an 8px rise, a ~40ms stagger capped at 8 steps,
// and opacity plus transform only. The last one matters most: these props
// go onto Dashboard rows, where `layout` outside edit mode is a known bug
// (CLAUDE.md, UI composition), so no preset here may carry it.

import { describe, it, expect } from 'vitest';
import {
  DURATION,
  STAGGER,
  RISE_PX,
  EASE_OUT,
  SPRING,
  TWEEN,
  staggerContainer,
  staggerItem,
  fadeUp,
  popIn,
} from '@/lib/motion';

describe('motion presets', () => {
  it('keeps every duration inside 180 to 260ms', () => {
    for (const d of Object.values(DURATION)) {
      expect(d).toBeGreaterThanOrEqual(0.18);
      expect(d).toBeLessThanOrEqual(0.26);
    }
    expect(TWEEN.duration).toBeGreaterThanOrEqual(0.18);
    expect(TWEEN.duration).toBeLessThanOrEqual(0.26);
    expect(TWEEN.ease).toBe(EASE_OUT);
  });

  it('staggers at about 40ms and rises 8px', () => {
    expect(STAGGER).toBeCloseTo(0.04, 5);
    expect(RISE_PX).toBe(8);
  });

  it('exposes springs with the fields framer needs', () => {
    for (const s of Object.values(SPRING)) {
      expect(s.type).toBe('spring');
      expect(s.stiffness).toBeGreaterThan(0);
      expect(s.damping).toBeGreaterThan(0);
    }
  });
});

describe('staggerContainer / staggerItem', () => {
  it('staggers children with the default gap', () => {
    const v = staggerContainer();
    expect(v.show.transition.staggerChildren).toBe(STAGGER);
    expect(v.show.transition.delayChildren).toBe(0);
  });

  it('accepts a custom stagger and delay', () => {
    const v = staggerContainer({ stagger: 0.06, delayChildren: 0.1 });
    expect(v.show.transition.staggerChildren).toBe(0.06);
    expect(v.show.transition.delayChildren).toBe(0.1);
  });

  it('item fades and rises in', () => {
    expect(staggerItem.hidden).toEqual({ opacity: 0, y: RISE_PX });
    expect(staggerItem.show.opacity).toBe(1);
    expect(staggerItem.show.y).toBe(0);
  });
});

describe('fadeUp', () => {
  it('delays by index times the stagger', () => {
    expect(fadeUp(0).transition.delay).toBe(0);
    expect(fadeUp(3).transition.delay).toBeCloseTo(3 * STAGGER, 5);
  });

  it('caps the delay at 8 steps so late sections are not held back', () => {
    expect(fadeUp(20).transition.delay).toBeCloseTo(8 * STAGGER, 5);
  });

  it('treats a bad index as 0', () => {
    expect(fadeUp(-4).transition.delay).toBe(0);
    expect(fadeUp(undefined).transition.delay).toBe(0);
    expect(fadeUp(NaN).transition.delay).toBe(0);
  });

  it('animates opacity and y only, never layout', () => {
    const props = fadeUp(2);
    expect(props).not.toHaveProperty('layout');
    expect(Object.keys(props.initial).sort()).toEqual(['opacity', 'y']);
    expect(Object.keys(props.animate).sort()).toEqual(['opacity', 'y']);
    expect(props.animate).toEqual({ opacity: 1, y: 0 });
  });
});

describe('popIn', () => {
  it('scales up from small to 1 on the pop spring', () => {
    expect(popIn.initial.scale).toBeLessThan(1);
    expect(popIn.animate.scale).toBe(1);
    expect(popIn.transition).toBe(SPRING.pop);
  });
});
