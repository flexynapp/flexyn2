// Guards the second column-name bug of the day — see src/lib/workoutTitle.js.
//
// Same reasoning as workoutDuration.test.js: the defect was silent end to
// end. db.js strips an unknown column and retries by design, so the write
// succeeded; every reader had a sensible fallback ("Freestyle") so nothing
// looked broken; and no test asserted on the shape of the write. Two of
// these bugs shipped the same way, which is the argument for the guard
// rather than for care.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { TITLE_COLUMN, workoutTitle } from '@/lib/workoutTitle';

describe('workoutTitle', () => {
  it('names the column the table actually has', () => {
    // Pinned. `regimen_name` and `regimen_id` are base44 leftovers that
    // workout_logs has never had.
    expect(TITLE_COLUMN).toBe('title');
  });

  it('reads the real column', () => {
    expect(workoutTitle({ [TITLE_COLUMN]: 'Push Day A' })).toBe('Push Day A');
  });

  it('still reads regimen_name, because every pre-fix row has a NULL title', () => {
    expect(workoutTitle({ regimen_name: 'Leg Day' })).toBe('Leg Day');
  });

  it('prefers the real column when a row carries both', () => {
    expect(workoutTitle({ title: 'Real', regimen_name: 'Legacy' })).toBe('Real');
  });

  it('returns null — not a default — when there is no name', () => {
    // A workout's name is genuinely optional, and the fallback wording is a
    // translated string this module has no business owning.
    expect(workoutTitle(undefined)).toBeNull();
    expect(workoutTitle(null)).toBeNull();
    expect(workoutTitle({})).toBeNull();
    expect(workoutTitle({ title: null })).toBeNull();
    expect(workoutTitle({ title: '   ' })).toBeNull();
    expect(workoutTitle({ title: 42 })).toBeNull();
  });
});

describe('nothing writes regimen_name or regimen_id to workout_logs', () => {
  // Asserts on the SHAPE of the write, not on a rendered name, because
  // every rendered name was a plausible "Freestyle" and told you nothing.
  const WRITERS = [
    'src/pages/Workout.jsx',
    'src/components/workout/EditWorkoutModal.jsx',
  ];

  it.each(WRITERS)('%s writes the column the table has', (file) => {
    const src = fs.readFileSync(file, 'utf8');
    // A payload key, i.e. `regimen_name:` / `regimen_id:` not reached
    // through a property access on something else.
    const writes = [...src.matchAll(/(^|[^.\w])regimen_(name|id)\s*:/g)]
      .map(m => src.slice(Math.max(0, m.index - 50), m.index + 60).replace(/\s+/g, ' '));
    expect(writes, `regimen_* write in ${file}`).toEqual([]);
    expect(src).toMatch(/TITLE_COLUMN/);
  });

  it('no writer sends a regimen_id at all — it had no readers to serve', () => {
    for (const file of WRITERS) {
      const src = fs.readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(src, `${file} still references a workout regimen_id`).not.toMatch(/regimen_id/);
    }
  });
});
