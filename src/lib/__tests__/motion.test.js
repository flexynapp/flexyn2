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
  EASE_IN,
  TIER,
  slowMotion,
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

describe('tiers', () => {
  it('keeps the names other screens already import', () => {
    // Several features import these by name. Adding is fine; renaming or
    // retuning one changes every screen that uses it.
    expect(SPRING.press).toEqual({ type: 'spring', stiffness: 520, damping: 34, mass: 0.6 });
    expect(SPRING.pop).toEqual({ type: 'spring', stiffness: 460, damping: 16, mass: 0.7 });
    expect(EASE_OUT).toEqual([0.22, 1, 0.36, 1]);
  });

  it('gives each tier a spring from SPRING and a haptic name', () => {
    expect(TIER.answer.spring).toBe(SPRING.press);
    expect(TIER.reward.spring).toBe(SPRING.pop);
    expect(TIER.moment.spring).toBe(SPRING.heavy);
    expect(TIER.answer.haptic).toBe('subtle');
    expect(TIER.reward.haptic).toBe('success');
    expect(TIER.answer.maxDuration).toBeLessThanOrEqual(0.26);
  });

  it('settle does not overshoot and heavy is the slowest spring', () => {
    // A ratio of 1 is no overshoot; 0.8 is under 1%, which the eye reads as none.
    const ratio = ({ stiffness, damping, mass }) => damping / (2 * Math.sqrt(stiffness * mass));
    expect(ratio(SPRING.settle)).toBeGreaterThanOrEqual(0.8);
    const omega = ({ stiffness, mass }) => Math.sqrt(stiffness / mass);
    for (const name of ['press', 'pop', 'settle']) {
      expect(omega(SPRING.heavy)).toBeLessThan(omega(SPRING[name]));
    }
  });

  it('exits accelerate', () => {
    expect(EASE_IN).toEqual([0.4, 0, 1, 1]);
  });
});

describe('slowMotion', () => {
  it('scales a spring in time without changing its shape', () => {
    const s = slowMotion(SPRING.pop, 4);
    expect(s.stiffness).toBeCloseTo(460 / 16, 6);
    expect(s.damping).toBeCloseTo(16 / 4, 6);
    expect(s.mass).toBe(0.7);
    const ratio = ({ stiffness, damping, mass }) => damping / (2 * Math.sqrt(stiffness * mass));
    expect(ratio(s)).toBeCloseTo(ratio(SPRING.pop), 6);
    // the original is untouched
    expect(SPRING.pop.stiffness).toBe(460);
  });

  it('multiplies durations and delays, and leaves factor 1 alone', () => {
    expect(slowMotion({ duration: 0.2, delay: 0.1 }, 2)).toEqual({ duration: 0.4, delay: 0.2 });
    expect(slowMotion(TWEEN, 1)).toBe(TWEEN);
    expect(slowMotion(TWEEN, 0)).toBe(TWEEN);
  });
});
