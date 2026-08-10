// Guards the column-name bug that made every saved workout throw its
// duration away — see src/lib/workoutDuration.js for the full account.
//
// The reason this file exists rather than a comment: the defect was
// SILENT end to end. db.js strips an unknown column and retries by
// design, so the write succeeded; every reader got `undefined` and
// rendered a plausible `0 min`; and no test asserted on any of it. A
// console.warn was the only trace. Nothing here is clever — it just
// makes the next rename fail loudly instead of quietly.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { DURATION_COLUMN, workoutDurationMin } from '@/lib/workoutDuration';

describe('workoutDurationMin', () => {
  it('names the column the table actually has', () => {
    // Pinned deliberately. If someone "tidies" this to duration_minutes the
    // writes start being stripped again, silently, exactly as before.
    expect(DURATION_COLUMN).toBe('duration_min');
  });

  it('reads the real column', () => {
    expect(workoutDurationMin({ [DURATION_COLUMN]: 47 })).toBe(47);
  });

  it('still reads an in-memory payload keyed duration_minutes', () => {
    // AI Coach plans and the pre-save payload legitimately use this key —
    // they never touch the table. Dropping the tolerance would zero the
    // XP duration bonus for every generated session.
    expect(workoutDurationMin({ duration_minutes: 45 })).toBe(45);
  });

  it('prefers the real column when a row somehow carries both', () => {
    expect(workoutDurationMin({ duration_min: 60, duration_minutes: 30 })).toBe(60);
  });

  it('returns 0 rather than NaN for absent, null or junk values', () => {
    // The original failure mode was `undefined` reaching arithmetic:
    // Math.round(0 / logs.length) is fine, but a NaN here rendered
    // "NaN min" for a frame. 0 is the honest floor.
    expect(workoutDurationMin(undefined)).toBe(0);
    expect(workoutDurationMin(null)).toBe(0);
    expect(workoutDurationMin({})).toBe(0);
    expect(workoutDurationMin({ duration_min: null })).toBe(0);
    expect(workoutDurationMin({ duration_min: 'abc' })).toBe(0);
    expect(workoutDurationMin({ duration_min: -5 })).toBe(0);
  });
});

describe('nothing writes a top-level duration_minutes to workout_logs', () => {
  // The bug was one key in one payload. This asserts on the SHAPE of the
  // write rather than on a rendered number, because every rendered number
  // was a plausible zero and told you nothing.
  //
  // Per-exercise `ex.duration_minutes` lives inside the exercises JSONB and
  // is CORRECT — the blob has no schema to disagree with. Only a top-level
  // key on the row payload is the bug, so the check is anchored to the two
  // files that build one.
  const WRITERS = [
    'src/pages/Workout.jsx',
    'src/components/workout/EditWorkoutModal.jsx',
  ];

  it.each(WRITERS)('%s writes the column the table has', (file) => {
    const src = fs.readFileSync(file, 'utf8');
    // A top-level payload key, i.e. `duration_minutes:` not preceded by
    // `ex.` / `e.` / `s.` and not inside a per-exercise map.
    const topLevelWrites = [...src.matchAll(/(^|[^.\w])duration_minutes\s*:/g)]
      // The trailing window has to be wide enough to contain the whole
      // `ex.duration_minutes` on the value side, or the filter below sees a
      // truncated `ex.duration` and reports a legitimate mapper as a bug.
      .map(m => src.slice(Math.max(0, m.index - 60), m.index + 90).replace(/\s+/g, ' '))
      // the per-exercise mappers legitimately emit `duration_minutes:` from
      // an `ex.duration_minutes` source — those carry `ex.` in the value.
      .filter(ctx => !/ex\.duration_minutes|e\.duration_minutes/.test(ctx));
    expect(topLevelWrites, `top-level duration_minutes write in ${file}`).toEqual([]);
    expect(src).toMatch(/DURATION_COLUMN/);
  });
});
