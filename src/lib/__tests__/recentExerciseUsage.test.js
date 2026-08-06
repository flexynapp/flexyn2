// Tests for src/lib/recentExerciseUsage — tracks per-user exercise
// usage in localStorage + computes ranking scores.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  recordExerciseUse,
  recordWorkoutExercises,
  getUsageScores,
} from '../recentExerciseUsage';

const EMAIL = 'test@example.com';
const KEY = `flexyn.exerciseUsage.${EMAIL}`;

describe('recordExerciseUse', () => {
  beforeEach(() => {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  });
  afterEach(() => {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  });

  it('increments count + timestamps on first record', () => {
    recordExerciseUse(EMAIL, 'Bench Press');
    const stored = JSON.parse(localStorage.getItem(KEY));
    expect(stored['bench press']).toBeTruthy();
    expect(stored['bench press'].count).toBe(1);
  });

  it('increments count on subsequent records', () => {
    recordExerciseUse(EMAIL, 'Bench Press');
    recordExerciseUse(EMAIL, 'Bench Press');
    recordExerciseUse(EMAIL, 'Bench Press');
    const stored = JSON.parse(localStorage.getItem(KEY));
    expect(stored['bench press'].count).toBe(3);
  });

  it('lowercases exercise names', () => {
    recordExerciseUse(EMAIL, 'BENCH PRESS');
    const stored = JSON.parse(localStorage.getItem(KEY));
    expect(Object.keys(stored)).toContain('bench press');
    expect(Object.keys(stored)).not.toContain('BENCH PRESS');
  });

  it('is a no-op without email or name', () => {
    recordExerciseUse('', 'bench');
    recordExerciseUse(EMAIL, '');
    expect(localStorage.getItem(KEY)).toBe(null);
  });
});

describe('recordWorkoutExercises', () => {
  beforeEach(() => {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  });

  it('records every exercise in the workout', () => {
    recordWorkoutExercises(EMAIL, [
      { name: 'Bench Press' },
      { name: 'Squat' },
      { name: 'Deadlift' },
    ]);
    const stored = JSON.parse(localStorage.getItem(KEY));
    expect(Object.keys(stored).sort()).toEqual(['bench press', 'deadlift', 'squat']);
  });

  it('handles displayName fallback', () => {
    recordWorkoutExercises(EMAIL, [{ displayName: 'Goblet Squat' }]);
    const stored = JSON.parse(localStorage.getItem(KEY));
    expect(Object.keys(stored)).toContain('goblet squat');
  });
});

describe('getUsageScores', () => {
  beforeEach(() => {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  });

  it('returns higher score for recent usage', () => {
    const recent = new Date().toISOString();
    const stale  = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(KEY, JSON.stringify({
      'bench press': { count: 5, lastUsedAt: recent },
      'old lift':    { count: 5, lastUsedAt: stale },
    }));
    const scores = getUsageScores(EMAIL);
    expect(scores['bench press']).toBeGreaterThan(scores['old lift']);
  });

  it('decays out completely beyond the 60-day window', () => {
    const ancient = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(KEY, JSON.stringify({
      'ancient lift': { count: 10, lastUsedAt: ancient },
    }));
    const scores = getUsageScores(EMAIL);
    expect(scores['ancient lift']).toBe(0);
  });

  it('returns empty object when no data exists', () => {
    expect(getUsageScores(EMAIL)).toEqual({});
  });
});
