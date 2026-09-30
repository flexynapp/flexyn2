import { describe, it, expect } from 'vitest';
import { computeStrengthGoalProgress, goalProgress, goalTargetLabel } from '../goalProgress';

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

describe('computeStrengthGoalProgress — reps-only goals are ONE set', () => {
  const goal = { exercise_name: 'Pull-ups', target_reps: 15, created_date: GOAL_CREATED };

  it('counts bodyweight sets (weight null or 0)', () => {
    const logs = [log(AFTER_GOAL, [{ name: 'Pull-ups', sets: [
      { weight: null, reps: 9 }, { weight: 0, reps: 12 },
    ]}])];
    const r = computeStrengthGoalProgress(goal, logs);
    expect(r.currentValue).toBe(12);
    expect(r.progress).toBeCloseTo(80, 5);
  });

  it('does NOT add sets together — three sets of 5 are not a set of 15', () => {
    const logs = [log(AFTER_GOAL, [{ name: 'Pull-ups', sets: [
      { weight: null, reps: 5 }, { weight: null, reps: 5 }, { weight: null, reps: 5 },
    ]}])];
    expect(computeStrengthGoalProgress(goal, logs).progress).toBeCloseTo(33.33, 1);
  });

  it('does NOT add sessions together', () => {
    const logs = [
      log(AFTER_GOAL, [{ name: 'Pull-ups', sets: [{ weight: null, reps: 10 }] }]),
      log(AFTER_GOAL, [{ name: 'Pull-ups', sets: [{ weight: null, reps: 10 }] }]),
    ];
    expect(computeStrengthGoalProgress(goal, logs).currentValue).toBe(10);
  });

  it('completes at exactly target reps and clamps past it', () => {
    const at = [log(AFTER_GOAL, [{ name: 'Pull-ups', sets: [{ weight: null, reps: 15 }] }])];
    const over = [log(AFTER_GOAL, [{ name: 'Pull-ups', sets: [{ weight: null, reps: 22 }] }])];
    expect(computeStrengthGoalProgress(goal, at).progress).toBe(100);
    expect(computeStrengthGoalProgress(goal, over).progress).toBe(100);
  });

  it('a weighted-vest set counts toward a rep goal', () => {
    const logs = [log(AFTER_GOAL, [{ name: 'Pull-ups', sets: [{ weight: 25, reps: 15 }] }])];
    expect(computeStrengthGoalProgress(goal, logs).progress).toBe(100);
  });
});

describe('computeStrengthGoalProgress — weight + reps goals are ONE set', () => {
  const goal = {
    exercise_name: 'Bench Press',
    target_weight: 225,
    target_reps:   5,
    created_date:  GOAL_CREATED,
  };

  it('one set at or above the weight for the reps completes it', () => {
    const logs = [log(AFTER_GOAL, [{ name: 'Bench Press', sets: [{ weight: 230, reps: 5 }] }])];
    const r = computeStrengthGoalProgress(goal, logs);
    expect(r.progress).toBe(100);
    expect(r.bestSet).toEqual({ weight: 230, reps: 5 });
  });

  it('five singles at the weight do NOT complete it (the old summing bug)', () => {
    const logs = [
      log(AFTER_GOAL, [{ name: 'Bench Press', sets: [{ weight: 225, reps: 1 }, { weight: 225, reps: 1 }] }]),
      log(AFTER_GOAL, [{ name: 'Bench Press', sets: [{ weight: 225, reps: 1 }, { weight: 225, reps: 1 }, { weight: 225, reps: 1 }] }]),
    ];
    const r = computeStrengthGoalProgress(goal, logs);
    expect(r.progress).toBeCloseTo(20, 5);
    expect(r.progress).toBeLessThan(100);
  });

  it('a lighter set for the full reps reads as weight progress', () => {
    const logs = [log(AFTER_GOAL, [{ name: 'Bench Press', sets: [{ weight: 185, reps: 5 }] }])];
    const r = computeStrengthGoalProgress(goal, logs);
    expect(r.progress).toBeCloseTo((185 / 225) * 100, 1);
    expect(r.currentValue).toBe(185);
    expect(r.maxWeight).toBe(185);
  });

  it('picks the set closest to the target, not the heaviest', () => {
    const logs = [log(AFTER_GOAL, [{ name: 'Bench Press', sets: [
      { weight: 235, reps: 2 },  // 1.0 × 0.4 = 0.40
      { weight: 215, reps: 5 },  // 0.955 × 1 = 0.955
    ]}])];
    const r = computeStrengthGoalProgress(goal, logs);
    expect(r.bestSet).toEqual({ weight: 215, reps: 5 });
    expect(r.maxWeight).toBe(235);
  });

  it('a bodyweight set is no progress toward a weight goal', () => {
    const logs = [log(AFTER_GOAL, [{ name: 'Bench Press', sets: [{ weight: 0, reps: 20 }] }])];
    expect(computeStrengthGoalProgress(goal, logs).progress).toBe(0);
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

describe('goalProgress — dispatches on type', () => {
  it('reads cardio goals from cardio logs', () => {
    const goal = { goal_type: 'cardio_sessions', cardio_activity: 'any', period: 'lifetime', target_sessions: 4, created_date: GOAL_CREATED };
    const cardio = [{ created_date: AFTER_GOAL, type: 'running_outside' }];
    expect(goalProgress(goal, [], cardio)).toBe(25);
    expect(goalProgress(goal, [], undefined)).toBe(0);
  });
  it('reads strength goals from workout logs', () => {
    const goal = { exercise_name: 'Deadlift', target_weight: 400, created_date: GOAL_CREATED };
    expect(goalProgress(goal, [log(AFTER_GOAL, [{ name: 'Deadlift', sets: [{ weight: 200, reps: 1 }] }])], [])).toBe(50);
  });
});

describe('goalTargetLabel', () => {
  // Stub that interpolates, so a dropped {n} would show.
  const tFallback = (_key, english, vars = {}) => english.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
  const opts = { tFallback, weightUnit: 'lbs', distanceUnit: 'km' };

  it('names a set goal as weight × reps, so two bench goals differ', () => {
    expect(goalTargetLabel({ exercise_name: 'Bench Press', target_weight: 225, target_reps: 5 }, opts)).toMatch(/225.*× 5$/);
    expect(goalTargetLabel({ exercise_name: 'Bench Press', target_weight: 185, target_reps: 8 }, opts)).toMatch(/185.*× 8$/);
  });

  it('names a rep only goal in words', () => {
    expect(goalTargetLabel({ exercise_name: 'Pull-ups', target_reps: 15 }, opts)).toBe('15 reps in one set');
  });

  it('names a distance goal in the reader\'s unit', () => {
    const marathon = { goal_type: 'cardio_distance', cardio_activity: 'running', single_session: true, target_distance_meters: 42195 };
    expect(goalTargetLabel(marathon, opts)).toMatch(/^42\.2/);
    expect(goalTargetLabel(marathon, { ...opts, distanceUnit: 'mi' })).toMatch(/^26\.2/);
  });

  it('names a sessions goal with its count', () => {
    expect(goalTargetLabel({ goal_type: 'cardio_sessions', target_sessions: 3 }, opts)).toBe('3 sessions');
  });

  it('is empty for a goal with no target', () => {
    expect(goalTargetLabel({ exercise_name: 'Squat' }, opts)).toBe('');
  });
});
