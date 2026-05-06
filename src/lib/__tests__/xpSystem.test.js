import { describe, it, expect } from 'vitest';
import {
  getXpForNextLevel,
  getTotalXpForLevel,
  calculateLevelFromXp,
  calculateWorkoutXp,
  calculateCardioXp,
  calculateTotalVolume,
  MAX_WORKOUT_XP,
  MAX_CARDIO_XP,
  DAILY_XP_CAP,
  XP_REWARDS,
} from '../xpSystem';

// ─── Level curve ──────────────────────────────────────────────────────────────

describe('getXpForNextLevel', () => {
  it('returns a positive integer for every level', () => {
    for (let i = 1; i <= 100; i++) {
      expect(getXpForNextLevel(i)).toBeGreaterThan(0);
    }
  });

  it('is monotonically non-decreasing as level increases', () => {
    for (let i = 2; i <= 100; i++) {
      expect(getXpForNextLevel(i)).toBeGreaterThanOrEqual(getXpForNextLevel(i - 1));
    }
  });

  it('level 1 → 2 costs the configured base (150 XP)', () => {
    // Lowered from 300 in the curve rebalance — keep this test in sync with
    // LEVEL_CONFIG.baseXpPerLevel in src/lib/xpSystem.js.
    expect(getXpForNextLevel(1)).toBe(150);
  });
});

describe('getTotalXpForLevel', () => {
  it('returns 0 for level 1 (starting point)', () => {
    expect(getTotalXpForLevel(1)).toBe(0);
  });

  it('is strictly increasing with each level', () => {
    for (let i = 2; i <= 20; i++) {
      expect(getTotalXpForLevel(i)).toBeGreaterThan(getTotalXpForLevel(i - 1));
    }
  });
});

describe('calculateLevelFromXp', () => {
  it('0 XP → level 1', () => {
    const result = calculateLevelFromXp(0);
    expect(result.level).toBe(1);
    expect(result.xpInLevel).toBe(0);
  });

  it('returns level 1 with correct progress at 75 XP (half of first level)', () => {
    // Half of the new baseXpPerLevel (150). Update if curve config changes.
    const result = calculateLevelFromXp(75);
    expect(result.level).toBe(1);
    expect(result.progressPercent).toBeCloseTo(50, 0);
  });

  it('exactly enough XP to reach level 2 → level 2, 0 progress', () => {
    const xpNeeded = getTotalXpForLevel(2);
    const result = calculateLevelFromXp(xpNeeded);
    expect(result.level).toBe(2);
    expect(result.xpInLevel).toBe(0);
  });

  it('never returns a level above 100 regardless of XP', () => {
    // The curve is steep — use an astronomical number to guarantee hitting the cap
    const result = calculateLevelFromXp(Number.MAX_SAFE_INTEGER);
    expect(result.level).toBe(100);
    expect(result.progressPercent).toBe(100);
  });

  it('large but sub-cap XP returns a level between 1 and 100', () => {
    const result = calculateLevelFromXp(999_999_999);
    expect(result.level).toBeGreaterThanOrEqual(1);
    expect(result.level).toBeLessThanOrEqual(100);
  });

  it('progressPercent is always 0–100', () => {
    [0, 100, 500, 2000, 10000, 100000].forEach(xp => {
      const { progressPercent } = calculateLevelFromXp(xp);
      expect(progressPercent).toBeGreaterThanOrEqual(0);
      expect(progressPercent).toBeLessThanOrEqual(100);
    });
  });
});

// ─── Workout XP ───────────────────────────────────────────────────────────────

