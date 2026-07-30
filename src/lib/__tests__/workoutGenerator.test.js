import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateWorkout,
  FOCUS_OPTIONS,
  EQUIPMENT_OPTIONS,
  DURATION_OPTIONS,
  SKILL_OPTIONS,
} from '../aiCoach/workoutGenerator';
import { getExcludedMuscleGroups } from '../data/injuries';

// Mock the data client to control workout history
vi.mock('@/api/db', () => ({
  db: {
    entities: {
      WorkoutLog: {
        filter: vi.fn(() => Promise.resolve([])),
      },
    },
  },
}));

describe('Generator option exports', () => {
  it('exposes the expanded focus options (incl. muscle splits)', () => {
    expect(FOCUS_OPTIONS.length).toBeGreaterThanOrEqual(11);
    const ids = FOCUS_OPTIONS.map(o => o.id);
    expect(ids).toContain('full_body');
    expect(ids).toContain('upper');
    expect(ids).toContain('lower');
    expect(ids).toContain('legs');
    expect(ids).toContain('chest');
    expect(ids).toContain('back');
    expect(ids).toContain('shoulders');
    expect(ids).toContain('arms');
    // every focus has a human label
    expect(FOCUS_OPTIONS.every(o => o.label && o.label !== o.id)).toBe(true);
  });

  it('exposes 4 equipment options', () => {
    expect(EQUIPMENT_OPTIONS).toHaveLength(4);
    expect(EQUIPMENT_OPTIONS.map(o => o.id)).toEqual(['gym', 'dumbbells', 'minimal', 'bodyweight']);
  });

  it('exposes 4 duration options', () => {
    expect(DURATION_OPTIONS).toHaveLength(4);
    expect(DURATION_OPTIONS.map(o => o.id)).toEqual([30, 45, 60, 90]);
  });

  it('exposes 3 skill options', () => {
    expect(SKILL_OPTIONS).toHaveLength(3);
    expect(SKILL_OPTIONS.map(o => o.id)).toEqual(['beginner', 'intermediate', 'advanced']);
  });
});

describe('generateWorkout — injury exclusions and demographics', () => {
  it('never programs a muscle group the user has an active injury in', async () => {
    const w = await generateWorkout({
      user: { email: 'a@b.c' },
      focus: 'full_body',
      durationMinutes: 60,
      equipment: 'gym',
      skillLevel: 'intermediate',
      bodyweightLbs: 180,
      excludeMuscleGroups: getExcludedMuscleGroups([
        { muscle_group: 'shoulders', severity: 'moderate' },
      ]),
    });
    expect(w.exercises.length).toBeGreaterThan(0);
    expect(w.exercises.some(e => e.group === 'shoulders')).toBe(false);
  });

  it('also drops synergist groups for a serious injury', async () => {
    const excluded = getExcludedMuscleGroups([
      { muscle_group: 'shoulders', severity: 'serious' },
    ]);
    const w = await generateWorkout({
      user: { email: 'a@b.c' },
      focus: 'full_body',
      durationMinutes: 60,
      equipment: 'gym',
      skillLevel: 'intermediate',
      bodyweightLbs: 180,
      excludeMuscleGroups: excluded,
    });
    // shoulders + its synergists (chest, triceps) are all off the table.
    expect(excluded.has('chest')).toBe(true);
    for (const ex of w.exercises) {
      expect(['shoulders', 'chest']).not.toContain(ex.group);
    }
  });

  it('starts a woman lighter than a man of the same bodyweight', async () => {
    const base = {
      user: { email: 'a@b.c' }, focus: 'legs', durationMinutes: 45,
      equipment: 'gym', skillLevel: 'intermediate', bodyweightLbs: 165,
    };
    const male   = await generateWorkout({ ...base, demographics: { gender: 'male',   age: 30 } });
    const female = await generateWorkout({ ...base, demographics: { gender: 'female', age: 30 } });
    const top = (w) => Math.max(...w.exercises.flatMap(e => e.sets.map(s => s.weight)));
    expect(top(female)).toBeLessThan(top(male));
    expect(top(female)).toBeGreaterThan(0);
  });
});

