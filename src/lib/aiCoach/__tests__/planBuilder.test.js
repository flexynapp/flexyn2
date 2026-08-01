import { describe, it, expect, vi, beforeEach } from 'vitest';

// generateWorkout (used by single-session builds) reads workout history.
vi.mock('@/api/db', () => ({
  db: {
    entities: {
      WorkoutLog: { filter: vi.fn(() => Promise.resolve([])) },
    },
  },
}));

import { parseWorkoutGoal, buildCoachPlan, sessionToPlan, buildCardioSession, buildHiitSession, CARDIO_STYLES, GENERATE_PROMPTS, competeSessionShape } from '../planBuilder';
import { getMaxRealisticSetsPerWorkout, sumWorkoutVolume } from '@/lib/workoutFatigue';
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

describe('running paces in faster-5K plans', () => {
  it('parses a current 5K time and a stated goal from the message', () => {
    const p = parseWorkoutGoal('train for a faster 5k, I run 24:30 now, want sub 23');
    expect(p.current5kSec).toBe(24 * 60 + 30);
    expect(p.goalFiveKSec).toBe(23 * 60);
  });

  it('embeds real per-mile / per-rep paces in the cardio sessions', async () => {
    const { reply, plan } = await buildCoachPlan({ user: { email: 'a@b.com' }, message: 'train for a faster 5k, I run 24:30' });
    const cardio = plan.exercises.filter((e) => e.kind === 'cardio');
    const easy = cardio.find((e) => e.displayName === 'Easy Run');
    const interval = cardio.find((e) => e.displayName === 'Interval Run');
    expect(easy.detail).toMatch(/@ \d+:\d\d\/mi/);            // paced easy run
    expect(interval.detail).toMatch(/× 400 m @ \d+:\d\d\/rep/); // paced 400m reps
    expect(reply).toMatch(/🎯 Goal: sub-\d+:\d\d 5K/);
    expect(reply).toMatch(/\/400m/);
  });

  it('falls back to an estimated 5K and says so when no time is given', async () => {
    const { reply } = await buildCoachPlan({ user: { email: 'a@b.com' }, message: 'train for a faster 5k' });
    expect(reply).toMatch(/Paces assume a ~28:00 5K/);
  });
});

describe('buildCardioSession (Quick-pick Cardio)', () => {
  it('exposes cardio styles', () => {
    expect(CARDIO_STYLES.map((s) => s.id)).toEqual(['easy', 'intervals', 'tempo', 'long']);
  });

  it('builds a Save-only cardio session (no strength handoff)', () => {
    const plan = buildCardioSession({ style: 'intervals', durationMinutes: 45, skillLevel: 'intermediate' });
    expect(plan.kind).toBe('session');
    expect(plan.cardio).toBe(true);
    expect(plan.workout).toBeNull(); // → CoachPlanCard hides "Start workout"
    expect(plan.exercises[0].kind).toBe('cardio');
    expect(plan.exercises[0].detail).toMatch(/400 m/);
    expect(plan.regimenPayload.exercises[0].kind).toBe('cardio');
  });

  it('encodes distance for a long run and duration for an easy run', () => {
    expect(buildCardioSession({ style: 'long', durationMinutes: 60 }).exercises[0].target_distance_m).toBeGreaterThan(0);
    expect(buildCardioSession({ style: 'easy', durationMinutes: 40 }).exercises[0].target_duration_s).toBe(40 * 60);
  });
});

describe('buildHiitSession (Quick-pick HIIT)', () => {
  it('builds a startable circuit with minimal rest', async () => {
    const plan = await buildHiitSession({ user: { email: 'a@b.com' }, durationMinutes: 30, equipment: 'bodyweight' });
    expect(plan.kind).toBe('session');
    expect(plan.workout).toBeTruthy();       // → Start workout available
    expect(plan.title).toMatch(/HIIT/i);
    expect(plan.workout.exercises.every((e) => e.restSec === 30)).toBe(true);
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

describe('competition mode (rival / crew war point-max session)', () => {
  it('leads the generate prompts with the war-points pill', () => {
    // It must be reachable without scrolling the horizontal prompt strip.
    expect(GENERATE_PROMPTS[0].id).toBe('war_points');
  });

  it('routes its own pill text to a point-max session', () => {
    const { text } = GENERATE_PROMPTS[0];
    expect(detectIntent(text).id).toBe(INTENTS.GENERATE_PLAN);
    const p = parseWorkoutGoal(text);
    expect(p.goal).toBe('compete');
    expect(p.wantsPlan).toBe(false);   // points are scored per logged session
    expect(p.focus).toBe('full_body');
  });

  it.each([
    'most points for my crew war',
    'what workout scores the most points against my rival',
    'help me beat my rival this week',
    'give me a workout to crush my crew war opponent',
  ])('reads "%s" as compete', (msg) => {
    expect(parseWorkoutGoal(msg).goal).toBe('compete');
  });

  it('does not hijack ordinary strength or muscle asks', () => {
    expect(parseWorkoutGoal('I want to PR my bench press').goal).toBe('strength');
    expect(parseWorkoutGoal('build muscle — upper body').goal).toBe('muscle');
  });

  it('sizes the session under the plausibility ceiling', () => {
    // 25 sets is the default adult ceiling; 5×5 is the densest shape that fits.
    const shape = competeSessionShape(25);
    expect(shape.totalSets).toBeLessThanOrEqual(25);
    expect(shape.totalSets).toBe(25);
    // A smaller ceiling must produce a smaller session, never an over-cap one.
    for (const ceiling of [21, 17, 12, 8, 5]) {
      const s = competeSessionShape(ceiling);
      expect(s.exCount * s.setCount).toBe(s.totalSets);
      if (ceiling >= 8) expect(s.totalSets).toBeLessThanOrEqual(ceiling);
      expect(s.setCount).toBeGreaterThanOrEqual(2);
      expect(s.setCount).toBeLessThanOrEqual(5);
    }
  });

  it('builds a session that the anti-cheat set ceiling would accept', async () => {
    const profile = { weight_lbs: 190, gender: 'male', birthday: '1995-01-01' };
    const { reply, plan } = await buildCoachPlan({
      user: { email: 'a@b.c' },
      message: GENERATE_PROMPTS[0].text,
      profile,
    });
    expect(plan.kind).toBe('session');
    expect(plan.goal).toBe('compete');

    const totalSets = plan.workout.exercises.reduce((n, ex) => n + ex.sets.length, 0);
    expect(totalSets).toBeLessThanOrEqual(getMaxRealisticSetsPerWorkout(profile));

    // Tonnage is the scored quantity, so it has to be non-zero and quoted.
    expect(sumWorkoutVolume(plan.workout.exercises)).toBeGreaterThan(0);
    expect(reply).toMatch(/Crew war/);
    expect(reply).toMatch(/Gym rival/);
    expect(reply).toMatch(/cardio/i);   // cardio rivals score km, not tonnage
  });

  it('out-lifts the ordinary session it would otherwise have gotten', async () => {
    const profile = { weight_lbs: 190, gender: 'male', birthday: '1995-01-01' };
    const [war, plain] = await Promise.all([
      buildCoachPlan({ user: { email: 'a@b.c' }, message: GENERATE_PROMPTS[0].text, profile }),
      buildCoachPlan({ user: { email: 'a@b.c' }, message: 'give me a quick full-body workout today', profile }),
    ]);
    expect(sumWorkoutVolume(war.plan.workout.exercises))
      .toBeGreaterThan(sumWorkoutVolume(plain.plan.workout.exercises));
  });
});