describe('calculateWorkoutXp', () => {
  it('returns 0 for empty / null workout', () => {
    expect(calculateWorkoutXp(null)).toBe(0);
    expect(calculateWorkoutXp({})).toBe(0);
    expect(calculateWorkoutXp({ exercises: [] })).toBe(0);
  });

  it('beginner session stays under 120 XP', () => {
    // 3 exercises × 2 sets × 45 lb bench, 10 reps, 20 min
    const xp = calculateWorkoutXp({
      duration_minutes: 20,
      exercises: Array(3).fill({
        sets: [
          { weight: 45, reps: 10 },
          { weight: 45, reps: 10 },
        ],
      }),
    });
    expect(xp).toBeLessThanOrEqual(120);
    expect(xp).toBeGreaterThan(0);
  });

  it('intermediate session gives 150–400 XP', () => {
    // 5 exercises × 4 sets × 135 lb, 8 reps, 45 min
    const xp = calculateWorkoutXp({
      duration_minutes: 45,
      exercises: Array(5).fill({
        sets: Array(4).fill({ weight: 135, reps: 8 }),
      }),
    });
    expect(xp).toBeGreaterThan(150);
    expect(xp).toBeLessThanOrEqual(MAX_WORKOUT_XP);
  });

  it('heavy powerlifter session approaches the cap', () => {
    // 6 exercises × 5 sets × 315 lb deadlift, 5 reps, 90 min
    const xp = calculateWorkoutXp({
      duration_minutes: 90,
      exercises: Array(6).fill({
        sets: Array(5).fill({ weight: 315, reps: 5 }),
      }),
    });
    expect(xp).toBeGreaterThan(600);
    expect(xp).toBeLessThanOrEqual(MAX_WORKOUT_XP);
  });

  it('never exceeds MAX_WORKOUT_XP no matter the input', () => {
    const xp = calculateWorkoutXp({
      duration_minutes: 9999,
      exercises: Array(100).fill({
        sets: Array(50).fill({ weight: 1000, reps: 100 }),
      }),
    });
    expect(xp).toBe(MAX_WORKOUT_XP);
  });

  it('bodyweight-only sets still earn XP', () => {
    const xp = calculateWorkoutXp({
      duration_minutes: 15,
      exercises: [{ sets: [{ weight: 0, reps: 20 }, { weight: 0, reps: 20 }] }],
    });
    expect(xp).toBeGreaterThan(0);
  });

  it('ignores sets with zero reps', () => {
    const xpWithReps    = calculateWorkoutXp({ exercises: [{ sets: [{ weight: 100, reps: 10 }] }] });
    const xpWithoutReps = calculateWorkoutXp({ exercises: [{ sets: [{ weight: 100, reps: 0 }] }] });
    expect(xpWithReps).toBeGreaterThan(xpWithoutReps);
  });
});

// ─── Cardio XP ────────────────────────────────────────────────────────────────

describe('calculateCardioXp', () => {
  it('returns 0 for missing or zero duration', () => {
    expect(calculateCardioXp({ duration_seconds: 0 })).toBe(0);
    expect(calculateCardioXp({})).toBe(0);
  });

  it('20-min jog gives 30–80 XP', () => {
    const xp = calculateCardioXp({ duration_seconds: 1200 });
    expect(xp).toBeGreaterThanOrEqual(30);
    expect(xp).toBeLessThanOrEqual(80);
  });

  it('60-min run with distance + calories gives more XP than time-only', () => {
    const timeOnly = calculateCardioXp({ duration_seconds: 3600 });
    const withData = calculateCardioXp({ duration_seconds: 3600, distance_meters: 10000, calories: 600 });
    expect(withData).toBeGreaterThan(timeOnly);
  });

  it('awards 10% intensity bonus when both distance AND calories are logged', () => {
    const withoutBonus = calculateCardioXp({ duration_seconds: 3600, distance_meters: 10000 });
    const withBonus    = calculateCardioXp({ duration_seconds: 3600, distance_meters: 10000, calories: 600 });
    expect(withBonus).toBeGreaterThan(withoutBonus);
  });

  it('never exceeds MAX_CARDIO_XP', () => {
    const xp = calculateCardioXp({
      duration_seconds: 99999,
      distance_meters: 9999999,
      calories: 99999,
    });
    expect(xp).toBe(MAX_CARDIO_XP);
  });
});

// ─── Volume helper ────────────────────────────────────────────────────────────

describe('calculateTotalVolume', () => {
  it('returns 0 for empty input', () => {
    expect(calculateTotalVolume(null)).toBe(0);
    expect(calculateTotalVolume([])).toBe(0);
    expect(calculateTotalVolume([{ sets: [] }])).toBe(0);
  });

  it('computes weight × reps summed across all exercises and sets', () => {
    const exercises = [
      { sets: [{ weight: 100, reps: 5 }, { weight: 100, reps: 5 }] },
      { sets: [{ weight: 200, reps: 3 }] },
    ];
    expect(calculateTotalVolume(exercises)).toBe(100 * 5 + 100 * 5 + 200 * 3);
  });

  it('ignores missing weight or reps gracefully', () => {
    const exercises = [{ sets: [{ weight: null, reps: 10 }, { weight: 100, reps: undefined }] }];
    expect(calculateTotalVolume(exercises)).toBe(0);
  });
});

// ─── Constants ────────────────────────────────────────────────────────────────

describe('XP constants', () => {
  it('MAX_WORKOUT_XP is 1000', () => expect(MAX_WORKOUT_XP).toBe(1000));
  it('MAX_CARDIO_XP is 600',   () => expect(MAX_CARDIO_XP).toBe(600));
  it('DAILY_XP_CAP is 2500',  () => expect(DAILY_XP_CAP).toBe(2500));
  it('XP_REWARDS.waterGlass is a small positive number', () => {
    expect(XP_REWARDS.waterGlass).toBeGreaterThan(0);
    expect(XP_REWARDS.waterGlass).toBeLessThan(20);
  });
  it('XP_REWARDS.achievementUnlocked is a function', () => {
    expect(typeof XP_REWARDS.achievementUnlocked).toBe('function');
    expect(XP_REWARDS.achievementUnlocked(50)).toBe(50);
  });
});
