import { describe, it, expect, vi, beforeEach } from 'vitest';

// generateWorkout reads recent history to seed weights.
const filter = vi.fn(() => Promise.resolve([]));
vi.mock('@/api/db', () => ({ db: { entities: { WorkoutLog: { filter: (...a) => filter(...a) } } } }));

import { generateWorkout } from '../workoutGenerator';
import { withEditedWorkout } from '../planBuilder';

beforeEach(() => {
  vi.clearAllMocks();
  filter.mockResolvedValue([]);
});

const gen = (opts = {}) => generateWorkout({ user: { email: 'a@b.c' }, ...opts });

describe('swap candidates on a generated session', () => {
  it('attaches alternatives to every exercise', async () => {
    const w = await gen();
    expect(w.exercises.length).toBeGreaterThan(0);
    for (const ex of w.exercises) {
      expect(Array.isArray(ex.alternatives)).toBe(true);
    }
    // At least some exercise has somewhere to go, or the feature is inert.
    expect(w.exercises.some(ex => ex.alternatives.length > 0)).toBe(true);
  });

  it('only ever offers the same muscle group', async () => {
    // Swapping the leg movement for a curl would silently change what the
    // session trains, which is not a swap — it's a different workout.
    const w = await gen();
    for (const ex of w.exercises) {
      for (const alt of ex.alternatives) expect(alt.group).toBe(ex.group);
    }
  });

  it('never offers an exercise already in the session', async () => {
    const w = await gen();
    const chosen = new Set(w.exercises.map(e => e.name));
    for (const ex of w.exercises) {
      for (const alt of ex.alternatives) expect(chosen.has(alt.name)).toBe(false);
    }
  });

  it('caps the list so the whole session still fits in a chat message', async () => {
    const w = await gen({ durationMinutes: 90 });
    for (const ex of w.exercises) expect(ex.alternatives.length).toBeLessThanOrEqual(3);
  });

  it('builds candidates in the same shape as a chosen exercise', async () => {
    // They get swapped straight into the session, so anything the logger or
    // the regimen payload reads has to already be there.
    const w = await gen();
    const alt = w.exercises.flatMap(e => e.alternatives)[0];
    expect(alt).toMatchObject({
      name: expect.any(String),
      group: expect.any(String),
      restSec: expect.any(Number),
      note: expect.any(String),
    });
    expect(alt.sets.length).toBeGreaterThan(0);
    expect(alt.sets[0]).toHaveProperty('reps');
    expect(alt.sets[0]).toHaveProperty('weight');
  });

  it('honours the equipment filter — a bodyweight session offers no barbells', async () => {
    const w = await gen({ equipment: 'bodyweight' });
    const gymOnly = ['Bench Press', 'Back Squat', 'Barbell Row', 'Deadlift', 'Lat Pulldown'];
    for (const ex of w.exercises) {
      for (const alt of ex.alternatives) expect(gymOnly).not.toContain(alt.name);
    }
  });

  it('honours the injury exclusions', async () => {
    const w = await gen({ excludeMuscleGroups: new Set(['chest']) });
    for (const ex of w.exercises) {
      expect(ex.group).not.toBe('chest');
      for (const alt of ex.alternatives) expect(alt.group).not.toBe('chest');
    }
  });

  it('applies the same modifier nudges the session got', async () => {
    // A candidate built by a parallel code path would drift from the session
    // it's offered inside — an extra set here, an un-nudged load there.
    const w = await gen({ modifiers: { setsDelta: 1, repDelta: 2, restDeltaSec: 0, loadMultiplier: 1, notes: [], applied: {} } });
    const setCounts = new Set(w.exercises.flatMap(e => [e.sets.length, ...e.alternatives.map(a => a.sets.length)]));
    expect([...setCounts]).toEqual([4]); // 3 + setsDelta, for chosen AND candidates
  });
});

describe('withEditedWorkout', () => {
  const basePlan = (workout) => ({
    kind: 'session',
    title: workout.title,
    subtitle: 'stale',
    exercises: [],
    regimenPayload: { name: 'stale', exercises: [] },
    workout,
    goal: 'compete',
    label: 'out-score your rival',
    parsed: { goal: 'compete', equipment: 'gym', durationMinutes: 90 },
    coachNotes: ['a note'],
  });

  it('re-derives all three representations from the edited workout', async () => {
    const w = await gen();
    const dropped = { ...w, exercises: w.exercises.slice(0, 2) };
    const next = withEditedWorkout(basePlan(w), dropped);

    expect(next.workout.exercises).toHaveLength(2);
    expect(next.exercises).toHaveLength(2);              // view rows
    expect(next.regimenPayload.exercises).toHaveLength(2); // what Save persists
    expect(next.subtitle).toContain('2 exercises');
  });

  it('keeps the three representations naming the same exercises', async () => {
    // The failure this guards is silent: start a workout that doesn't match
    // the card you were just reading.
    const w = await gen();
    const swapped = {
      ...w,
      exercises: [{ ...w.exercises[0].alternatives[0] }, ...w.exercises.slice(1)],
    };
    const next = withEditedWorkout(basePlan(w), swapped);
    const fromWorkout = next.workout.exercises.map(e => e.name);
    expect(next.exercises.map(e => e.name)).toEqual(fromWorkout);
    expect(next.regimenPayload.exercises.map(e => e.name)).toEqual(fromWorkout);
  });

  it('carries the request through untouched — an edit is not a new goal', async () => {
    const w = await gen();
    const next = withEditedWorkout(basePlan(w), { ...w, exercises: w.exercises.slice(0, 1) });
    expect(next.goal).toBe('compete');
    expect(next.label).toBe('out-score your rival');
    expect(next.parsed).toEqual({ goal: 'compete', equipment: 'gym', durationMinutes: 90 });
    expect(next.coachNotes).toEqual(['a note']);
    expect(next.kind).toBe('session');
  });

  it('marks the plan as edited', async () => {
    const w = await gen();
    expect(withEditedWorkout(basePlan(w), w).edited).toBe(true);
  });

  it('carries set-count edits into the saved regimen', async () => {
    const w = await gen();
    const ex = w.exercises[0];
    const bumped = {
      ...w,
      exercises: [{ ...ex, sets: [...ex.sets, { ...ex.sets[0] }] }, ...w.exercises.slice(1)],
    };
    const next = withEditedWorkout(basePlan(w), bumped);
    expect(next.regimenPayload.exercises[0].target_sets).toBe(ex.sets.length + 1);
  });
});
