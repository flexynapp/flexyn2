// Tests for src/lib/data/personalRecords — extracts PRs from
// workout logs.

import { describe, it, expect } from 'vitest';
import { bestPRForExercise, buildPRIndex, detectPRsInWorkout } from '../personalRecords';

describe('bestPRForExercise', () => {
  const logs = [
    {
      exercises: [
        { name: 'Bench Press', sets: [{ weight: 225, reps: 5 }] },
        { name: 'Squat',       sets: [{ weight: 315, reps: 3 }] },
      ],
    },
    {
      exercises: [
        { name: 'Bench Press', sets: [{ weight: 245, reps: 3 }] },
      ],
    },
    {
      exercises: [
        { name: 'bench press', sets: [{ weight: 200, reps: 8 }] }, // case-insensitive
      ],
    },
  ];

  it('returns the best Epley 1RM across all logs for the named exercise', () => {
    const best = bestPRForExercise('Bench Press', logs);
    const expected = 245 * (1 + 3 / 30); // best set was 245 × 3
    expect(best).toBeCloseTo(expected, 4);
  });

  it('is case-insensitive on exercise name match', () => {
    const best = bestPRForExercise('BENCH press', logs);
    expect(best).toBeGreaterThan(0);
  });

  it('returns 0 when the exercise has no PR', () => {
    expect(bestPRForExercise('Deadlift', logs)).toBe(0);
  });

  it('returns 0 for invalid input', () => {
    expect(bestPRForExercise('', logs)).toBe(0);
    expect(bestPRForExercise('Squat', null)).toBe(0);
  });
});

describe('buildPRIndex', () => {
  it('returns a map of lowercase name → best 1RM', () => {
    const logs = [
      {
        exercises: [
          { name: 'Bench Press', sets: [{ weight: 225, reps: 5 }] },
          { name: 'Squat',       sets: [{ weight: 315, reps: 3 }] },
        ],
      },
    ];
    const index = buildPRIndex(logs);
    expect(Object.keys(index)).toContain('bench press');
    expect(Object.keys(index)).toContain('squat');
    expect(index['bench press']).toBeGreaterThan(0);
    expect(index['squat']).toBeGreaterThan(index['bench press']);
  });

  it('keeps the higher value when two logs have the same exercise', () => {
    const logs = [
      { exercises: [{ name: 'Bench', sets: [{ weight: 100, reps: 5 }] }] },
      { exercises: [{ name: 'Bench', sets: [{ weight: 200, reps: 1 }] }] },
    ];
    const index = buildPRIndex(logs);
    expect(index['bench']).toBe(200);
  });
});

// ── detectPRsInWorkout (used by the 🏋️ celebration on workout save) ─────

describe('detectPRsInWorkout', () => {
  const history = [
    {
      exercises: [
        { name: 'Bench Press', sets: [{ weight: 225, reps: 5 }] }, // 1RM ~ 262.5
        { name: 'Squat',       sets: [{ weight: 315, reps: 3 }] }, // 1RM ~ 346.5
      ],
    },
  ];

  it('returns an empty array on an empty / null workout', () => {
    expect(detectPRsInWorkout(null, history)).toEqual([]);
    expect(detectPRsInWorkout({}, history)).toEqual([]);
    expect(detectPRsInWorkout({ exercises: [] }, history)).toEqual([]);
  });

  it('returns an empty array when no exercise improved', () => {
    const justSaved = {
      exercises: [{ name: 'Bench Press', sets: [{ weight: 200, reps: 5 }] }],
    };
    expect(detectPRsInWorkout(justSaved, history)).toEqual([]);
  });

  it('detects a PR when 1RM improved on an existing exercise', () => {
    const justSaved = {
      exercises: [{ name: 'Bench Press', sets: [{ weight: 245, reps: 5 }] }],
    };
    const prs = detectPRsInWorkout(justSaved, history);
    expect(prs).toHaveLength(1);
    expect(prs[0].displayName.toLowerCase()).toBe('bench press');
    expect(prs[0].newPR).toBeGreaterThan(prs[0].oldPR);
    expect(prs[0].delta).toBeGreaterThan(0);
  });

  it('does NOT count a first-ever attempt as a PR', () => {
    // Deadlift has no history → not a PR even though it has a positive 1RM
    const justSaved = {
      exercises: [{ name: 'Deadlift', sets: [{ weight: 405, reps: 1 }] }],
    };
    expect(detectPRsInWorkout(justSaved, history)).toEqual([]);
  });

  it('detects multiple simultaneous PRs in one workout', () => {
    const justSaved = {
      exercises: [
        { name: 'Bench Press', sets: [{ weight: 245, reps: 5 }] }, // PR (was 225x5)
        { name: 'Squat',       sets: [{ weight: 365, reps: 1 }] }, // PR (was 315x3)
      ],
    };
    const prs = detectPRsInWorkout(justSaved, history);
    expect(prs).toHaveLength(2);
    const names = prs.map(p => p.displayName.toLowerCase());
    expect(names).toContain('bench press');
    expect(names).toContain('squat');
  });

  it('matches exercise names case-insensitively', () => {
    const justSaved = {
      exercises: [{ name: 'BENCH PRESS', sets: [{ weight: 250, reps: 6 }] }],
    };
    const prs = detectPRsInWorkout(justSaved, history);
    expect(prs).toHaveLength(1);
  });

  it('uses displayName when name is missing', () => {
    const justSaved = {
      exercises: [{ displayName: 'Bench Press', sets: [{ weight: 250, reps: 6 }] }],
    };
    const prs = detectPRsInWorkout(justSaved, history);
    expect(prs).toHaveLength(1);
    expect(prs[0].displayName).toBe('Bench Press');
  });
});
