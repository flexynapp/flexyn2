// A starter plan finished exactly as written must be saveable. The Workout
// page refuses a session over getMaxRealisticSetsPerWorkout (rule A of
// detectImplausibleWorkout), and the generator used to ignore it: a
// consistent lifter on one day a week got 5 x 5 = 25 sets against a ceiling
// of 21 for a woman.
import { describe, it, expect } from 'vitest';
import { buildStarterRegimen } from '../starterRegimen';
import { detectImplausibleWorkout, getMaxRealisticSetsPerWorkout } from '@/lib/workoutFatigue';

const GOALS = [['strength'], ['muscle'], ['lose'], ['speed'], ['endurance'], ['mobility'], ['strength', 'endurance'], ['lose', 'mobility', 'muscle']];
const LEVELS = ['newbie', 'returning', 'consistent', 'advanced'];
const DAYS = [1, 2, 3, 4, 5, 6];
const PEOPLE = [
  { gender: 'female', age: 26, weightKg: 60 },
  { gender: 'male', age: 26, weightKg: 75 },
  { gender: 'female', age: 45, weightKg: 42 },
  { gender: 'male', age: 60, weightKg: 150 },
  { gender: 'other' },
];

const planSets = (plan) => plan.exercises.reduce((n, e) => n + (e.target_sets || 0), 0);

describe('starter plan fits the save check', () => {
  it('never prescribes more sets than the lifter may save', () => {
    for (const person of PEOPLE) {
      const ceiling = getMaxRealisticSetsPerWorkout({
        age: person.age,
        gender: person.gender,
        weight_lbs: person.weightKg ? person.weightKg * 2.20462 : undefined,
      });
      for (const goals of GOALS) for (const level of LEVELS) for (const daysCount of DAYS) {
        const plan = buildStarterRegimen({ goals, level, daysCount, ...person });
        const label = JSON.stringify({ person, goals, level, daysCount });
        expect(planSets(plan), label).toBeLessThanOrEqual(ceiling);
        // The whole save check, not just the total: per exercise and per muscle group too.
        const workout = {
          date: '2026-09-28',
          exercises: plan.exercises.map((e) => ({
            name: e.name,
            muscle_groups: e.muscle_groups,
            sets: Array.from({ length: e.target_sets }, () => ({ weight: 20, reps: e.target_reps })),
          })),
        };
        const profile = { age: person.age, gender: person.gender, weight_lbs: person.weightKg ? person.weightKg * 2.20462 : undefined };
        expect(detectImplausibleWorkout(workout, profile, []), label).toMatchObject({ implausible: false });
      }
    }
  });

  it('the exact case from production: consistent, lose fat, one day, female', () => {
    const plan = buildStarterRegimen({ goals: ['lose'], level: 'consistent', daysCount: 1, gender: 'female', age: 26, weightKg: 60 });
    const workout = {
      date: '2026-09-28',
      exercises: plan.exercises.map((e) => ({
        name: e.name,
        sets: Array.from({ length: e.target_sets }, () => ({ weight: 20, reps: e.target_reps })),
      })),
    };
    expect(detectImplausibleWorkout(workout, { age: 26, gender: 'female', weight_lbs: 132 }, []).implausible).toBe(false);
  });

  it('leaves plans already under the ceiling alone', () => {
    const plan = buildStarterRegimen({ goals: ['strength'], level: 'newbie', daysCount: 3, gender: 'male', age: 26 });
    expect(plan.exercises.every((e) => e.kind !== 'strength' || e.target_sets === 3)).toBe(true);
  });
});
