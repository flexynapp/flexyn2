// "Where do you train?" and "How long is a session?" (onboarding sharpen step).
//
// Before these questions existed every starter plan assumed a full gym and an
// open-ended session, while the loading screen claimed to be "Pairing
// exercises to equipment". These pin that the answers actually change the plan.
import { describe, it, expect } from 'vitest';
import { buildStarterRegimen, swapForEquipment, TRAINING_EQUIPMENT, SESSION_MINUTES } from '../starterRegimen';
import { EQUIPMENT_OPTIONS, DURATION_OPTIONS } from '@/lib/aiCoach/workoutGenerator';

const GYM_ONLY = ['Squat', 'Bench Press', 'Deadlift', 'Overhead Press', 'Barbell Row', 'Romanian Deadlift'];
const names = (r) => r.exercises.map(e => e.name);
const ALL_GOALS = [['strength'], ['muscle'], ['lose'], ['strength', 'muscle'], ['mobility'], ['speed']];

describe('starter plan: equipment', () => {
  it('uses the Coach picker ids, so the saved answer can seed it', () => {
    expect(TRAINING_EQUIPMENT).toEqual(EQUIPMENT_OPTIONS.map(o => o.id));
    expect(SESSION_MINUTES).toEqual(DURATION_OPTIONS.map(o => o.id));
  });

  it('unset and "gym" produce the plan every user got before', () => {
    for (const goals of ALL_GOALS) {
      const base = buildStarterRegimen({ goals, level: 'consistent', daysCount: 3 });
      expect(buildStarterRegimen({ goals, level: 'consistent', daysCount: 3, equipment: 'gym' })).toEqual(base);
    }
  });

  for (const kit of ['dumbbells', 'minimal', 'bodyweight']) {
    it(`${kit}: no barbell lift survives from the curated pools`, () => {
      for (const goals of ALL_GOALS) {
        const plan = names(buildStarterRegimen({ goals, level: 'consistent', daysCount: 4, equipment: kit }));
        for (const n of GYM_ONLY) expect(plan, `${goals} → ${n}`).not.toContain(n);
        expect(plan.length, `${goals}`).toBeGreaterThan(0);
      }
    });
  }

  it('bodyweight means no dumbbells either', () => {
    for (const goals of ALL_GOALS) {
      const plan = names(buildStarterRegimen({ goals, level: 'consistent', daysCount: 4, equipment: 'bodyweight' }));
      expect(plan.filter(n => /dumbbell|goblet/i.test(n)), `${goals}`).toEqual([]);
    }
  });

  it('a picked lift keeps its movement: a squat stays a squat', () => {
    expect(swapForEquipment('Squat', 'dumbbells')).toBe('Goblet Squat');
    expect(swapForEquipment('Squat', 'bodyweight')).toBe('Air Squat');
    const plan = names(buildStarterRegimen({ goals: ['strength'], daysCount: 3, equipment: 'bodyweight', strengthFocus: ['Squat'] }));
    expect(plan[0]).toBe('Air Squat');
  });

  it('a lift the user searched for by name is kept as asked', () => {
    const plan = names(buildStarterRegimen({ goals: ['strength'], daysCount: 3, equipment: 'bodyweight', strengthFocus: ['Hip Thrust'] }));
    expect(plan[0]).toBe('Hip Thrust');
  });

  it('swaps happen before the injury filter, so a substitute cannot load an injured region', () => {
    const plan = buildStarterRegimen({
      goals: ['strength'], daysCount: 3, equipment: 'bodyweight',
      injuries: [{ muscleGroup: 'Chest', severity: 'mild' }],
    });
    for (const e of plan.exercises) expect(e.muscle_groups, e.name).not.toContain('Chest');
  });
});

describe('starter plan: session length', () => {
  it('30 minutes is four exercises of at most three sets', () => {
    for (const goals of ALL_GOALS) {
      const r = buildStarterRegimen({ goals, level: 'advanced', daysCount: 2, sessionMinutes: 30 });
      const strength = r.exercises.filter(e => e.kind === 'strength');
      expect(strength.length, `${goals}`).toBeLessThanOrEqual(4);
      for (const e of strength) expect(e.target_sets).toBeLessThanOrEqual(3);
    }
  });

  it('a longer session never shrinks the plan', () => {
    for (const goals of ALL_GOALS) {
      const counts = [30, 45, 60, 90].map(m =>
        buildStarterRegimen({ goals, level: 'consistent', daysCount: 5, sessionMinutes: m }).exercises.length);
      expect([...counts].sort((a, b) => a - b), `${goals}`).toEqual(counts);
    }
  });

  it('says the length on the plan', () => {
    expect(buildStarterRegimen({ goals: ['strength'], daysCount: 3, sessionMinutes: 45 }).description).toContain('45 min');
  });
});
