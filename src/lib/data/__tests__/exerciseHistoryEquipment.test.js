// Tests for the equipment-aware half of exerciseHistory (Phase 5).
//
// Two things matter here. First, getRecentSessionsForExercise's
// long-standing contract — an array of set-arrays — must be byte-for-byte
// unchanged now that it's a wrapper, because ExerciseLogger's warm-up
// seeder reads it. Second, equipment must be treated as optional
// forever: every session logged before the picker existed has none.

import { describe, it, expect } from 'vitest';
import {
  getRecentSessionsForExercise,
  getRecentSessionsDetailed,
  getLastImplementForExercise,
} from '../exerciseHistory';

const hammer = { brand: 'hammer_strength', line: 'Plate Loaded', model: 'Iso-Lateral Row', label: 'Hammer Strength Iso-Lateral Row' };
const cybex  = { brand: 'cybex', line: 'Eagle', model: null, label: 'Cybex Eagle' };

const logs = [
  { date: '2026-07-20', exercises: [{ name: 'Seated Row', equipment: hammer, sets: [{ weight: 185, reps: 8 }] }] },
  { date: '2026-07-13', exercises: [{ name: 'Seated Row', equipment: cybex,  sets: [{ weight: 160, reps: 8 }] }] },
  // Pre-picker session — no equipment key at all.
  { date: '2026-07-06', exercises: [{ name: 'Seated Row', sets: [{ weight: 155, reps: 8 }] }] },
];

describe('getRecentSessionsForExercise — unchanged contract', () => {
  it('still returns bare arrays of sets, newest first', () => {
    const r = getRecentSessionsForExercise(logs, 'Seated Row', 3);
    expect(r).toEqual([
      [{ weight: 185, reps: 8 }],
      [{ weight: 160, reps: 8 }],
      [{ weight: 155, reps: 8 }],
    ]);
  });

  it('still returns [] for junk input', () => {
    expect(getRecentSessionsForExercise(null, 'Seated Row')).toEqual([]);
    expect(getRecentSessionsForExercise(logs, '')).toEqual([]);
    expect(getRecentSessionsForExercise(logs, null)).toEqual([]);
  });
});

describe('getRecentSessionsDetailed', () => {
  it('carries the machine alongside the sets', () => {
    const r = getRecentSessionsDetailed(logs, 'Seated Row', 3);
    expect(r).toHaveLength(3);
    expect(r[0].equipment.label).toBe('Hammer Strength Iso-Lateral Row');
    expect(r[1].equipment.label).toBe('Cybex Eagle');
    expect(r[0].sets).toEqual([{ weight: 185, reps: 8 }]);
  });

  it('returns null equipment for sessions logged before the picker', () => {
    const r = getRecentSessionsDetailed(logs, 'Seated Row', 3);
    expect(r[2].equipment).toBeNull();
  });

  it('keeps the session date', () => {
    expect(getRecentSessionsDetailed(logs, 'Seated Row', 1)[0].date).toBe('2026-07-20');
  });

  it('honors the session limit', () => {
    expect(getRecentSessionsDetailed(logs, 'Seated Row', 1)).toHaveLength(1);
  });

  it('matches case-insensitively, like the original', () => {
    expect(getRecentSessionsDetailed(logs, 'seated row', 3)).toHaveLength(3);
  });
});

describe('getLastImplementForExercise', () => {
  it('returns the most recent machine used', () => {
    expect(getLastImplementForExercise(logs, 'Seated Row').label)
      .toBe('Hammer Strength Iso-Lateral Row');
  });

  it('skips back past sessions with no machine recorded', () => {
    const gappy = [
      { date: '2026-07-20', exercises: [{ name: 'Seated Row', sets: [{ weight: 185, reps: 8 }] }] },
      { date: '2026-07-13', exercises: [{ name: 'Seated Row', equipment: cybex, sets: [{ weight: 160, reps: 8 }] }] },
    ];
    expect(getLastImplementForExercise(gappy, 'Seated Row').label).toBe('Cybex Eagle');
  });

  it('returns null when the exercise has never had one', () => {
    const none = [
      { date: '2026-07-20', exercises: [{ name: 'Seated Row', sets: [{ weight: 185, reps: 8 }] }] },
    ];
    expect(getLastImplementForExercise(none, 'Seated Row')).toBeNull();
  });

  it('returns null for an exercise never logged', () => {
    expect(getLastImplementForExercise(logs, 'Leg Press')).toBeNull();
  });

  it('ignores an equipment object with no label', () => {
    // A malformed entry shouldn't prefill the picker with a blank chip.
    const bad = [
      { date: '2026-07-20', exercises: [{ name: 'Seated Row', equipment: { brand: 'cybex' }, sets: [{ weight: 185, reps: 8 }] }] },
      { date: '2026-07-13', exercises: [{ name: 'Seated Row', equipment: cybex, sets: [{ weight: 160, reps: 8 }] }] },
    ];
    expect(getLastImplementForExercise(bad, 'Seated Row').label).toBe('Cybex Eagle');
  });

  it('survives junk input', () => {
    expect(getLastImplementForExercise(null, 'Seated Row')).toBeNull();
    expect(getLastImplementForExercise(logs, '')).toBeNull();
  });
});
