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

  it('endurance ("Run further") is running-first and never hands a runner cycling', () => {
    const r = buildStarterRegimen({ goals: ['endurance'], level: 'advanced', daysCount: 5 });
    const names = r.exercises.map(e => e.name);
    expect(names).toContain('Running');
    expect(names).not.toContain('Cycling');
  });

  it('respects a cyclist\'s preference: leads with Cycling, drops Running', () => {
    const r = buildStarterRegimen({ goals: ['endurance'], level: 'consistent', daysCount: 4, cardioPreference: 'cycling' });
    const names = r.exercises.map(e => e.name);
    expect(names[0]).toBe('Cycling');
    expect(names).not.toContain('Running');
  });

  it('cardioPreference only affects the endurance goal', () => {
    const r = buildStarterRegimen({ goals: ['strength'], level: 'consistent', daysCount: 4, cardioPreference: 'cycling' });
    expect(r.exercises.map(e => e.name)).not.toContain('Cycling');
  });

  it('a collegiate runner (sub-10 mile, broadly fit) gets an advanced program, not 3x10', () => {
    const assessment = { mile_under10: 'yes', bench_bw: 'yes', squat_bw15: 'yes', pullups_10: 'yes' };
    // daysCount 4 → no days volume adjustment, so the advanced 5-set scheme shows verbatim.
    const r = buildStarterRegimen({ goals: ['endurance'], level: 'consistent', daysCount: 4, assessment });
    expect(r.exercises[0].target_sets).toBe(5); // advanced scheme (5 sets)
    expect(r.description).toContain('advanced');
  });

  it('a fit runner (sub-10 mile only) is at least consistent, not newbie', () => {
    const r = buildStarterRegimen({ goals: ['endurance'], level: 'newbie', daysCount: 4, assessment: { mile_under10: 'yes' } });
    expect(r.exercises[0].target_sets).toBe(4); // consistent scheme
  });

  it('assessment does not demote a true beginner with no capability', () => {
    const r = buildStarterRegimen({ goals: ['strength'], level: 'newbie', daysCount: 3, assessment: {} });
    expect(r.exercises[0].target_sets).toBe(3);
    expect(r.exercises[0].target_reps).toBe(10);
  });

  it('honors the onboarding injury log — excludes affected muscle groups (all goals)', () => {
    const cases = [
      { goal: 'strength',  injury: 'Back',   forbidden: 'Back' },
      { goal: 'strength',  injury: 'Legs',   forbidden: 'Legs' },
      { goal: 'muscle',    injury: 'Chest',  forbidden: 'Chest' },
      { goal: 'lose',      injury: 'Legs',   forbidden: 'Legs' },
      { goal: 'endurance', injury: 'Legs',   forbidden: 'Legs' },   // injured leg → no Running
      { goal: 'mobility',  injury: 'Core',   forbidden: 'Core' },
    ];
    for (const { goal, injury, forbidden } of cases) {
      const r = buildStarterRegimen({
        goals: [goal], level: 'consistent', daysCount: 4,
        injuries: [{ muscleGroup: injury, severity: 'moderate' }],
      });
      // No returned exercise may train the injured region.
      for (const ex of r.exercises) {
        expect(ex.muscle_groups).not.toContain(forbidden);
      }
      expect(r.exercises.length).toBeGreaterThan(0);
    }
  });

  it('injured leg + endurance never returns Running', () => {
    const r = buildStarterRegimen({
      goals: ['endurance'], level: 'consistent', daysCount: 4,
      injuries: [{ muscleGroup: 'Legs', severity: 'serious' }],
    });
    expect(r.exercises.map(e => e.name)).not.toContain('Running');
  });

  it('never returns an empty plan even with many injured regions', () => {
    const r = buildStarterRegimen({
      goals: ['strength'], level: 'consistent', daysCount: 3,
      injuries: ['Chest', 'Back', 'Legs', 'Shoulders', 'Glutes', 'Core', 'Biceps', 'Triceps']
        .map(muscleGroup => ({ muscleGroup, severity: 'serious' })),
    });
    expect(r.exercises.length).toBeGreaterThanOrEqual(1);
  });
});

describe('buildStarterRegimen — training days → scope', () => {
  it('a 2-day plan is more compact than a 6-day plan', () => {
    const two = buildStarterRegimen({ goals: ['strength'], level: 'consistent', daysCount: 2 });
    const six = buildStarterRegimen({ goals: ['strength'], level: 'consistent', daysCount: 6 });
    expect(two.exercises.length).toBeLessThan(six.exercises.length);
    expect(two.exercises.length).toBe(5);
    expect(six.exercises.length).toBeGreaterThanOrEqual(6);
  });

  it('scope scales monotonically with training days', () => {
    const counts = [1, 2, 3, 4, 5, 6, 7].map(
      d => buildStarterRegimen({ goals: ['muscle'], level: 'consistent', daysCount: d }).exercises.length,
    );
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    }
  });
});

