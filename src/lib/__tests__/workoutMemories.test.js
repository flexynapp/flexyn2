// Tests for src/lib/workoutMemories.js — the "this day last year"
// memory finder + summarizer. Pure functions, easy to test
// deterministically with fixed `now`.

import { describe, it, expect } from 'vitest';
import { findWorkoutMemory, summarizeMemoryLog } from '../workoutMemories';

// Use local-timezone Date constructors so 'May 22' means May 22
// across every timezone the test might run in. Bare 'YYYY-MM-DD'
// strings parse as UTC midnight and then getMonth/getDate return
// local-tz values, causing day-drift on PT-and-west runners.
const NOW = new Date(2026, 4, 22, 12, 0, 0); // May 22, 2026 noon local

// Helper: build a log with a known local date + content.
// Pass (year, month0Indexed, day) — accepts a tuple.
function log({ year, month, day, exercises }) {
  const d = new Date(year, month, day, 8, 0, 0);
  return { date: d.toISOString(), exercises };
}

const goodExercise = (name = 'Bench Press', weight = 225, reps = 5) => ({
  name,
  sets: [{ weight, reps }],
});

describe('findWorkoutMemory', () => {
  it('returns null on empty logs', () => {
    expect(findWorkoutMemory([], NOW)).toBe(null);
    expect(findWorkoutMemory(null, NOW)).toBe(null);
  });

  it('returns null when no log matches today\'s month+day in a past year', () => {
    const logs = [
      log({ year: 2025, month: 4, day: 21, exercises: [goodExercise()] }), // off-by-one day
      log({ year: 2025, month: 3, day: 22, exercises: [goodExercise()] }), // off-by-one month
    ];
    expect(findWorkoutMemory(logs, NOW)).toBe(null);
  });

  it('returns the matching log when exactly 1 year ago is present', () => {
    const logs = [
      log({ year: 2025, month: 4, day: 22, exercises: [goodExercise()] }),
    ];
    const memory = findWorkoutMemory(logs, NOW);
    expect(memory).not.toBe(null);
    expect(memory.yearLabel).toBe('1 year ago');
  });

  it('prefers the most recent past year when multiple match', () => {
    const logs = [
      log({ year: 2024, month: 4, day: 22, exercises: [goodExercise()] }),
      log({ year: 2025, month: 4, day: 22, exercises: [goodExercise('Squat', 315, 3)] }),
      log({ year: 2023, month: 4, day: 22, exercises: [goodExercise()] }),
    ];
    const memory = findWorkoutMemory(logs, NOW);
    expect(memory.yearLabel).toBe('1 year ago');
    // The 2025 log should win
    expect(memory.log.exercises[0].name).toBe('Squat');
  });

  it('uses "N years ago" plural label correctly', () => {
    const logs = [
      log({ year: 2024, month: 4, day: 22, exercises: [goodExercise()] }),
    ];
    const memory = findWorkoutMemory(logs, NOW);
    expect(memory.yearLabel).toBe('2 years ago');
  });

  it('skips logs without exercises', () => {
    const logs = [
      log({ year: 2025, month: 4, day: 22, exercises: [] }),
    ];
    expect(findWorkoutMemory(logs, NOW)).toBe(null);
  });

  it('skips logs where every exercise has no sets', () => {
    const logs = [
      log({ year: 2025, month: 4, day: 22, exercises: [{ name: 'Bench Press', sets: [] }] }),
    ];
    expect(findWorkoutMemory(logs, NOW)).toBe(null);
  });

  it('does NOT match the current year (today is not "1 year ago today")', () => {
    const logs = [
      log({ year: 2026, month: 4, day: 22, exercises: [goodExercise()] }),
    ];
    expect(findWorkoutMemory(logs, NOW)).toBe(null);
  });

  it('handles created_at fallback when log.date is missing', () => {
    const d = new Date(2025, 4, 22, 8, 0, 0);
    const logs = [
      { created_at: d.toISOString(), exercises: [goodExercise()] },
    ];
    const memory = findWorkoutMemory(logs, NOW);
    expect(memory).not.toBe(null);
  });
});

describe('summarizeMemoryLog', () => {
  it('returns empty string on null/missing log', () => {
    expect(summarizeMemoryLog(null)).toBe('');
    expect(summarizeMemoryLog({})).toBe('');
    expect(summarizeMemoryLog({ exercises: [] })).toBe('0 exercises');
  });

  it('returns "name: weight × reps" when a top lift exists', () => {
    const summary = summarizeMemoryLog({
      exercises: [
        { name: 'Bench Press', sets: [{ weight: 225, reps: 5 }] },
        { name: 'Squat',       sets: [{ weight: 315, reps: 3 }] },
      ],
    });
    expect(summary).toContain('Squat');  // heaviest
    expect(summary).toContain('315');
    expect(summary).toContain('× 3');
  });

  it('falls back to volume + exercise count when no weights recorded', () => {
    const summary = summarizeMemoryLog({
      exercises: [
        { name: 'Pull-ups', sets: [{ reps: 10 }, { reps: 8 }] },
      ],
    });
    // No weight on any set → no top lift → falls into the count-only branch
    expect(summary).toContain('1 exercise');
  });

  it('uses displayName when name is missing', () => {
    const summary = summarizeMemoryLog({
      exercises: [{ displayName: 'Bench Press', sets: [{ weight: 200, reps: 5 }] }],
    });
    expect(summary).toContain('Bench Press');
  });
});
