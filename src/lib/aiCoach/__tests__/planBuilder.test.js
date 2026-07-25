import { describe, it, expect, vi, beforeEach } from 'vitest';

// generateWorkout (used by single-session builds) reads workout history.
vi.mock('@/api/db', () => ({
  db: {
    entities: {
      WorkoutLog: { filter: vi.fn(() => Promise.resolve([])) },
    },
  },
}));

import { parseWorkoutGoal, buildCoachPlan, sessionToPlan, GENERATE_PROMPTS } from '../planBuilder';
import { detectIntent, INTENTS } from '../intents';

beforeEach(() => vi.clearAllMocks());

describe('parseWorkoutGoal', () => {
  it('reads a faster-5K goal as a speed cardio plan', () => {
    const p = parseWorkoutGoal('I want to train for a faster 5k');
    expect(p.goal).toBe('speed');
    expect(p.event).toBe('5k');
    expect(p.wantsPlan).toBe(true);
  });

  it('reads "run a marathon" as an endurance plan', () => {
    const p = parseWorkoutGoal('help me train for my first marathon');
    expect(p.goal).toBe('endurance');
    expect(p.event).toBe('marathon');
    expect(p.wantsPlan).toBe(true);
  });

  it('distinguishes half marathon from marathon', () => {
    expect(parseWorkoutGoal('training for a half marathon').event).toBe('half');
  });

  it('reads "PR my bench" as a strength plan focused on Bench Press', () => {
    const p = parseWorkoutGoal('I want to PR my bench press');
    expect(p.goal).toBe('strength');
    expect(p.lift).toBe('Bench Press');
    expect(p.wantsPlan).toBe(true);
  });

  it('maps squat / deadlift / overhead lifts', () => {
    expect(parseWorkoutGoal('pr my squat').lift).toBe('Squat');
    expect(parseWorkoutGoal('increase my deadlift').lift).toBe('Deadlift');
    expect(parseWorkoutGoal('stronger overhead press').lift).toBe('Overhead Press');
  });

  it('reads "build muscle" as a muscle plan', () => {
    expect(parseWorkoutGoal('help me build muscle').goal).toBe('muscle');
  });

  it('reads "lose weight" as a fat-loss plan', () => {
    expect(parseWorkoutGoal('I need to lose weight').goal).toBe('lose');
  });

  it('treats "a quick workout today" as a single session, not a plan', () => {
    const p = parseWorkoutGoal('give me a quick full body workout today');
    expect(p.wantsPlan).toBe(false);
    expect(p.durationMinutes).toBe(30);
  });

  it('infers equipment and duration from the prompt', () => {
    const p = parseWorkoutGoal('dumbbells only workout for 30 minutes today');
    expect(p.equipment).toBe('dumbbells');
    expect(p.durationMinutes).toBe(30);
    expect(p.wantsPlan).toBe(false);
  });
});

describe('buildCoachPlan', () => {
  it('builds a coupled cardio+strength plan for a faster 5K', async () => {
    const { reply, plan } = await buildCoachPlan({ user: { email: 'a@b.com' }, message: 'train for a faster 5k' });
    expect(plan.kind).toBe('plan');
    const cardio = plan.exercises.filter((e) => e.kind === 'cardio');
    const strength = plan.exercises.filter((e) => e.kind !== 'cardio');
    expect(cardio.length).toBeGreaterThan(0);
    expect(strength.length).toBeGreaterThan(0);
    expect(plan.regimenPayload).toHaveProperty('exercises');
    expect(plan.regimenPayload.is_public).toBe(false);
    expect(reply).toMatch(/5K/i);
  });

  it('leads a bench-PR plan with Bench Press', async () => {
    const { plan } = await buildCoachPlan({ user: { email: 'a@b.com' }, message: 'help me PR my bench press' });
    expect(plan.kind).toBe('plan');
    const names = plan.exercises.map((e) => e.name);
    expect(names).toContain('Bench Press');
  });

  it('builds a single session with a Start-workout payload for a "today" ask', async () => {
    const { plan } = await buildCoachPlan({ user: { email: 'a@b.com' }, message: 'give me a workout today' });
    expect(plan.kind).toBe('session');
    expect(plan.workout).toBeTruthy();
    expect(Array.isArray(plan.workout.exercises)).toBe(true);
    expect(plan.exercises.every((e) => e.kind === 'strength')).toBe(true);
  });
});

describe('sessionToPlan', () => {
  it('normalizes a generateWorkout result into a saveable session plan', () => {
    const workout = {
      title: 'Full Body · 45 min',
      focus: 'full_body',
      duration_minutes: 45,
      exercises: [{ name: 'Bench Press', group: 'chest', sets: [{ weight: 135, reps: 8 }], restSec: 120 }],
    };
    const plan = sessionToPlan(workout);
    expect(plan.kind).toBe('session');
    expect(plan.regimenPayload.exercises[0]).toMatchObject({ name: 'Bench Press', target_sets: 1, target_reps: 8, target_weight: 135 });
    expect(plan.workout).toBe(workout);
  });
});

describe('GENERATE_PLAN intent routing', () => {
  const cases = [
    'train for a faster 5k',
    'help me PR my bench press',
    'build muscle',
    'lose weight',
    'make me a workout',
    'give me a plan to get stronger',
    'couch to 5k',
  ];
  it.each(cases)('routes "%s" to GENERATE_PLAN', (msg) => {
    expect(detectIntent(msg).id).toBe(INTENTS.GENERATE_PLAN);
  });

  it('does NOT hijack "what are my PRs?"', () => {
    expect(detectIntent('what are my prs?').id).toBe(INTENTS.PRS);
  });

  it('does NOT hijack "what should I train today?"', () => {
    expect(detectIntent('what should I train today?').id).toBe(INTENTS.WHAT_TO_TRAIN);
  });

  it('exposes generate prompts', () => {
    expect(GENERATE_PROMPTS.length).toBeGreaterThan(0);
    expect(GENERATE_PROMPTS[0]).toHaveProperty('text');
  });
});
