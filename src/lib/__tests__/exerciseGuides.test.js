import { describe, it, expect } from 'vitest';
import { guideFor, guidePatternFor, guidePatternIds } from '@/lib/exerciseGuides';
import { EXERCISE_LIBRARY } from '@/components/regimens/ExerciseAutocomplete';
import { drawnExercises } from '@/lib/data/exercisePoses';

describe('coverage', () => {
  // The whole point of the module. If this fails, some exercise in the app can
  // be programmed for a user with no way to find out how to do it — which is
  // the exact state this replaced.
  it('gives every exercise in the catalog a guide', () => {
    const missing = EXERCISE_LIBRARY.filter((e) => !guideFor(e.name)).map((e) => e.name);
    expect(missing).toEqual([]);
  });

  it('covers every drawn pose too, so the figure never appears without words', () => {
    const missing = drawnExercises().filter((name) => !guideFor(name));
    expect(missing).toEqual([]);
  });

  it('gives every guide a setup step, at least two more steps, and one warning', () => {
    for (const { name } of EXERCISE_LIBRARY) {
      const guide = guideFor(name);
      expect(guide.steps.length, name).toBeGreaterThanOrEqual(3);
      expect(guide.watch, name).toBeTruthy();
      for (const step of guide.steps) expect(step.length, `${name}: "${step}"`).toBeGreaterThan(20);
    }
  });

  it('leaves no pattern unreachable — an entry nothing resolves to is dead copy', () => {
    const reached = new Set(EXERCISE_LIBRARY.map((e) => guidePatternFor(e.name)));
    const orphans = guidePatternIds().filter((id) => !reached.has(id));
    expect(orphans).toEqual([]);
  });
});

describe('routing', () => {
  // Every one of these resolved to the WRONG movement at some point while this
  // file was being written, and each would have taught someone to do a
  // different exercise from the one on their card. They are the regression
  // suite for pattern ORDER, which is the only thing keeping them honest.
  const ROUTES = {
    'Squat': 'squat',
    'Deadlift': 'deadlift',
    'Snatch Grip Deadlift': 'deadlift',
    'Snatch Grip Behind the Neck Press': 'behind-neck-press',
    'Barbell Hack Squat': 'barbell-hack-squat',
    'Hack Squat Machine': 'squat',
    'Close-Grip Push-Up': 'push-up',
    'Jefferson Curl': 'jefferson-curl',
    'Lying Neck Curl': 'neck',
    'Barbell Wrist Curl': 'wrist-curl',
    'Bodyweight Leg Curl': 'leg-curl',
    'Calf Raise in Leg Press': 'calf-raise',
    'Kettlebell Plank Pull Through': 'plank',
    'Cable Pull Through': 'pull-through',
    'Barbell Rear Delt Row': 'rear-delt',
    'Cable Crossover Bicep Curl': 'curl',
    'Standing Cable Chest Fly': 'fly',
    'Monkey Row': 'upright-row',
    'Rowing Machine': 'row-machine',
    'Smith Machine Incline Bench Press': 'incline-press',
    'Smith Machine Skull Crushers': 'skull-crusher',
    'Standing Glute Push Down': 'glute-kickback',
    'Tricep Pushdown With Rope': 'pushdown',
    'Straight Arm Lat Pulldown': 'straight-arm-pulldown',
    'Hanging Sit-Up': 'hanging-raise',
    'Lying Leg Raise': 'leg-raise',
    'Donkey Calf Raise': 'calf-raise',
    'Donkey Kicks': 'quadruped-glute',
    'Jumping Lunge': 'jump',
    'Squat Jerk': 'jerk',
  };

  for (const [name, id] of Object.entries(ROUTES)) {
    it(`routes ${name} to ${id}`, () => {
      expect(guidePatternFor(name)).toBe(id);
    });
  }
});

describe('setup lines follow the implement', () => {
  // A goblet squat told to "set the bar on your upper back" is worse than no
  // guide at all, and the equipment classifier calls almost every squat in the
  // catalog a barbell — so these come from the pattern's own overrides.
  const setupOf = (name) => guideFor(name).steps[0];

  it('does not put a bar on your back for a goblet squat', () => {
    expect(setupOf('Goblet Squat')).toMatch(/against your chest/i);
    expect(setupOf('Goblet Squat')).not.toMatch(/upper back/i);
  });

  it('hangs the load from a belt for a belt squat', () => {
    expect(setupOf('Belt Squat')).toMatch(/belt around your hips/i);
  });

  it('puts you in a machine for a pendulum squat', () => {
    expect(setupOf('Pendulum Squat')).toMatch(/pads/i);
  });

  it('keeps hands off the bar for a zombie squat', () => {
    expect(setupOf('Zombie Squat')).toMatch(/no hands on the bar/i);
  });

  it('reaches for dumbbells, not a barbell, on a dumbbell deadlift', () => {
    expect(setupOf('Dumbbell Deadlift')).toMatch(/dumbbell outside each foot/i);
  });

  it('flips the grip on a reverse curl', () => {
    expect(setupOf('Reverse Barbell Curl')).toMatch(/overhand/i);
    expect(setupOf('Barbell Curl')).not.toMatch(/overhand/i);
  });

  it('uses a wall for a wall push-up and a bench for an incline one', () => {
    expect(setupOf('Push-Up Against Wall')).toMatch(/wall/i);
    expect(setupOf('Incline Push-Up')).toMatch(/bench or box/i);
  });
});

describe('variants whose movement genuinely differs', () => {
  it('rotates the wrists on a Zottman curl', () => {
    expect(guideFor('Zottman Curl').steps.join(' ')).toMatch(/rotate your wrists/i);
  });

  it('drags the bar and sends the elbows back on a drag curl', () => {
    expect(guideFor('Drag Curl').steps.join(' ')).toMatch(/elbows travel BACK/);
  });

  it('leaves the floor on a clap push-up, and warns about the landing', () => {
    const guide = guideFor('Clap Push-Up');
    expect(guide.steps.join(' ')).toMatch(/hands leave the floor/i);
    expect(guide.watch).toMatch(/landing/i);
  });

  it('keeps the hips DOWN on a cobra push-up, and does not warn about sagging', () => {
    const guide = guideFor('Cobra Push-Up');
    expect(guide.steps.join(' ')).toMatch(/hips stay on the floor/i);
    // The generic push-up warning is "hips sagging", which is the position a
    // cobra push-up is supposed to be in.
    expect(guide.watch).not.toMatch(/sagging/i);
  });
});

describe('junk input', () => {
  it('returns null rather than guessing', () => {
    for (const bad of [null, undefined, '', '   ', 42, {}, 'Kegans Special Lift']) {
      expect(guideFor(bad)).toBeNull();
    }
  });

  it('is case- and whitespace-insensitive', () => {
    expect(guidePatternFor('  BENCH press ')).toBe('bench-press');
  });
});
