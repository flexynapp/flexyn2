// src/lib/aiCoach/__tests__/injuryExclusion.test.js
//
// An injury the user reported has to change the session they are handed.
//
// Three of the eight body parts InjuryForm offers — Biceps, Triceps, Glutes —
// were inert for the whole life of the feature: `getExcludedMuscleGroups`
// emitted them correctly, `generateWorkout` tested only `ex.group`, and no
// catalog entry has ever carried those as its group (the six groups are
// legs / back / chest / arms / core / shoulders). So a logged biceps tear was
// still handed Barbell Curl. These tests are written against the ACTUAL
// generated exercise list rather than the exclusion set, because the set was
// always right — it was the consumer that never matched it.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/db', () => ({
  db: { entities: { WorkoutLog: { filter: vi.fn(() => Promise.resolve([])) } } },
}));

import { generateWorkout } from '../workoutGenerator';
import { getExcludedMuscleGroups } from '@/lib/data/injuries';

const USER = { email: 'a@b.c' };

/** Every exercise name in a generated session, lowercased. */
async function namesFor(opts) {
  const w = await generateWorkout({ user: USER, durationMinutes: 90, ...opts });
  return (w.exercises || []).map(e => e.name.toLowerCase());
}

beforeEach(() => vi.clearAllMocks());

describe('an injury removes the work that would load it', () => {
  it('programs curls for an uninjured arms session — the control', async () => {
    const names = await namesFor({ focus: 'arms' });
    expect(names.some(n => n.includes('curl'))).toBe(true);
  });

  it('drops curls for a biceps injury and keeps triceps work', async () => {
    const exclude = getExcludedMuscleGroups([{ muscle_group: 'Biceps', severity: 'moderate' }]);
    const names = await namesFor({ focus: 'arms', excludeMuscleGroups: exclude });

    expect(names.some(n => n.includes('curl'))).toBe(false);
    // The whole point of a finer part: a biceps strain must not cost the user
    // every arm movement. Something triceps still has to be programmable.
    expect(names.length).toBeGreaterThan(0);
    expect(names.some(n => n.includes('tricep') || n.includes('skull'))).toBe(true);
  });

  it('drops triceps work for a triceps injury and keeps curls', async () => {
    const exclude = getExcludedMuscleGroups([{ muscle_group: 'Triceps', severity: 'moderate' }]);
    const names = await namesFor({ focus: 'arms', excludeMuscleGroups: exclude });

    expect(names.some(n => n.includes('tricep') || n.includes('skull'))).toBe(false);
    expect(names.some(n => n.includes('curl'))).toBe(true);
  });

  it('drops the glute-dominant hinges for a glutes injury, not the whole leg day', async () => {
    const exclude = getExcludedMuscleGroups([{ muscle_group: 'Glutes', severity: 'moderate' }]);
    const names = await namesFor({ focus: 'legs', excludeMuscleGroups: exclude });

    expect(names.some(n => n.includes('romanian') || n.includes('lunge'))).toBe(false);
    expect(names.length).toBeGreaterThan(0);
  });

  it('drops curls for a SERIOUS back injury, via the synergist map', async () => {
    // back → biceps is already in SYNERGISTS. It resolved to a set entry that
    // matched no exercise, so a serious back injury still programmed curls.
    const exclude = getExcludedMuscleGroups([{ muscle_group: 'Back', severity: 'serious' }]);
    expect(exclude.has('biceps')).toBe(true);

    const names = await namesFor({ focus: 'pull', excludeMuscleGroups: exclude });
    expect(names.some(n => n.includes('curl'))).toBe(false);
    expect(names.some(n => n.includes('row') || n.includes('pulldown') || n.includes('pull-up'))).toBe(false);
  });

  it('drops triceps work for a SERIOUS shoulder injury', async () => {
    const exclude = getExcludedMuscleGroups([{ muscle_group: 'Shoulders', severity: 'serious' }]);
    const names = await namesFor({ focus: 'push', excludeMuscleGroups: exclude });

    expect(names.some(n => n.includes('overhead') || n.includes('shoulder press') || n.includes('lateral'))).toBe(false);
    expect(names.some(n => n.includes('tricep') || n.includes('skull'))).toBe(false);
    // chest is the other synergist, so a serious shoulder leaves push with
    // very little — that is the correct outcome, not an empty session.
    expect(names.some(n => n.includes('bench') || n.includes('push-up'))).toBe(false);
  });

  it('leaves an uninjured user with everything', async () => {
    const exclude = getExcludedMuscleGroups([]);
    const names = await namesFor({ focus: 'full_body', excludeMuscleGroups: exclude });
    expect(names.length).toBeGreaterThanOrEqual(4);
  });
});
