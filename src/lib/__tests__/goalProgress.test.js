import { describe, it, expect } from 'vitest';
import { computeStrengthGoalProgress } from '../goalProgress';

const GOAL_CREATED = '2026-01-01T00:00:00Z';
const AFTER_GOAL   = '2026-01-15T00:00:00Z';
const BEFORE_GOAL  = '2025-12-15T00:00:00Z';

function log(date, exercises) {
  return { created_date: date, exercises };
}

describe('computeStrengthGoalProgress — weight-only goals', () => {
  const goal = { exercise_name: 'Deadlift', target_weight: 405, created_date: GOAL_CREATED };

  it('progresses linearly until weight target is met', () => {
    const logs = [log(AFTER_GOAL, [{ name: 'Deadlift', sets: [{ weight: 315, reps: 5 }] }])];
    const r = computeStrengthGoalProgress(goal, logs);
    expect(r.progress).toBeCloseTo((315 / 405) * 100, 1);
    expect(r.currentValue).toBe(315);
  });

  it('completes at exactly target weight', () => {
    const logs = [log(AFTER_GOAL, [{ name: 'Deadlift', sets: [{ weight: 405, reps: 1 }] }])];
    expect(computeStrengthGoalProgress(goal, logs).progress).toBe(100);
  });

  it('completes when target is exceeded (overshoot counts)', () => {
    const logs = [log(AFTER_GOAL, [{ name: 'Deadlift', sets: [{ weight: 425, reps: 1 }] }])];
    expect(computeStrengthGoalProgress(goal, logs).progress).toBe(100);
  });
});

describe('computeStrengthGoalProgress — reps-only (bodyweight) goals', () => {
  const goal = { exercise_name: 'Push-ups', target_reps: 100, created_date: GOAL_CREATED };

  it('counts bodyweight reps (weight is null) — was the audit bug', () => {
    const logs = [log(AFTER_GOAL, [{ name: 'Push-ups', sets: [
      { weight: null, reps: 30 }, { weight: null, reps: 25 },
    ]}])];
    const r = computeStrengthGoalProgress(goal, logs);
    expect(r.bodyweightReps).toBe(55);
    expect(r.progress).toBeCloseTo(55, 0);
    expect(r.currentValue).toBe(55);
  });

  it('counts bodyweight reps (weight is 0)', () => {
    const logs = [log(AFTER_GOAL, [{ name: 'Push-ups', sets: [
      { weight: 0, reps: 50 },
    ]}])];
    expect(computeStrengthGoalProgress(goal, logs).progress).toBe(50);
  });

  it('completes at exactly target reps', () => {
    const logs = [log(AFTER_GOAL, [{ name: 'Push-ups', sets: [{ weight: null, reps: 100 }] }])];
    expect(computeStrengthGoalProgress(goal, logs).progress).toBe(100);
  });

  it('clamps at 100% when target is overshot', () => {
    const logs = [log(AFTER_GOAL, [{ name: 'Push-ups', sets: [{ weight: null, reps: 200 }] }])];
    expect(computeStrengthGoalProgress(goal, logs).progress).toBe(100);
  });

  it('weighted-vest push-up counts toward bodyweight goal too', () => {
    const logs = [log(AFTER_GOAL, [{ name: 'Push-ups', sets: [
      { weight: 0,  reps: 40 }, // 40 bodyweight
      { weight: 25, reps: 20 }, // 20 weighted-vest reps — still progress
    ]}])];
    expect(computeStrengthGoalProgress(goal, logs).progress).toBe(60);
  });
});

describe('computeStrengthGoalProgress — weight + reps goals', () => {
  const goal = {
    exercise_name: 'Bench Press',
    target_weight: 225,
    target_reps:   5,
    created_date:  GOAL_CREATED,
  };

  it('counts reps AT-OR-ABOVE target weight (audit bug — was "exactly equal")', () => {
    const logs = [log(AFTER_GOAL, [{ name: 'Bench Press', sets: [
      { weight: 235, reps: 3 }, // counts
      { weight: 225, reps: 2 }, // counts
      { weight: 215, reps: 5 }, // does NOT count (under target)
    ]}])];
    const r = computeStrengthGoalProgress(goal, logs);
    // Weight target is met (235 >= 225), so we're in rep-counting mode.
    // repsAtOrAboveTarget = 3 + 2 = 5 → 100%
    expect(r.progress).toBe(100);
    expect(r.repsAtOrAboveTarget).toBe(5);
  });

  it('does NOT count reps below target weight even when target weight is hit elsewhere', () => {
    const logs = [log(AFTER_GOAL, [{ name: 'Bench Press', sets: [
      { weight: 225, reps: 1 }, // hits weight, contributes 1 rep
      { weight: 135, reps: 50 }, // does NOT contribute to reps-at-target
    ]}])];
    const r = computeStrengthGoalProgress(goal, logs);
    expect(r.repsAtOrAboveTarget).toBe(1);
    // Weight is met, reps incomplete: progress = (1 / 5) * 100 = 20
    expect(r.progress).toBe(20);
  });

  it('weight-not-yet-met → progress is weight-driven', () => {
    const logs = [log(AFTER_GOAL, [{ name: 'Bench Press', sets: [
      { weight: 185, reps: 5 }, // doesn't hit weight target
    ]}])];
    // Progress = (185 / 225) * 100 ≈ 82.2
    const r = computeStrengthGoalProgress(goal, logs);
    expect(r.progress).toBeCloseTo(82.22, 1);
    expect(r.maxWeight).toBe(185);
  });
});