describe('buildStarterRegimen — training days → per-session volume (inverse)', () => {
  it('fewer training days → MORE sets per session', () => {
    const two = buildStarterRegimen({ goals: ['strength'], level: 'consistent', daysCount: 2 });
    const four = buildStarterRegimen({ goals: ['strength'], level: 'consistent', daysCount: 4 });
    const six = buildStarterRegimen({ goals: ['strength'], level: 'consistent', daysCount: 6 });
    expect(two.exercises[0].target_sets).toBe(5);  // 4 base + 1
    expect(four.exercises[0].target_sets).toBe(4);  // 4 base + 0
    expect(six.exercises[0].target_sets).toBe(3);  // 4 base - 1
  });

  it('per-session volume never drops below the 2-set floor', () => {
    // A 7-day newbie: 3 base - 1 = 2, still >= floor.
    const r = buildStarterRegimen({ goals: ['strength'], level: 'newbie', daysCount: 7 });
    expect(r.exercises[0].target_sets).toBe(2);
  });

  it('the days volume adjustment is capped by the age recovery cap', () => {
    // 55+ lifter training 2 days would be 5+1=6, but the age cap holds it to 4.
    const r = buildStarterRegimen({ goals: ['strength'], level: 'advanced', daysCount: 2, age: 58 });
    expect(r.exercises[0].target_sets).toBe(4);
  });
});

describe('buildStarterRegimen — sex-aware reps', () => {
  it('female gets slightly higher reps in the hypertrophy range (fatigue resistance)', () => {
    const male = buildStarterRegimen({ goals: ['muscle'], level: 'consistent', daysCount: 4, gender: 'male' });
    const female = buildStarterRegimen({ goals: ['muscle'], level: 'consistent', daysCount: 4, gender: 'female' });
    // consistent = 8 reps; female +2 → 10 on the first (non-cardio) lift.
    expect(male.exercises[0].target_reps).toBe(8);
    expect(female.exercises[0].target_reps).toBe(10);
  });

  it('female rep bump does NOT apply to the max-strength (≤5 rep) scheme', () => {
    const female = buildStarterRegimen({ goals: ['strength'], level: 'advanced', daysCount: 4, gender: 'female' });
    expect(female.exercises[0].target_reps).toBe(5); // advanced 5×5 stays 5 reps
  });

  it("'other' and unset sex are treated as the male baseline (no rep bump)", () => {
    const other = buildStarterRegimen({ goals: ['muscle'], level: 'consistent', daysCount: 4, gender: 'other' });
    const unset = buildStarterRegimen({ goals: ['muscle'], level: 'consistent', daysCount: 4 });
    expect(other.exercises[0].target_reps).toBe(8);
    expect(unset.exercises[0].target_reps).toBe(8);
  });
});

describe('buildStarterRegimen — weight/BMI awareness', () => {
  // 100 kg @ 170 cm → BMI ≈ 34.6 (high); 70 kg @ 178 cm → BMI ≈ 22 (normal).
  it('a high-BMI strength user gets a conditioning move (via height+weight)', () => {
    const lean = buildStarterRegimen({ goals: ['strength'], level: 'consistent', daysCount: 3, weightKg: 70, heightCm: 178 });
    const heavy = buildStarterRegimen({ goals: ['strength'], level: 'consistent', daysCount: 3, weightKg: 100, heightCm: 170 });
    expect(lean.exercises.map(e => e.name)).not.toContain('Mountain Climbers');
    expect(heavy.exercises.map(e => e.name)).toContain('Mountain Climbers');
  });

  it('a high-BMI beginner gets an achievable rep target on bodyweight lifts', () => {
    // muscle pool includes Pull-Up; newbie base reps = 10, capped to 8 at high BMI.
    const heavy = buildStarterRegimen({ goals: ['muscle'], level: 'newbie', daysCount: 4, weightKg: 110, heightCm: 172 });
    const pullUp = heavy.exercises.find(e => e.name === 'Pull-Up');
    expect(pullUp).toBeTruthy();
    expect(pullUp.target_reps).toBeLessThanOrEqual(8);
    // A normal-BMI newbie keeps the full 10.
    const lean = buildStarterRegimen({ goals: ['muscle'], level: 'newbie', daysCount: 4, weightKg: 68, heightCm: 178 });
    expect(lean.exercises.find(e => e.name === 'Pull-Up').target_reps).toBe(10);
  });

  it('missing height or weight leaves the plan unaffected (no BMI)', () => {
    const noHeight = buildStarterRegimen({ goals: ['strength'], level: 'consistent', daysCount: 3, weightKg: 100 });
    expect(noHeight.exercises.map(e => e.name)).not.toContain('Mountain Climbers');
  });
});