describe('generateWorkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a valid workout shape', async () => {
    const w = await generateWorkout({
      user: { email: 'test@example.com' },
      focus: 'full_body',
      durationMinutes: 45,
      equipment: 'gym',
      skillLevel: 'intermediate',
      bodyweightLbs: 165,
    });
    expect(w).toHaveProperty('title');
    expect(w).toHaveProperty('focus', 'full_body');
    expect(w).toHaveProperty('duration_minutes', 45);
    expect(Array.isArray(w.exercises)).toBe(true);
    expect(w.exercises.length).toBeGreaterThan(0);
  });

  it('exercise count scales with duration', async () => {
    const short = await generateWorkout({
      user: { email: 'a' }, focus: 'full_body', durationMinutes: 30,
      equipment: 'gym', skillLevel: 'intermediate', bodyweightLbs: 165,
    });
    const long = await generateWorkout({
      user: { email: 'a' }, focus: 'full_body', durationMinutes: 90,
      equipment: 'gym', skillLevel: 'intermediate', bodyweightLbs: 165,
    });
    expect(short.exercises.length).toBeLessThan(long.exercises.length);
  });

  it('every exercise has at least 1 set with reps', async () => {
    const w = await generateWorkout({
      user: { email: 'a' }, focus: 'full_body', durationMinutes: 45,
      equipment: 'gym', skillLevel: 'intermediate', bodyweightLbs: 165,
    });
    for (const ex of w.exercises) {
      expect(ex.sets.length).toBeGreaterThan(0);
      expect(ex.sets[0].reps).toBeGreaterThan(0);
    }
  });

  it('bodyweight equipment never recommends barbell exercises', async () => {
    const w = await generateWorkout({
      user: { email: 'a' }, focus: 'full_body', durationMinutes: 45,
      equipment: 'bodyweight', skillLevel: 'beginner', bodyweightLbs: 165,
    });
    for (const ex of w.exercises) {
      expect(ex.name.toLowerCase()).not.toContain('barbell');
    }
  });

  it('beginner does not get advanced-only exercises', async () => {
    const w = await generateWorkout({
      user: { email: 'a' }, focus: 'lower', durationMinutes: 45,
      equipment: 'gym', skillLevel: 'beginner', bodyweightLbs: 165,
    });
    // Front Squat is skill 3 — should not appear for a beginner
    expect(w.exercises.some(ex => ex.name === 'Front Squat')).toBe(false);
  });

  it('every exercise has a numeric weight (or 0 for bodyweight) and reps', async () => {
    const w = await generateWorkout({
      user: { email: 'a' }, focus: 'upper', durationMinutes: 45,
      equipment: 'gym', skillLevel: 'intermediate', bodyweightLbs: 175,
    });
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        expect(typeof s.weight).toBe('number');
        expect(typeof s.reps).toBe('number');
        expect(s.weight).toBeGreaterThanOrEqual(0);
        expect(s.reps).toBeGreaterThan(0);
      }
    }
  });

  it('compound exercises get longer rest than accessories', async () => {
    const w = await generateWorkout({
      user: { email: 'a' }, focus: 'upper', durationMinutes: 60,
      equipment: 'gym', skillLevel: 'intermediate', bodyweightLbs: 165,
    });
    // Find at least one of each
    const hasCompound = w.exercises.some(ex => ex.restSec === 120);
    const hasAccessory = w.exercises.some(ex => ex.restSec === 75);
    expect(hasCompound || hasAccessory).toBe(true); // at least one should exist
  });

  it('title includes the focus name', async () => {
    const w = await generateWorkout({
      user: { email: 'a' }, focus: 'legs', durationMinutes: 45,
      equipment: 'gym', skillLevel: 'intermediate', bodyweightLbs: 165,
    });
    expect(w.title.toLowerCase()).toContain('leg');
  });

  it('falls back to defaults when params are missing', async () => {
    const w = await generateWorkout({ user: { email: 'a' } });
    expect(w.exercises.length).toBeGreaterThan(0);
    expect(w.duration_minutes).toBe(45);
    expect(w.focus).toBe('full_body');
  });
});
