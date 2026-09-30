import { describe, it, expect } from 'vitest';
import { headlineLift, topLifts } from '../headlineLift';

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

describe('topLifts', () => {
  it('lists barbell lifts by heaviest set before a heavier leg press', () => {
    const top = topLifts([log(
      ex('Leg Press', [540, 10]),
      ex('Bench Press', [185, 5]),
      ex('Deadlift', [315, 3]),
      ex('Dumbbell Row', [90, 8]),
    )]);
    expect(top.map((l) => l.name)).toEqual(['Deadlift', 'Bench Press', 'Dumbbell Row']);
    expect(top[0]).toMatchObject({ weight: 315, reps: 3 });
  });

  it('fills with other lifts when there are fewer than three free-weight lifts', () => {
    const top = topLifts([log(ex('Leg Press', [540, 10]), ex('Squat', [225, 5]))]);
    expect(top.map((l) => l.name)).toEqual(['Squat', 'Leg Press']);
  });

  it('starts with the same lift headlineLift names', () => {
    const logs = [log(ex('Leg Press', [600, 8]), ex('Dumbbell Bench Press', [90, 8]), ex('Overhead Press', [115, 5]))];
    expect(topLifts(logs)[0].name).toBe(headlineLift(logs).name);
  });
});
