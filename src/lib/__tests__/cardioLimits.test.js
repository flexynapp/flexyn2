import { describe, it, expect } from 'vitest';
import {
  getSpeedLimits,
  avgSpeedKmh,
  getMaxRealisticCalories,
  checkCardioSpeed,
  checkDailyHours,
  CARDIO_SPEED_LIMITS,
  DAILY_HOUR_LIMITS,
} from '../cardioLimits';

// ─── getSpeedLimits ───────────────────────────────────────────────────────────

describe('getSpeedLimits', () => {
  it('returns the correct limits for running_outside', () => {
    const limits = getSpeedLimits('running_outside');
    expect(limits.minKmh).toBe(2.0);
    expect(limits.maxKmh).toBe(28.0);
  });

  it('returns a default fallback for unknown types', () => {
    const limits = getSpeedLimits('hoverboard');
    expect(limits).toBeDefined();
    expect(limits.maxKmh).toBeGreaterThan(0);
  });

  it('cycling cap is higher than running cap', () => {
    expect(getSpeedLimits('biking_outside').maxKmh).toBeGreaterThan(
      getSpeedLimits('running_outside').maxKmh
    );
  });
});

// ─── avgSpeedKmh ──────────────────────────────────────────────────────────────

describe('avgSpeedKmh', () => {
  it('computes 10 km in 3600 s → 10 km/h', () => {
    expect(avgSpeedKmh(10_000, 3600)).toBeCloseTo(10, 2);
  });

  it('returns null when distance is 0', () => {
    expect(avgSpeedKmh(0, 3600)).toBeNull();
  });

  it('returns null when duration is 0', () => {
    expect(avgSpeedKmh(5000, 0)).toBeNull();
  });

  it('returns null for missing inputs', () => {
    expect(avgSpeedKmh(null, null)).toBeNull();
  });
});

// ─── getMaxRealisticCalories ──────────────────────────────────────────────────

describe('getMaxRealisticCalories', () => {
  it('doubles (approximately) when duration doubles', () => {
    const short = getMaxRealisticCalories(3600, { weight_lbs: 180 });
    const long  = getMaxRealisticCalories(7200, { weight_lbs: 180 });
    // Allow ±2 kcal rounding tolerance from Math.round
    expect(Math.abs(long - short * 2)).toBeLessThanOrEqual(2);
  });

  it('scales with bodyweight', () => {
    const light = getMaxRealisticCalories(3600, { weight_lbs: 120 });
    const heavy = getMaxRealisticCalories(3600, { weight_lbs: 250 });
    expect(heavy).toBeGreaterThan(light);
  });

  it('falls back to 70 kg if no weight provided', () => {
    const result = getMaxRealisticCalories(3600, {});
    expect(result).toBeGreaterThan(0);
  });
});

// ─── checkCardioSpeed ────────────────────────────────────────────────────────

describe('checkCardioSpeed', () => {
  it('running at 10 km/h for 30 min is NOT implausible', () => {
    const result = checkCardioSpeed('running_outside', 5_000, 1800);
    expect(result.implausible).toBe(false);
  });

  it('running 10 km in 1 minute (600 km/h) IS implausible', () => {
    const result = checkCardioSpeed('running_outside', 10_000, 60);
    expect(result.implausible).toBe(true);
    expect(result.speedKmh).toBeGreaterThan(28);
  });

  it('missing distance → not implausible', () => {
    expect(checkCardioSpeed('running_outside', 0, 3600).implausible).toBe(false);
  });

  it('missing duration → not implausible', () => {
    expect(checkCardioSpeed('running_outside', 10_000, 0).implausible).toBe(false);
  });

  it('bike at 50 km/h is within limits', () => {
    // 50 km in 3600 s
    const result = checkCardioSpeed('biking_outside', 50_000, 3600);
    expect(result.implausible).toBe(false);
  });
});

// ─── checkDailyHours ─────────────────────────────────────────────────────────

describe('checkDailyHours', () => {
  it('a normal 1-hour workout is fine', () => {
    const result = checkDailyHours([], [], 60, 0);
    expect(result.implausible).toBe(false);
  });

  it('5 hours of strength training triggers workout_hours violation', () => {
    const result = checkDailyHours([], [], 300, 0);
    expect(result.implausible).toBe(true);
    expect(result.reason).toBe('workout_hours');
  });

  it('13 hours of cardio triggers cardio_hours violation', () => {
    const result = checkDailyHours([], [], 0, 13 * 3600);
    expect(result.implausible).toBe(true);
    expect(result.reason).toBe('cardio_hours');
  });

  it('3h workout + 12h cardio triggers combined_hours violation', () => {
    const result = checkDailyHours([], [], 180, 12 * 3600);
    expect(result.implausible).toBe(true);
    expect(result.reason).toBe('combined_hours');
  });

  it('accumulates existing logs when checking limits', () => {
    const existingWorkout = [{ duration_minutes: 180 }]; // 3h already logged
    // Adding another 90 min should exceed the 4h limit
    const result = checkDailyHours(existingWorkout, [], 90, 0);
    expect(result.implausible).toBe(true);
    expect(result.reason).toBe('workout_hours');
  });

  it('has DAILY_HOUR_LIMITS constants for workoutHours, cardioHours, combinedHours', () => {
    expect(DAILY_HOUR_LIMITS.workoutHours).toBeGreaterThan(0);
    expect(DAILY_HOUR_LIMITS.cardioHours).toBeGreaterThan(0);
    expect(DAILY_HOUR_LIMITS.combinedHours).toBeGreaterThan(0);
  });
});
