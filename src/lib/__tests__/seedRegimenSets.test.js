// Tests for src/lib/seedRegimenSets.js — the program-start set-seeding
// logic extracted from Workout.jsx's startFromRegimen. (Audit task 8.)

import { describe, it, expect } from 'vitest';
import { seedSetsForExercise } from '../seedRegimenSets';

describe('seedSetsForExercise — sets[] (program / cloned template) shape', () => {
  it('honors the set COUNT from sets[] instead of collapsing to 3', () => {
    const ex = {
      name: 'Deadlift',
      sets: [{ reps_target: 5 }], // single working set
    };
    const out = seedSetsForExercise(ex, []);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ weight: null, reps: 5 });
  });

  it('seeds reps from each set reps_target', () => {
    const ex = {
      name: 'Squat',
      sets: [{ reps_target: 5 }, { reps_target: 5 }, { reps_target: 3 }],
    };
    const out = seedSetsForExercise(ex, []);
    expect(out.map(s => s.reps)).toEqual([5, 5, 3]);
    expect(out.every(s => s.weight === null)).toBe(true);
  });

  it('prefers a set-level prescribed weight over history', () => {
    const ex = { name: 'Bench', sets: [{ reps_target: 5, weight: 135 }] };
    const out = seedSetsForExercise(ex, [{ weight: 999, reps: 8 }]);
    expect(out[0]).toEqual({ weight: 135, reps: 5 });
  });

  it('falls back to history weight when the set has no prescribed weight', () => {
    const ex = { name: 'Bench', sets: [{ reps_target: 5 }, { reps_target: 5 }] };
    const out = seedSetsForExercise(ex, [{ weight: 185, reps: 5 }, { weight: 185, reps: 5 }]);
    expect(out).toEqual([
      { weight: 185, reps: 5 },
      { weight: 185, reps: 5 },
    ]);
  });

  it('uses regimen-level target_reps when a set lacks reps_target', () => {
    const ex = { name: 'Row', target_reps: 8, sets: [{}, {}] };
    const out = seedSetsForExercise(ex, []);
    expect(out.map(s => s.reps)).toEqual([8, 8]);
  });
});

describe('seedSetsForExercise — legacy scalar (hand-built regimen) shape', () => {
  it('seeds target_sets blank rows with target_reps when no history', () => {
    const ex = { name: 'Curl', target_sets: 4, target_reps: 12 };
    const out = seedSetsForExercise(ex, []);
    expect(out).toHaveLength(4);
    expect(out).toEqual([
      { weight: null, reps: 12 },
      { weight: null, reps: 12 },
      { weight: null, reps: 12 },
      { weight: null, reps: 12 },
    ]);
  });

  it('defaults to 3 sets when target_sets is absent', () => {
    const out = seedSetsForExercise({ name: 'Plank' }, []);
    expect(out).toHaveLength(3);
    expect(out.every(s => s.weight === null && s.reps === null)).toBe(true);
  });

  it('seeds weight from history but lets target_reps win over historical reps', () => {
    const ex = { name: 'Press', target_sets: 2, target_reps: 5 };
    const out = seedSetsForExercise(ex, [{ weight: 95, reps: 8 }, { weight: 95, reps: 8 }]);
    expect(out).toEqual([
      { weight: 95, reps: 5 },
      { weight: 95, reps: 5 },
    ]);
  });

  it('keeps historical reps when there is no target_reps', () => {
    const ex = { name: 'Press', target_sets: 2 };
    const out = seedSetsForExercise(ex, [{ weight: 95, reps: 8 }, { weight: 100, reps: 6 }]);
    expect(out).toEqual([
      { weight: 95, reps: 8 },
      { weight: 100, reps: 6 },
    ]);
  });
});

describe('seedSetsForExercise — robustness', () => {
  it('tolerates a null/undefined history seed', () => {
    const ex = { name: 'X', sets: [{ reps_target: 5 }] };
    expect(seedSetsForExercise(ex, null)).toEqual([{ weight: null, reps: 5 }]);
    expect(seedSetsForExercise(ex)).toEqual([{ weight: null, reps: 5 }]);
  });

  it('treats empty-string reps_target/weight as absent', () => {
    const ex = { name: 'X', target_reps: 6, sets: [{ reps_target: '', weight: '' }] };
    const out = seedSetsForExercise(ex, []);
    expect(out[0]).toEqual({ weight: null, reps: 6 });
  });
});
