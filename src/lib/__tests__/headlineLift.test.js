import { describe, it, expect } from 'vitest';
import { headlineLift } from '../headlineLift';

const log = (...exercises) => ({ exercises });
const ex = (name, ...sets) => ({ name, sets: sets.map(([weight, reps, is_warmup]) => ({ weight, reps, is_warmup })) });

describe('headlineLift', () => {
  it('names a barbell lift over a heavier leg press', () => {
    const top = headlineLift([log(ex('Leg Press', [540, 10]), ex('Deadlift', [315, 3], [275, 5]))]);
    expect(top).toEqual({ name: 'Deadlift', weight: 315, reps: 3 });
  });

  it('reports the heaviest real set, not an estimate, and skips warmups', () => {
    const top = headlineLift([
      log(ex('Bench Press', [185, 8], [405, 1, true])),
      log(ex('Bench Press', [205, 5], [205, 6])),
    ]);
    expect(top).toEqual({ name: 'Bench Press', weight: 205, reps: 6 });
  });

  it('falls back to dumbbell lifts, then to anything', () => {
    expect(headlineLift([log(ex('Leg Press', [400, 8]), ex('Dumbbell Bench Press', [80, 8]))]).name).toBe('Dumbbell Bench Press');
    expect(headlineLift([log(ex('Leg Press', [400, 8]))]).name).toBe('Leg Press');
  });

  it('returns null with nothing lifted', () => {
    expect(headlineLift([])).toBeNull();
    expect(headlineLift([log(ex('Plank', [0, 1]))])).toBeNull();
  });
});
