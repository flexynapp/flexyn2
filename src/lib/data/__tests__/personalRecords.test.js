// Tests for src/lib/data/personalRecords — extracts PRs from
// workout logs.

import { describe, it, expect } from 'vitest';
import { bestPRForExercise, buildPRIndex } from '../personalRecords';

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
