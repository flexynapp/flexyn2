// A Mirror's target counts only the sets the server can credit: rep sets on
// named exercises (duels audit, round four). An empty set row or an unnamed
// exercise used to make 100% unreachable.

import { describe, it, expect } from 'vitest';
import { templateExercises, templateSetCount } from '@/components/duels/duelLabels';

const template = {
  exercises: [
    { name: 'Bench Press', sets: [{ weight: 135, reps: 8 }, { weight: 135, reps: 8 }, { weight: null, reps: null }] },
    { name: '  ', sets: [{ weight: 20, reps: 10 }] },
    { name: 'Plank', sets: [{ weight: 0, reps: 0 }] },
    { name: 'Row', sets: [{ weight: 95, reps: 10 }] },
  ],
};

describe('Mirror template counting', () => {
  it('lists named exercises with the sets that carry reps', () => {
    expect(templateExercises(template)).toEqual([
      { name: 'Bench Press', sets: 2 },
      { name: 'Row', sets: 1 },
    ]);
  });

  it('totals the same sets the server scores', () => {
    expect(templateSetCount(template)).toBe(3);
  });

  it('is empty for a missing template', () => {
    expect(templateExercises(null)).toEqual([]);
    expect(templateSetCount(undefined)).toBe(0);
  });
});