describe('computeStrengthGoalProgress — exercise name matching', () => {
  const goal = {
    exercise_name:      'bench press',
    exercise_canonical: 'Bench Press',
    target_weight:      225,
    created_date:       GOAL_CREATED,
  };

  it('canonical name wins over user-typed name (audit bug)', () => {
    const logs = [log(AFTER_GOAL, [{ name: 'BENCH PRESS', sets: [{ weight: 225, reps: 1 }] }])];
    expect(computeStrengthGoalProgress(goal, logs).progress).toBe(100);
  });

  it('case-insensitive match', () => {
    const g = { exercise_name: 'Squat', target_weight: 315, created_date: GOAL_CREATED };
    const logs = [log(AFTER_GOAL, [{ name: 'squat', sets: [{ weight: 315, reps: 1 }] }])];
    expect(computeStrengthGoalProgress(g, logs).progress).toBe(100);
  });

  it('different exercise name → 0% progress', () => {
    const g = { exercise_name: 'Deadlift', target_weight: 405, created_date: GOAL_CREATED };
    const logs = [log(AFTER_GOAL, [{ name: 'Squat', sets: [{ weight: 500, reps: 5 }] }])];
    expect(computeStrengthGoalProgress(g, logs).progress).toBe(0);
  });
});

describe('computeStrengthGoalProgress — date filter', () => {
  const goal = { exercise_name: 'Deadlift', target_weight: 405, created_date: GOAL_CREATED };

  it('ignores logs created BEFORE the goal', () => {
    const logs = [log(BEFORE_GOAL, [{ name: 'Deadlift', sets: [{ weight: 500, reps: 1 }] }])];
    expect(computeStrengthGoalProgress(goal, logs).progress).toBe(0);
  });

  it('counts logs created AT-OR-AFTER the goal', () => {
    const logs = [
      log(BEFORE_GOAL, [{ name: 'Deadlift', sets: [{ weight: 315, reps: 3 }] }]),
      log(AFTER_GOAL,  [{ name: 'Deadlift', sets: [{ weight: 405, reps: 1 }] }]),
    ];
    expect(computeStrengthGoalProgress(goal, logs).progress).toBe(100);
  });
});

describe('computeStrengthGoalProgress — edge cases', () => {
  it('returns 0 for missing goal', () => {
    expect(computeStrengthGoalProgress(null, []).progress).toBe(0);
  });

  it('returns 0 for goal with no exercise name', () => {
    expect(computeStrengthGoalProgress({ target_weight: 100 }, []).progress).toBe(0);
  });

  it('returns 0 for malformed goal (no targets)', () => {
    expect(computeStrengthGoalProgress({ exercise_name: 'X' }, []).progress).toBe(0);
  });

  it('handles missing exercises array on a log', () => {
    expect(computeStrengthGoalProgress(
      { exercise_name: 'X', target_weight: 100, created_date: GOAL_CREATED },
      [{ created_date: AFTER_GOAL }],
    ).progress).toBe(0);
  });

  it('handles missing sets array on an exercise', () => {
    expect(computeStrengthGoalProgress(
      { exercise_name: 'X', target_weight: 100, created_date: GOAL_CREATED },
      [{ created_date: AFTER_GOAL, exercises: [{ name: 'X' }] }],
    ).progress).toBe(0);
  });

  it('skips sets with non-finite or non-positive reps — and doesn\'t count their weight', () => {
    // A set with reps=0 means "intent to lift but didn't do it" —
    // shouldn't contribute maxWeight either. Otherwise a user could
    // log weight=315, reps=0 to claim their deadlift PR.
    const logs = [{ created_date: AFTER_GOAL, exercises: [{ name: 'X', sets: [
      { weight: 100, reps: null }, { weight: 100, reps: -5 }, { weight: 100, reps: 0 },
    ]}]}];
    expect(computeStrengthGoalProgress(
      { exercise_name: 'X', target_weight: 100, created_date: GOAL_CREATED },
      logs,
    ).progress).toBe(0);
  });
});
