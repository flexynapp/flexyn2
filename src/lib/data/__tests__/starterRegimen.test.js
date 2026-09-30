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

describe('buildStarterRegimen — cardio sessions', () => {
  it('cardio goals generate real running sessions (kind cardio, with a detail)', () => {
    const r = buildStarterRegimen({ goals: ['endurance'], level: 'consistent', daysCount: 3, cardioEvent: '10k' });
    const cardio = r.exercises.filter(e => e.kind === 'cardio');
    expect(cardio.length).toBeGreaterThan(0);
    expect(cardio.every(e => e.name === 'Running')).toBe(true);
    expect(cardio.every(e => typeof e.detail === 'string' && e.detail.length > 0)).toBe(true);
    // "Run further" always includes a long run.
    expect(cardio.some(e => /long/i.test(e.displayName))).toBe(true);
  });

  it('"Run faster" adds interval + tempo sessions', () => {
    const r = buildStarterRegimen({ goals: ['speed'], level: 'consistent', daysCount: 3, cardioEvent: '5k' });
    const names = r.exercises.filter(e => e.kind === 'cardio').map(e => e.displayName);
    expect(names).toContain('Interval Run');
    expect(names).toContain('Tempo Run');
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
      .toBe('Your Starter Plan: Build Strength');
    expect(buildStarterRegimen({ goals: ['muscle'], level: 'consistent', daysCount: 3 }).name)
      .toBe('Your Starter Plan: Add Muscle');
    expect(buildStarterRegimen({ goals: ['lose'], level: 'consistent', daysCount: 3 }).name)
      .toBe('Your Starter Plan: Lose Fat');
    expect(buildStarterRegimen({ goals: ['speed'], level: 'consistent', daysCount: 3 }).name)
      .toBe('Your Starter Plan: Run Faster');
    expect(buildStarterRegimen({ goals: ['endurance'], level: 'consistent', daysCount: 3 }).name)
      .toBe('Your Starter Plan: Run Further');
    expect(buildStarterRegimen({ goals: ['mobility'], level: 'consistent', daysCount: 3 }).name)
      .toBe('Your Starter Plan: Move Better');
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
    expect(r.name).toBe('Your Starter Plan: Build Strength');
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

  it('a cardio-only plan leads with running sessions', () => {
    const r = buildStarterRegimen({ goals: ['endurance'], level: 'consistent', daysCount: 4, cardioEvent: '10k' });
    expect(r.exercises[0].kind).toBe('cardio');
  });

  it('a collegiate runner (sub-10 mile, broadly fit) gets an advanced program, not 3x10', () => {
    const assessment = { mile_under10: 'yes', bench_bw: 'yes', squat_bw15: 'yes', pullups_10: 'yes' };
    // daysCount 4 → no days volume adjustment, so the advanced 5-set scheme shows verbatim.
    const r = buildStarterRegimen({ goals: ['endurance'], level: 'consistent', daysCount: 4, assessment });
    const firstStrength = r.exercises.find(e => e.kind === 'strength');
    expect(firstStrength.target_sets).toBe(5); // advanced scheme (5 sets)
    expect(r.description).toContain('advanced');
  });

  it('a fit runner (sub-10 mile only) is at least consistent, not newbie', () => {
    const r = buildStarterRegimen({ goals: ['endurance'], level: 'newbie', daysCount: 4, assessment: { mile_under10: 'yes' } });
    const firstStrength = r.exercises.find(e => e.kind === 'strength');
    expect(firstStrength.target_sets).toBe(4); // consistent scheme
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

  // REVERSED on 2026-08-10, deliberately. This used to assert
  // `length >= 1` — "never returns an empty plan even with many injured
  // regions" — and that assertion was the bug wearing a test's clothes.
  // With all eight groups flagged there IS nothing safe to program, so the
  // only way to satisfy it was to hand back work on injured regions: the
  // plan came out as Jump Rope, Clean and Jerk and Ground to Overhead,
  // which load every one of them. An empty block is the honest answer, and
  // ensureStarterRegimen declines to persist it rather than creating a
  // regimen that is a lie either way.
  //
  // UPDATE: this used to assert length 0, and that stopped being the honest
  // answer when the grip work was retagged off 'Back' onto 'Forearms'. The
  // reasoning above turns on "there IS nothing safe to program", and that
  // premise was itself a product of the mislabel — a seated wrist curl was
  // only ever excluded by a back injury because it claimed to be back work.
  // Now the library really does hold something safe, so returning it is the
  // honest answer and an empty block would be the lie.
  //
  // What must NOT weaken is the actual safety rule, and it hasn't: that lives
  // in 'never programs a flagged region, however many are flagged' above, and
  // it still passes untouched. This test now pins the weaker, separate claim
  // that the fallback reaches for genuinely unflagged work rather than
  // reaching for nothing.
  // SECOND UPDATE, and it restores the original assertion rather than
  // replacing it. Making 'Forearms' reportable (InjuryForm / OB_MUSCLES) gave
  // "every region" a ninth member, so the empty-plan case is reachable again
  // and is tested below on the full nine. The eight-region case did not stop
  // being interesting when that happened — it is now the realistic one, since
  // a user who flags every region EXCEPT their forearms should get the grip
  // work rather than an empty block — so both are pinned.
  it('falls back to genuinely safe work when every region BUT forearms is flagged', () => {
    const r = buildStarterRegimen({
      goals: ['strength'], level: 'consistent', daysCount: 3,
      injuries: ['Chest', 'Back', 'Legs', 'Shoulders', 'Glutes', 'Core', 'Biceps', 'Triceps']
        .map(muscleGroup => ({ muscleGroup, severity: 'serious' })),
    });
    expect(r.exercises.length).toBeGreaterThan(0);
    // Asserted as a property rather than by name: any exercise that survives
    // eight flagged groups must load NOTHING but forearms, so a future entry
    // that sneaks through on a mislabel fails here instead of passing because
    // the name list happened to still match.
    for (const ex of r.exercises) {
      expect(ex.muscle_groups, `${ex.name} loads more than forearms`).toEqual(['Forearms']);
    }
  });

  it('returns nothing rather than something unsafe when every region is flagged', () => {
    const r = buildStarterRegimen({
      goals: ['strength'], level: 'consistent', daysCount: 3,
      injuries: ['Chest', 'Back', 'Legs', 'Shoulders', 'Glutes', 'Core', 'Biceps', 'Triceps', 'Forearms']
        .map(muscleGroup => ({ muscleGroup, severity: 'serious' })),
    });
    expect(r.exercises).toHaveLength(0);
  });
});

describe('buildStarterRegimen — training days → scope', () => {
  it('a 2-day plan is more compact than a 6-day plan', () => {
    // Aged 26 so the session set limit (25) leaves the 2-day 5 x 5 whole; an
    // older or unset profile has a lower limit and loses a lift to it.
    const two = buildStarterRegimen({ goals: ['strength'], level: 'consistent', daysCount: 2, age: 26 });
    const six = buildStarterRegimen({ goals: ['strength'], level: 'consistent', daysCount: 6, age: 26 });
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

// Severity used to change WHETHER a region was excluded: moderate and serious
// were dropped, mild stayed in with an "Ease in — mild legs flagged." note. It
// no longer does, and the reason is agreement rather than caution. The runtime
// generator (`getExcludedMuscleGroups`) has always dropped the region at every
// severity, so a user reporting a mild knee got a starter plan with squats in
// it and then never saw a leg exercise again from the second session onwards.
// One of the two had to move; moving the generator would have meant weakening
// injury protection on the surface people actually train from.
describe('buildStarterRegimen — every severity is excluded', () => {
  it('a MILD injury is excluded, same as the rest', () => {
    const r = buildStarterRegimen({
      goals: ['strength'], level: 'consistent', daysCount: 5,
      injuries: [{ muscleGroup: 'Legs', severity: 'mild' }],
    });
    for (const ex of r.exercises) {
      expect(ex.muscle_groups).not.toContain('Legs');
    }
  });

  it('no exercise carries an ease-in note any more', () => {
    const r = buildStarterRegimen({
      goals: ['strength'], level: 'consistent', daysCount: 5,
      injuries: [{ muscleGroup: 'Legs', severity: 'mild' }],
    });
    for (const ex of r.exercises) {
      expect(ex.notes || '').not.toMatch(/ease in/i);
    }
  });

  // ── The empty-plan valve ───────────────────────────────────────────────
  //
  // When injury filtering empties the goal's own pool we WIDEN THE SEARCH
  // rather than lower the bar. The old fallback kept "the three exercises
  // hitting the fewest injured areas" — fewest, not none — so the moment it
  // fired it handed back work on regions the user had just flagged. With
  // five injuries it returned Overhead Press, Barbell Row and Pull-Up
  // against a serious shoulder and a moderate back.
  const FIVE = [
    { muscleGroup: 'Legs', severity: 'mild' },
    { muscleGroup: 'Chest', severity: 'mild' },
    { muscleGroup: 'Back', severity: 'moderate' },
    { muscleGroup: 'Shoulders', severity: 'serious' },
    { muscleGroup: 'Core', severity: 'mild' },
  ];
  const plan = (injuries, goals = ['strength']) =>
    buildStarterRegimen({ goals, level: 'consistent', daysCount: 5, injuries });

  it('still returns a usable plan when the goal pool is emptied', () => {
    expect(plan(FIVE).exercises.length).toBeGreaterThan(0);
  });

  it('never programs a flagged region, however many are flagged', () => {
    const flagged = new Set(FIVE.map(i => i.muscleGroup));
    for (const ex of plan(FIVE).exercises) {
      for (const m of ex.muscle_groups || []) {
        expect(flagged.has(m), `${ex.name} loads ${m}`).toBe(false);
      }
    }
  });

  it('looks outside the goal pool to find something clean', () => {
    // None of these is in GOAL_EXERCISES.strength — the point is that the
    // search widened rather than settling for the least-bad squat.
    const names = plan(FIVE).exercises.map(e => e.name);
    expect(names).not.toContain('Squat');
    expect(names).not.toContain('Bench Press');
    expect(names.length).toBeGreaterThan(0);
  });

  it('treats Full Body and Cardio as loading what they actually load', () => {
    // Neither tag is an injury group, so a plain membership test could never
    // exclude them — and they are the most loading things in the library.
    // Asked for a plan around all eight groups it used to answer Jump Rope,
    // Clean and Jerk and Ground to Overhead.
    const all = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Glutes', 'Core']
      .map(m => ({ muscleGroup: m, severity: 'mild' }));
    const names = plan(all).exercises.map(e => e.name);
    expect(names).not.toContain('Clean and Jerk');
    expect(names).not.toContain('Ground to Overhead');
    expect(names).not.toContain('Jump Rope');
  });

  it('leaves an uninjured plan and a one-injury plan alone', () => {
    expect(plan([]).exercises.map(e => e.name)).toContain('Squat');
    const one = plan([{ muscleGroup: 'Legs', severity: 'mild' }]).exercises.map(e => e.name);
    expect(one).toContain('Bench Press');
    expect(one).not.toContain('Squat');
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
    expect(r.name).toContain('Run Further');
    expect(r.exercises.map(e => e.name)).not.toContain('Mountain Climbers');
  });
});

// ── Assessment tiers ────────────────────────────────────────────────────
//
// The original four questions were all advanced benchmarks, so a beginner and
// someone a year into training both scored 0 and got the same plan. The
// foundation tier tells those two apart. The list was later cut from seven to
// five to fit a phone; the retired keys are still counted so an older profile
// isn't demoted on a recompute.
describe('assessment tiers', () => {
  const base = { goals: ['strength'], level: 'newbie', daysCount: 3 };

  it('promotes a lifting plan on the two lift answers, not the mile', () => {
    const solid = buildStarterRegimen({ ...base, assessment: { squat_bw15: 'yes', pullups_10: 'yes' } });
    const aces = buildStarterRegimen({
      ...base,
      assessment: { squat_bw15: 'yes', pullups_10: 'yes', mile_under10: 'yes' },
    });
    const mileAndSquat = buildStarterRegimen({ ...base, assessment: { squat_bw15: 'yes', mile_under10: 'yes' } });
    expect(solid.description).toMatch(/consistent/i);
    // A quick mile says nothing about a squat, so it adds no lifting level.
    expect(aces.description).toMatch(/consistent/i);
    expect(mileAndSquat.description).not.toMatch(/consistent|advanced/i);
    // A profile answered when bench_bw was asked keeps its advanced plan.
    const legacy = buildStarterRegimen({ ...base, assessment: { squat_bw15: 'yes', pullups_10: 'yes', bench_bw: 'yes' } });
    expect(legacy.description).toMatch(/advanced/i);
  });

  it('lifts a self-declared newbie off the floor on foundation answers', () => {
    const trainsABit = buildStarterRegimen({
      ...base,
      assessment: { pushups_20: 'yes', plank_60s: 'yes' },
    });
    expect(trainsABit.description).toMatch(/returning/i);
  });

  it('does not let the foundation tier promote past returning', () => {
    // Clearing a beginner bar says nothing about handling real volume.
    const allFoundation = buildStarterRegimen({
      ...base,
      assessment: { pushups_20: 'yes', plank_60s: 'yes', squats_25: 'yes' },
    });
    expect(allFoundation.description).toMatch(/returning/i);
    expect(allFoundation.description).not.toMatch(/consistent|advanced/i);
  });

  it('ignores a single foundation answer', () => {
    const barely = buildStarterRegimen({ ...base, assessment: { pushups_20: 'yes' } });
    expect(barely.description).toMatch(/newbie|new/i);
  });

  it('still counts answers to questions that are no longer asked', () => {
    // A profile saved when `bench_bw` and `squats_25` existed must not be
    // demoted just because the list got shorter.
    const legacy = buildStarterRegimen({
      ...base,
      assessment: { bench_bw: 'yes', squat_bw15: 'yes' },
    });
    expect(legacy.description).toMatch(/consistent/i);

    const legacyFoundation = buildStarterRegimen({
      ...base,
      assessment: { squats_25: 'yes', pushups_20: 'yes' },
    });
    expect(legacyFoundation.description).toMatch(/returning/i);
  });
});
