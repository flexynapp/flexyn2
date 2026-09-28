// src/pages/__tests__/workoutPlausibilityCountsLoggedSets.test.js
//
// The "too many sets" checks in saveWorkout must judge the sets that will be
// stored, not the rows on screen. A generated plan pre-loads every prescribed
// set; "Save anyway" keeps only the filled ones (keepLoggedSets on the way to
// the insert). Counting the empty rows refused a real first workout on the
// live site on 2026-09-28: 2 filled sets reported as "25 sets, max ~21".
//
// Asserted on the source text, like workoutStoredVolume.test.js, because
// reaching saveWorkout needs an authenticated page render.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(resolve(process.cwd(), 'src/pages/Workout.jsx'), 'utf8');

describe('saveWorkout plausibility checks count only stored sets', () => {
  it('the fatigue check reads the filtered list', () => {
    const call = SOURCE.match(/detectImplausibleWorkout\(\s*\{[^}]*\}/);
    expect(call, 'detectImplausibleWorkout call not found').not.toBeNull();
    expect(call[0]).toContain('exercises: loggedExercises');
  });

  it('the per-exercise cap loops over the filtered list', () => {
    expect(SOURCE).toMatch(/const loggedExercises = keepLoggedSets\(pendingPayload\.exercises\);/);
    expect(SOURCE).toMatch(/for \(const ex of loggedExercises\)/);
    expect(SOURCE).not.toMatch(/for \(const ex of pendingPayload\.exercises\)/);
  });

  it('the insert applies the same filter', () => {
    expect(SOURCE).toMatch(/exercises: keepLoggedSets\(data\.exercises\)/);
  });
});
