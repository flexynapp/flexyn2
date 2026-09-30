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

describe('Rule E counts this session\'s unsaved runs', () => {
  const profile = { age: 30, gender: 'male', weight_lbs: 180 };
  const run = (o) => ({ kind: 'cardio', name: 'Run', segments: [{ duration_s: 5 * 3600, distance_m: 40000 }], ...o });

  it('lets an honest five hour run inside a workout save', () => {
    // A marathon typed into a workout is cardio, not five hours of lifting.
    const workout = { date: '2026-09-28', duration_min: 30, exercises: [run()] };
    expect(detectImplausibleWorkout(workout, profile, [], []).implausible).toBe(false);
  });

  it('counts an unsaved run against the daily cardio limit', () => {
    // 10 h already logged in Cardio today plus a 5 h run here is 15 h of cardio.
    const saved = [{ id: 'c0', date: '2026-09-28', duration_seconds: 10 * 3600 }];
    const workout = { date: '2026-09-28', duration_min: 30, exercises: [run()] };
    expect(detectImplausibleWorkout(workout, profile, [], saved)).toMatchObject({
      implausible: true, i18nKey: 'workout.warn.cardio_hours',
    });
  });

  it('keeps the lifting side of a session that also holds a run', () => {
    // 5 h stated with a 30 min run leaves 4.5 h of lifting, over the 4 h cap.
    const lift = { name: 'Bench Press', sets: [{ weight: 135, reps: 5 }] };
    const workout = { date: '2026-09-28', duration_min: 300, exercises: [lift, run({ segments: [{ duration_s: 1800 }] })] };
    expect(detectImplausibleWorkout(workout, profile, [], [])).toMatchObject({
      implausible: true, i18nKey: 'workout.warn.workout_hours',
    });
  });

  it('leaves a run that is already saved to the cardio log side', () => {
    const workout = { date: '2026-09-28', duration_min: 30, exercises: [run({ cardio_log_id: 'c1' })] };
    expect(detectImplausibleWorkout(workout, profile, [], []).implausible).toBe(false);
  });

  it('passes a short unsaved run', () => {
    const workout = { date: '2026-09-28', duration_min: 30, exercises: [run({ segments: [{ duration_s: 1800 }] })] };
    expect(detectImplausibleWorkout(workout, profile, [], []).implausible).toBe(false);
  });
});
