import { describe, it, expect, vi, beforeEach } from 'vitest';

// Staged workout history — this is the "data behind the answer", so the tests
// are about whether what the panel claims matches what was actually read.
const logs = { value: [] };
vi.mock('@/api/db', () => ({
  db: { entities: { WorkoutLog: { filter: vi.fn(() => Promise.resolve(logs.value)) } } },
}));

import { generateWorkout } from '../workoutGenerator';
import { buildCoachPlan, withEditedWorkout, evidenceForExercises } from '../planBuilder';

const PROFILE = { weight_lbs: 190, gender: 'male', birthday: '1995-01-01' };
const USER = { id: 'u1', email: 'a@b.c' };

/** A log that gives Bench Press a real top set the generator can seed from. */
const benchLog = (date = '2026-07-30') => ({
  date,
  exercises: [{ name: 'Bench Press', sets: [{ weight: 185, reps: 5 }, { weight: 175, reps: 8 }] }],
});

beforeEach(() => { logs.value = []; vi.clearAllMocks(); });

describe('evidence reports what was actually read', () => {
  it('reports zero logs when the user has none', async () => {
    const w = await generateWorkout({ user: USER });
    expect(w.evidence.logsRead).toBe(0);
    expect(w.evidence.latestLogDate).toBeNull();
    expect(evidenceForExercises(w.exercises).seededFromHistory).toEqual([]);
  });

  it('counts only logs inside the history window', async () => {
    // One recent, one two years old. Claiming 2 would be a false statement
    // about data the generator never used.
    logs.value = [benchLog('2026-07-30'), benchLog('2024-01-01')];
    const w = await generateWorkout({ user: USER });
    expect(w.evidence.logsRead).toBe(1);
    expect(w.evidence.latestLogDate).toBe('2026-07-30');
    expect(w.evidence.historyWindowDays).toBe(60);
  });

  it('names the lift and the actual set it seeded from, so the claim is checkable', async () => {
    logs.value = [benchLog()];
    const w = await generateWorkout({ user: USER, focus: 'upper' });
    const { seededFromHistory } = evidenceForExercises(w.exercises);
    expect(seededFromHistory).toContainEqual({ name: 'Bench Press', weight: 185, reps: 5 });
  });

  it('does not claim history for a lift it estimated', async () => {
    logs.value = [benchLog()];
    const w = await generateWorkout({ user: USER, focus: 'upper' });
    const { seededFromHistory } = evidenceForExercises(w.exercises);
    const claimed = seededFromHistory.map(s => s.name);
    for (const name of claimed) {
      // Every claimed lift must be one the staged log actually contains.
      expect(name).toBe('Bench Press');
    }
  });

  it('classifies every exercise as history, estimate or bodyweight', async () => {
    logs.value = [benchLog()];
    const w = await generateWorkout({ user: USER });
    for (const ex of w.exercises) {
      expect(['history', 'estimate', 'bodyweight']).toContain(ex.seededFrom);
    }
    const e = evidenceForExercises(w.exercises);
    expect(e.seededFromHistory.length + e.estimatedCount + e.bodyweightCount)
      .toBe(w.exercises.length);
  });

  it('records the inputs the user can go change', async () => {
    const w = await generateWorkout({
      user: USER, equipment: 'dumbbells', skillLevel: 'beginner', bodyweightLbs: 190,
      demographics: { gender: 'male', age: 31, activityLevel: 'moderate' },
      excludeMuscleGroups: new Set(['chest']),
    });
    expect(w.evidence).toMatchObject({
      equipment: 'dumbbells',
      skillLevel: 'beginner',
      bodyweightLbs: 190,
      demographics: { gender: 'male', age: 31, activityLevel: 'moderate' },
      excludedGroups: ['chest'],
    });
  });

  it('rides along on the plan the chat renders', async () => {
    logs.value = [benchLog()];
    const { plan } = await buildCoachPlan({ user: USER, message: 'give me a workout today', profile: PROFILE });
    expect(plan.evidence).toBeTruthy();
    expect(plan.evidence.logsRead).toBe(1);
  });

  it('keeps the history map iterable — _meta is not a lift', async () => {
    logs.value = [benchLog()];
    const w = await generateWorkout({ user: USER });
    expect(w.exercises.some(ex => ex.name === '_meta')).toBe(false);
  });
});

// The panel is derived from the live exercise list precisely so that editing
// the session in the chat card can't leave it describing a different workout.
describe('evidence stays true after the session is edited', () => {
  it('stops citing a lift the user removed', async () => {
    logs.value = [benchLog()];
    const w = await generateWorkout({ user: USER, focus: 'upper' });
    expect(evidenceForExercises(w.exercises).seededFromHistory.map(s => s.name)).toContain('Bench Press');

    const without = w.exercises.filter(ex => ex.name !== 'Bench Press');
    expect(evidenceForExercises(without).seededFromHistory.map(s => s.name)).not.toContain('Bench Press');
  });

  it('recounts after a swap rather than reporting the original mix', async () => {
    logs.value = [benchLog()];
    const w = await generateWorkout({ user: USER, focus: 'upper' });
    const before = evidenceForExercises(w.exercises);

    const bench = w.exercises.find(ex => ex.name === 'Bench Press');
    const alt = bench?.alternatives?.[0];
    expect(alt).toBeTruthy();
    const swapped = w.exercises.map(ex => (ex.name === 'Bench Press' ? alt : ex));
    const after = evidenceForExercises(swapped);

    expect(after.seededFromHistory.map(s => s.name)).not.toContain('Bench Press');
    expect(after.seededFromHistory.length + after.estimatedCount + after.bodyweightCount)
      .toBe(swapped.length);
    expect(after).not.toEqual(before);
  });

  it('survives withEditedWorkout with the read-level facts intact', async () => {
    logs.value = [benchLog()];
    const { plan } = await buildCoachPlan({ user: USER, message: 'give me a workout today', profile: PROFILE });
    const trimmed = { ...plan.workout, exercises: plan.workout.exercises.slice(0, 1) };
    const next = withEditedWorkout(plan, trimmed);

    // How many logs were read doesn't change when the user drops an exercise.
    expect(next.evidence.logsRead).toBe(1);
    // But the per-exercise breakdown must describe the session as it now is.
    expect(evidenceForExercises(next.workout.exercises).seededFromHistory.length
         + evidenceForExercises(next.workout.exercises).estimatedCount
         + evidenceForExercises(next.workout.exercises).bodyweightCount).toBe(1);
  });
});
