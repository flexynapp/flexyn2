import { describe, it, expect } from 'vitest';
import {
  getXpForNextLevel,
  getTotalXpForLevel,
  calculateLevelFromXp,
  calculateWorkoutXp,
  calculateCardioXp,
  calculateTotalVolume,
  calculateGoalXp,
  MAX_WORKOUT_XP,
  MAX_CARDIO_XP,
  XP_REWARDS,
  MAX_LEVEL,
  TOTAL_XP_FOR_MAX_LEVEL,
} from '../xpSystem';

// ─── Level curve ──────────────────────────────────────────────────────────────

describe('getXpForNextLevel', () => {
  it('returns a positive integer for every level below the cap', () => {
    for (let i = 1; i < MAX_LEVEL; i++) {
      expect(getXpForNextLevel(i)).toBeGreaterThan(0);
    }
  });

  it('is monotonically non-decreasing as level increases', () => {
    for (let i = 2; i < MAX_LEVEL; i++) {
      expect(getXpForNextLevel(i)).toBeGreaterThanOrEqual(getXpForNextLevel(i - 1));
    }
  });

  it('level 1 → 2 costs the configured base (100 XP)', () => {
    // Keep in sync with LEVEL_CONFIG.baseXpPerLevel in src/lib/xpSystem.js.
    expect(getXpForNextLevel(1)).toBe(100);
  });

  it('returns 0 at the level cap — there is no next level to buy', () => {
    expect(getXpForNextLevel(MAX_LEVEL)).toBe(0);
  });

  // Regression: the previous curve computed `base * multiplier^(level-1)`
  // with a different multiplier per tier band, which re-based every level
  // below the boundary. Crossing L60→L61 cost 3.2x more in a single level
  // and L80→L81 cost 4.6x more. The curve must not cliff at a band edge.
  it('has no cliff at any tier boundary', () => {
    for (const boundary of [10, 30, 60, 80]) {
      const before = getXpForNextLevel(boundary);
      const after = getXpForNextLevel(boundary + 1);
      expect(after / before).toBeLessThan(1.2);
    }
  });

  // Regression: the shipped curve put level 100 at 192,438,890 XP — 659
  // years at a realistic 800 XP/day, so the top four cosmetic tiers in
  // xpTier.js were unreachable. Max level must stay inside a few years.
  it('keeps the level cap reachable within a few years of real training', () => {
    const daysAt800PerDay = TOTAL_XP_FOR_MAX_LEVEL / 800;
    expect(daysAt800PerDay).toBeLessThan(365 * 3);
    expect(daysAt800PerDay).toBeGreaterThan(365); // and not trivially fast
  });

  // Every tier band in xpTier.js should be somewhere a real person passes
  // through. Under the old curve, levels 1-60 were 0.1% of the ladder and
  // 81-100 were 97.2% of it.
  it('spreads the ladder so no single band dominates it', () => {
    const share = (from, to) =>
      (getTotalXpForLevel(to) - getTotalXpForLevel(from)) / TOTAL_XP_FOR_MAX_LEVEL;
    expect(share(81, 100)).toBeLessThan(0.7);
    expect(share(31, 61)).toBeGreaterThan(0.05);
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

  it('returns level 1 with correct progress at 50 XP (half of first level)', () => {
    // Half of baseXpPerLevel (100). Update if curve config changes.
    const result = calculateLevelFromXp(50);
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

  // DAILY_XP_CAP is deliberately gone. It claimed 2,500/day, nothing read it,
  // and the enforced ceiling was 50,000 — see the comment where it used to
  // live. Daily caps belong to grant_action_xp and increment_user_xp. This
  // asserts it stays gone, so nobody reintroduces a second source of truth.
  it('does not export a client-side daily cap', async () => {
    const mod = await import('../xpSystem');
    expect(mod.DAILY_XP_CAP).toBeUndefined();
  });
  it('XP_REWARDS.waterGlass is a small positive number', () => {
    expect(XP_REWARDS.waterGlass).toBeGreaterThan(0);
    expect(XP_REWARDS.waterGlass).toBeLessThan(20);
  });
  it('XP_REWARDS.achievementUnlocked is a function', () => {
    expect(typeof XP_REWARDS.achievementUnlocked).toBe('function');
    expect(XP_REWARDS.achievementUnlocked(50)).toBe(50);
  });
});

// ─── Goal completion ──────────────────────────────────────────────────────────
//
// The formula this replaces lived twice (GoalsModal + GoalsAlmostComplete),
// capped at 500, and scaled off numbers the user TYPES when creating the
// goal. Nothing verifies a target against a lift, so a 1000 lb goal paid
// 500 XP — the entire goal_completed daily allowance (migration 262) for
// one tap. These lock the ceiling to the documented reward.

describe('calculateGoalXp', () => {
  it('never pays more than the documented goal reward, however big the target', () => {
    for (const target of [500, 1000, 99999]) {
      expect(calculateGoalXp({ target_weight: target, target_reps: target }))
        .toBe(XP_REWARDS.goalCompleted);
    }
  });

  it('still ranks a heavier goal above a lighter one below the cap', () => {
    const light = calculateGoalXp({ target_weight: 45,  target_reps: 5 });
    const mid   = calculateGoalXp({ target_weight: 95,  target_reps: 5 });
    expect(mid).toBeGreaterThan(light);
    expect(mid).toBeLessThanOrEqual(XP_REWARDS.goalCompleted);
  });

  it('handles weight-only and reps-only goals', () => {
    expect(calculateGoalXp({ target_weight: 100 })).toBe(75);
    expect(calculateGoalXp({ target_reps: 20 })).toBe(80);
  });

  it('pays nothing for a goal with no numeric target', () => {
    expect(calculateGoalXp({})).toBe(0);
    expect(calculateGoalXp(null)).toBe(0);
    expect(calculateGoalXp({ target_weight: 0, target_reps: 0 })).toBe(0);
  });

  it('ignores negative / junk targets rather than crediting them', () => {
    expect(calculateGoalXp({ target_weight: -500 })).toBe(0);
    expect(calculateGoalXp({ target_reps: 'lots' })).toBe(0);
  });
});
