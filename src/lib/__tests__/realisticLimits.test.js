import { describe, it, expect } from 'vitest';
import {
  getMaxRealisticWeight,
  getMaxRealisticReps,
  getMaxRealisticDuration,
} from '../realisticLimits';

const MALE_180   = { weight_lbs: 180, gender: 'male' };
const FEMALE_130 = { weight_lbs: 130, gender: 'female' };
const HEAVY_MALE = { weight_lbs: 280, gender: 'male' };

// ─── getMaxRealisticWeight ────────────────────────────────────────────────────

describe('getMaxRealisticWeight — known exercises', () => {
  it('deadlift: 180 lb male can deadlift up to 3.5× bodyweight', () => {
    const max = getMaxRealisticWeight('deadlift', MALE_180);
    expect(max).toBe(Math.round(180 * 3.5 * 1.0));
  });

  it('bench press: 180 lb male cap is 2.2× bodyweight', () => {
    const max = getMaxRealisticWeight('bench press', MALE_180);
    expect(max).toBe(Math.round(180 * 2.2 * 1.0));
  });

  it('lateral raise: very low multiplier (isolation, light weight)', () => {
    const max = getMaxRealisticWeight('lateral raise', MALE_180);
    expect(max).toBeLessThan(100);
  });

  it('leg press: machine multiplier (4.5×) is higher than squat', () => {
    const legPress = getMaxRealisticWeight('leg press', MALE_180);
    const squat    = getMaxRealisticWeight('back squat', MALE_180);
    expect(legPress).toBeGreaterThan(squat);
  });

  it('applies 0.72× gender multiplier for female users', () => {
    const male   = getMaxRealisticWeight('back squat', MALE_180);
    const female = getMaxRealisticWeight('back squat', FEMALE_130);
    // Female is lighter AND has gender multiplier — should be lower
    expect(female).toBeLessThan(male);
  });

  it('bodyweight exercises (plank, ab wheel) return 0', () => {
    expect(getMaxRealisticWeight('plank', MALE_180)).toBe(0);
    expect(getMaxRealisticWeight('ab wheel', MALE_180)).toBe(0);
  });

  it('never exceeds the 1100 lb hard ceiling', () => {
    const max = getMaxRealisticWeight('leg press', { weight_lbs: 700, gender: 'male' });
    expect(max).toBeLessThanOrEqual(1100);
  });

  it('falls back gracefully for unknown exercises', () => {
    const max = getMaxRealisticWeight('unicorn press', MALE_180);
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(1100);
  });

  it('handles missing profile gracefully (defaults to 180 lb male)', () => {
    const max = getMaxRealisticWeight('deadlift');
    expect(max).toBeGreaterThan(0);
  });
});

// ─── getMaxRealisticReps ──────────────────────────────────────────────────────

describe('getMaxRealisticReps — weighted sets', () => {
  it('at a very light weight, allows up to 60 reps', () => {
    const max = getMaxRealisticReps('bench press', 45, MALE_180);
    expect(max).toBe(60);
  });

  it('at a near-max weight (99% of ceiling), allows only 1 rep', () => {
    const ceiling = getMaxRealisticWeight('deadlift', MALE_180);
    const max = getMaxRealisticReps('deadlift', ceiling, MALE_180);
    expect(max).toBe(1);
  });

  it('reps allowed decreases as weight increases (Epley relationship)', () => {
    const light  = getMaxRealisticReps('bench press', 100, MALE_180);
    const medium = getMaxRealisticReps('bench press', 200, MALE_180);
    expect(light).toBeGreaterThan(medium);
  });

  it('no weight provided → returns 60 (generous default)', () => {
    const max = getMaxRealisticReps('back squat', 0, MALE_180);
    expect(max).toBe(60);
  });
});

describe('getMaxRealisticReps — bodyweight exercises', () => {
  it('push-ups allow 300 reps (no weight dependency)', () => {
    expect(getMaxRealisticReps('push-up', 0, MALE_180)).toBe(300);
    expect(getMaxRealisticReps('pushup',  0, MALE_180)).toBe(300);
  });

  it('pull-ups are treated as bodyweight', () => {
    expect(getMaxRealisticReps('pull-up', 0, MALE_180)).toBe(300);
    expect(getMaxRealisticReps('chin-up', 0, MALE_180)).toBe(300);
  });

  it('burpees are treated as bodyweight', () => {
    expect(getMaxRealisticReps('burpee', 0, MALE_180)).toBe(300);
  });
});

// ─── getMaxRealisticDuration ──────────────────────────────────────────────────

describe('getMaxRealisticDuration', () => {
  it('returns 180 minutes (3 hours)', () => {
    expect(getMaxRealisticDuration()).toBe(180);
  });
});
