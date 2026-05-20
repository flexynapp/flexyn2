import { describe, it, expect } from 'vitest';
import { buildStarterRegimen } from '../starterRegimen';
import { EXERCISE_LIBRARY } from '@/components/regimens/ExerciseAutocomplete';

const LIBRARY_NAMES = new Set(EXERCISE_LIBRARY.map(e => e.name));

describe('buildStarterRegimen — output shape', () => {
  it('returns the RegimenForm submission shape', () => {
    const r = buildStarterRegimen({ goals: ['strength'], level: 'consistent', daysCount: 4 });
    expect(r).toMatchObject({
      name: expect.any(String),
      description: expect.any(String),
      exercises: expect.any(Array),
      is_public: false,
    });
    for (const ex of r.exercises) {
      expect(ex).toMatchObject({
        name: expect.any(String),
        displayName: expect.any(String),
        muscle_groups: expect.any(Array),
        muscle_group: expect.any(String),
        target_sets: expect.any(Number),
        target_reps: expect.any(Number),
        notes: expect.any(String),
      });
    }
  });

  it('every exercise name resolves to an entry in EXERCISE_LIBRARY', () => {
    const goals = ['strength', 'muscle', 'lose', 'endurance', 'mobility'];
    for (const g of goals) {
      const r = buildStarterRegimen({ goals: [g], level: 'consistent', daysCount: 3 });
      for (const ex of r.exercises) {
        expect(LIBRARY_NAMES.has(ex.name)).toBe(true);
      }
    }
  });

  it('muscle_groups always non-empty (matches RegimenForm validation)', () => {
    const r = buildStarterRegimen({ goals: ['muscle'], level: 'newbie', daysCount: 3 });
    for (const ex of r.exercises) {
      expect(Array.isArray(ex.muscle_groups)).toBe(true);
      expect(ex.muscle_groups.length).toBeGreaterThan(0);
      expect(ex.muscle_group).toBe(ex.muscle_groups[0]);
    }
  });
});

describe('buildStarterRegimen — per-level set/rep targets', () => {
  it.each([
    ['newbie',     3, 10],
    ['returning',  3, 10],
    ['consistent', 4,  8],
    ['advanced',   5,  5],
  ])('level=%s yields %ix%i targets on strength lifts', (level, sets, reps) => {
    const r = buildStarterRegimen({ goals: ['strength'], level, daysCount: 4 });
    // Strength exercises (non-cardio) use the level's reps verbatim.
    // We assert on the first exercise (Squat for strength) which is
    // never a cardio override.
    expect(r.exercises[0].target_sets).toBe(sets);
    expect(r.exercises[0].target_reps).toBe(reps);
  });
});

describe('buildStarterRegimen — cardio + hold-style overrides', () => {
  it('cardio exercises get a higher target_reps (30)', () => {
    const r = buildStarterRegimen({ goals: ['endurance'], level: 'consistent', daysCount: 3 });
    const running = r.exercises.find(e => e.name === 'Running');
    expect(running.target_reps).toBe(30);
  });

  it('Plank / Mountain Climbers / Side Plank get the moderate-high target (20)', () => {
    const r = buildStarterRegimen({ goals: ['mobility'], level: 'consistent', daysCount: 3 });
    const plank = r.exercises.find(e => e.name === 'Plank');
    expect(plank.target_reps).toBe(20);
    const sidePlank = r.exercises.find(e => e.name === 'Side Plank');
    expect(sidePlank.target_reps).toBe(20);
  });
});

describe('buildStarterRegimen — naming + description', () => {
  it('name includes the goal title', () => {
    expect(buildStarterRegimen({ goals: ['strength'], level: 'consistent', daysCount: 3 }).name)
      .toBe('Your Starter Plan — Build Strength');
    expect(buildStarterRegimen({ goals: ['muscle'], level: 'consistent', daysCount: 3 }).name)
      .toBe('Your Starter Plan — Add Muscle');
    expect(buildStarterRegimen({ goals: ['lose'], level: 'consistent', daysCount: 3 }).name)
      .toBe('Your Starter Plan — Lose Fat');
    expect(buildStarterRegimen({ goals: ['endurance'], level: 'consistent', daysCount: 3 }).name)
      .toBe('Your Starter Plan — Build Endurance');
    expect(buildStarterRegimen({ goals: ['mobility'], level: 'consistent', daysCount: 3 }).name)
      .toBe('Your Starter Plan — Move Better');
  });

  it('description includes level + days × week', () => {
    const r = buildStarterRegimen({ goals: ['strength'], level: 'advanced', daysCount: 5 });
    expect(r.description).toContain('advanced');
    expect(r.description).toContain('5×/week');
  });
});

describe('buildStarterRegimen — edge cases / defaults', () => {
  it('empty input falls through to strength + newbie defaults', () => {
    const r = buildStarterRegimen({});
    expect(r.name).toContain('Build Strength');
    expect(r.description).toContain('newbie');
    expect(r.description).toContain('3×/week');
    expect(r.exercises.length).toBeGreaterThan(0);
  });

  it('null goals + null level fall through to defaults', () => {
    const r = buildStarterRegimen({ goals: null, level: null, daysCount: 0 });
    expect(r.name).toContain('Build Strength');
    expect(r.exercises[0].target_sets).toBe(3);
    expect(r.exercises[0].target_reps).toBe(10);
  });

  it('unknown goal falls through to strength', () => {
    const r = buildStarterRegimen({ goals: ['notarealgoal'], level: 'consistent', daysCount: 4 });
    expect(r.name).toBe('Your Starter Plan — Build Strength');
  });

  it('uses only the FIRST goal from a multi-goal selection (focused starter plan)', () => {
    const r = buildStarterRegimen({ goals: ['mobility', 'strength'], level: 'consistent', daysCount: 3 });
    expect(r.name).toContain('Move Better');
  });
});