describe('buildStarterRegimen — age-aware recovery', () => {
  it('caps volume at 4 sets for a 55+ lifter who would otherwise get 5', () => {
    const young = buildStarterRegimen({ goals: ['strength'], level: 'advanced', daysCount: 4, age: 30 });
    const older = buildStarterRegimen({ goals: ['strength'], level: 'advanced', daysCount: 4, age: 58 });
    expect(young.exercises[0].target_sets).toBe(5);
    expect(older.exercises[0].target_sets).toBe(4);
    expect(older.description).toContain('recovery-adjusted');
  });

  it('caps volume at 3 sets for a 65+ lifter', () => {
    const r = buildStarterRegimen({ goals: ['strength'], level: 'advanced', daysCount: 4, age: 70 });
    expect(r.exercises[0].target_sets).toBe(3);
  });

  it('leaves volume untouched for a younger lifter (no recovery note)', () => {
    const r = buildStarterRegimen({ goals: ['strength'], level: 'consistent', daysCount: 4, age: 40 });
    expect(r.exercises[0].target_sets).toBe(4);
    expect(r.description).not.toContain('recovery-adjusted');
  });
});

describe('buildStarterRegimen — secondary goals → accessory', () => {
  it('a strength+mobility user gets a mobility accessory alongside the strength core', () => {
    const primaryOnly = buildStarterRegimen({ goals: ['strength'], level: 'consistent', daysCount: 5 });
    const withSecondary = buildStarterRegimen({ goals: ['strength', 'mobility'], level: 'consistent', daysCount: 5 });
    expect(withSecondary.name).toContain('Build Strength'); // primary still drives the plan
    // The mobility accessory (Side Plank) is added.
    expect(withSecondary.exercises.map(e => e.name)).toContain('Side Plank');
    expect(primaryOnly.exercises.map(e => e.name)).not.toContain('Side Plank');
  });

  it('an injured secondary accessory is not added (injury-safe)', () => {
    // muscle secondary accessory is Dumbbell Curl (Biceps) — a Biceps injury drops it.
    const r = buildStarterRegimen({
      goals: ['strength', 'muscle'], level: 'consistent', daysCount: 5,
      injuries: [{ muscleGroup: 'Biceps', severity: 'moderate' }],
    });
    expect(r.exercises.map(e => e.name)).not.toContain('Dumbbell Curl');
  });

  it('never exceeds 8 exercises even with several secondary goals', () => {
    const r = buildStarterRegimen({
      goals: ['strength', 'muscle', 'lose', 'endurance', 'mobility'],
      level: 'consistent', daysCount: 7,
    });
    expect(r.exercises.length).toBeLessThanOrEqual(8);
  });
});

describe('buildStarterRegimen — injury severity nuance', () => {
  it('a MILD injury keeps the exercise but flags it with an ease-in note', () => {
    const r = buildStarterRegimen({
      goals: ['strength'], level: 'consistent', daysCount: 5,
      injuries: [{ muscleGroup: 'Legs', severity: 'mild' }],
    });
    const legExercise = r.exercises.find(e => e.muscle_groups.includes('Legs'));
    expect(legExercise).toBeTruthy(); // not excluded
    expect(legExercise.notes).toMatch(/ease in/i);
  });

  it('a MODERATE injury is excluded outright (no note, no exercise)', () => {
    const r = buildStarterRegimen({
      goals: ['strength'], level: 'consistent', daysCount: 5,
      injuries: [{ muscleGroup: 'Legs', severity: 'moderate' }],
    });
    for (const ex of r.exercises) {
      expect(ex.muscle_groups).not.toContain('Legs');
    }
  });

  it('injuries with no severity default to excluded (safe fallback)', () => {
    const r = buildStarterRegimen({
      goals: ['strength'], level: 'consistent', daysCount: 5,
      injuries: [{ muscleGroup: 'Back' }],
    });
    for (const ex of r.exercises) {
      expect(ex.muscle_groups).not.toContain('Back');
    }
  });
});

describe('buildStarterRegimen — body-fat conditioning nudge', () => {
  it('adds conditioning for a high-body-fat strength user', () => {
    const lean = buildStarterRegimen({ goals: ['strength'], level: 'consistent', daysCount: 3, bodyFatPct: 15 });
    const high = buildStarterRegimen({ goals: ['strength'], level: 'consistent', daysCount: 3, bodyFatPct: 30 });
    expect(lean.exercises.map(e => e.name)).not.toContain('Mountain Climbers');
    expect(high.exercises.map(e => e.name)).toContain('Mountain Climbers');
  });

  it('does not add conditioning for an endurance goal (already cardio-heavy)', () => {
    const r = buildStarterRegimen({ goals: ['endurance'], level: 'consistent', daysCount: 3, bodyFatPct: 32 });
    // endurance already leads with cardio; the strength/muscle-only nudge doesn't fire an extra add
    expect(r.name).toContain('Build Endurance');
  });
});
