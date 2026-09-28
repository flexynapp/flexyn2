// The plausibility ceilings in workoutFatigue.js read the lifter's age. They
// used to read only `birthday`, which onboarding never writes (0 of 112
// production profiles on 2026-09-28), so everyone was scored as 36. These
// pin that the `age` column counts, and that an unknown age still gets 36.
import { describe, it, expect } from 'vitest';
import {
  getMaxRealisticSetsPerWorkout,
  getMaxSetsPerExercise,
  getDailyVolumeBudget,
  detectImplausibleWorkout,
} from '../workoutFatigue';

const sets = (n) => Array.from({ length: n }, () => ({ weight: 50, reps: 8 }));

describe('workoutFatigue reads the age column', () => {
  it('scores a 26 year old by their age, not as 36', () => {
    expect(getMaxRealisticSetsPerWorkout({ age: 26, gender: 'male' })).toBe(25);
    expect(getMaxRealisticSetsPerWorkout({ gender: 'male' })).toBe(21);
  });

  it('applies the older-lifter curves when age says so', () => {
    expect(getMaxRealisticSetsPerWorkout({ age: 60, gender: 'male' })).toBe(17);
    expect(getMaxSetsPerExercise({ age: 60 })).toBe(4);
    expect(getDailyVolumeBudget({ age: 60, weight_lbs: 200 })).toBe(30000);
  });

  it('still prefers a birthday when one exists', () => {
    const y = new Date().getFullYear() - 60;
    expect(getMaxRealisticSetsPerWorkout({ birthday: `${y}-01-01`, age: 26 })).toBe(17);
  });

  it('lets a 26 year old save the 25 set session a 36 year old could not', () => {
    const workout = { date: '2026-09-28', exercises: Array.from({ length: 5 }, (_, i) => ({ name: `Lift ${i}`, sets: sets(5) })) };
    expect(detectImplausibleWorkout(workout, { age: 26, gender: 'male', weight_lbs: 165 }, []).implausible).toBe(false);
    expect(detectImplausibleWorkout(workout, { gender: 'male', weight_lbs: 165 }, []).implausible).toBe(true);
  });
});
