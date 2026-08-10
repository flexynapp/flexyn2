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

import { generateWorkout, injuryImpact } from '../workoutGenerator';
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

// ── What the screen is allowed to claim ──────────────────────────────────────
//
// The Injuries list states "N exercises are out of your sessions" and the
// post-log screen names them. Both read `injuryImpact`, which walks the SAME
// catalog and applies the SAME group/part test `generateWorkout` filters on —
// so the count on screen cannot drift from the number of lifts actually
// withheld. These tests exist to keep that true: they check the claim against
// generated sessions rather than against a hardcoded number.

describe('injuryImpact — the cost the UI is allowed to state', () => {
  it('claims nothing for an uninjured user', () => {
    const r = injuryImpact(getExcludedMuscleGroups([]));
    expect(r.removedCount).toBe(0);
    expect(r.removed).toEqual([]);
    expect(r.remainingGroups.length).toBe(6);
  });

  it('every exercise it reports as removed is genuinely unreachable', async () => {
    // The claim under test: nothing named "out" can appear in a generated
    // session. Checked against the generator itself across every focus, so a
    // divergence between the two filters fails here rather than on a user's
    // screen.
    const exclude = getExcludedMuscleGroups([{ muscle_group: 'Shoulders', severity: 'serious' }]);
    const removed = new Set(injuryImpact(exclude).removed.map(n => n.toLowerCase()));
    expect(removed.size).toBeGreaterThan(0);

    for (const focus of ['full_body', 'upper', 'push', 'pull', 'legs', 'arms', 'core']) {
      const names = await namesFor({ focus, excludeMuscleGroups: exclude });
      for (const n of names) {
        expect(removed.has(n), `${n} was reported as removed but got programmed`).toBe(false);
      }
    }
  });

  it('reports the sub-group parts, not just whole groups', () => {
    // A biceps injury costs the three curls and nothing else. Before the
    // `part` field existed this was zero — the number would have been a lie in
    // the most reassuring direction.
    const r = injuryImpact(getExcludedMuscleGroups([{ muscle_group: 'Biceps', severity: 'moderate' }]));
    expect(r.removedCount).toBe(3);
    expect(r.removed.every(n => n.toLowerCase().includes('curl'))).toBe(true);
  });

  it('a serious injury costs more than a moderate one of the same area', () => {
    const moderate = injuryImpact(getExcludedMuscleGroups([{ muscle_group: 'Shoulders', severity: 'moderate' }]));
    const serious  = injuryImpact(getExcludedMuscleGroups([{ muscle_group: 'Shoulders', severity: 'serious' }]));
    expect(serious.removedCount).toBeGreaterThan(moderate.removedCount);
  });

  it('accepts an array as well as the Set the app passes', () => {
    expect(injuryImpact(['legs']).removedCount)
      .toBe(injuryImpact(new Set(['legs'])).removedCount);
  });

  it('never reports a group as both removed and remaining', () => {
    const r = injuryImpact(getExcludedMuscleGroups([{ muscle_group: 'Legs', severity: 'mild' }]));
    expect(r.remainingGroups).not.toContain('legs');
    expect(r.removedCount + injuryImpact(new Set()).catalogSize - r.catalogSize).toBe(r.removedCount);
  });
});
