// src/lib/data/starterRegimen.js
// Generates a real, persisted starter regimen at the end of onboarding so the
// "personalized plan" the Reveal step promises is something the user can
// actually open in Workout → Regimens. Pure logic, no React.
//
// Foolproof properties:
//  - All exercise names are pre-flight-checked against EXERCISE_LIBRARY at
//    module load. A typo throws at import time so CI catches it before users.
//  - Idempotent: ensureStarterRegimen() skips creation if the user already has
//    any regimens, so account-reset re-onboarding never doubles up.
//  - Fire-and-forget at the caller: a regimen-table outage cannot block
//    onboarding completion (Onboarding.jsx wraps the call in .catch()).
//  - Payload shape mirrors RegimenForm exactly, so the regimen renders the
//    same as one a user typed in by hand.

import { db } from '@/api/db';
import { EXERCISE_LIBRARY } from '@/components/regimens/ExerciseAutocomplete';

// Throw-on-typo lookup. Called at module init below for every exercise
// the generator can ever pick.
function EX(name) {
  const found = EXERCISE_LIBRARY.find(e => e.name === name);
  if (!found) {
    throw new Error(`[starterRegimen] Unknown exercise: "${name}" is not in EXERCISE_LIBRARY`);
  }
  return found;
}

// Goal IDs come from GOALS in Onboarding.jsx. Any unknown / missing goal
// falls back to 'strength' — a safe, broadly applicable default.
const GOAL_TITLES = {
  strength:  'Build Strength',
  muscle:    'Add Muscle',
  lose:      'Lose Fat',
  endurance: 'Build Endurance',
  mobility:  'Move Better',
};

// Exercise picks per goal. Verified at module load against EXERCISE_LIBRARY.
const GOAL_EXERCISES = {
  strength:  ['Squat', 'Bench Press', 'Deadlift', 'Overhead Press', 'Barbell Row', 'Pull-Up'],
  muscle:    ['Bench Press', 'Incline Dumbbell Press', 'Barbell Row', 'Pull-Up', 'Squat', 'Romanian Deadlift', 'Overhead Press', 'Dumbbell Curl'],
  lose:      ['Goblet Squat', 'Push-Up', 'Dumbbell Row', 'Dumbbell Lunge', 'Plank', 'Mountain Climbers'],
  endurance: ['Running', 'Cycling', 'Jump Rope', 'Mountain Climbers'],
  mobility:  ['Body Weight Lunge', 'Push-Up', 'Plank', 'Side Plank', 'Glute Bridge'],
};

// Sets/reps by experience level. Newbies and returning lifters share a
// program (3×10) to keep the on-ramp gentle.
const LEVEL_SETS_REPS = {
  newbie:     { sets: 3, reps: 10 },
  returning:  { sets: 3, reps: 10 },
  consistent: { sets: 4, reps: 8  },
  advanced:   { sets: 5, reps: 5  },
};

// Compute an "advanced index" 0..4 from the fitness_assessment blob
// (mig 129). Each 'yes' answer adds 1; 'not_yet' and missing answers
// don't. Used to optionally bump sets +1 across the board (more
// volume) when the user is clearly more advanced than their
// fitness_level alone suggests.
function advancedIndex(assessment) {
  if (!assessment || typeof assessment !== 'object') return 0;
  const keys = ['bench_bw', 'squat_bw15', 'pullups_10', 'mile_under10'];
  let n = 0;
  for (const k of keys) if (assessment[k] === 'yes') n++;
  return n;
}

// Cardio + breath-heavy exercises don't take a literal rep target the way
// barbell lifts do; we set a higher placeholder so the displayed regimen
// reads sensibly ("3 × 30") instead of "3 × 5". Logging is still flexible.
const CARDIO_NAMES = new Set(['Running', 'Cycling', 'Jump Rope', 'Rowing']);
const CARDIO_HIGH_REP_NAMES = new Set(['Mountain Climbers', 'Plank', 'Side Plank']);

// ── Pre-flight: assert every named exercise resolves. Runs at import time. ──
Object.values(GOAL_EXERCISES).forEach(list => list.forEach(EX));

/**
 * Build a deterministic regimen payload from the user's onboarding inputs.
 * Pure function — no I/O. The returned object is ready to hand to
 * `db.entities.Regimen.create()`.
 *
 * @param {Object} input
 * @param {string[]} input.goals       - Array of goal IDs (e.g. ['strength','muscle']).
 * @param {string|null} input.level    - One of 'newbie'|'returning'|'consistent'|'advanced'.
 * @param {number} input.daysCount     - Training days per week (used in description).
 * @param {Object} [input.assessment]  - Optional fitness self-assessment
 *                                       (mig 129). Bumps volume when the
 *                                       user reports advanced lift capacity.
 * @returns {Object} regimen payload
 */
export function buildStarterRegimen({ goals, level, daysCount, assessment } = {}) {
  const primary = (Array.isArray(goals) && goals[0]) ? goals[0] : 'strength';
  const goalKey = GOAL_EXERCISES[primary] ? primary : 'strength';
  const goalTitle = GOAL_TITLES[goalKey];
  const exerciseNames = GOAL_EXERCISES[goalKey];

  const baseSetsReps = LEVEL_SETS_REPS[level] || LEVEL_SETS_REPS.newbie;
  const advIdx = advancedIndex(assessment);
  // 3+ "yes" answers = bump sets by 1 (more volume). 4/4 = bump by 2.
  // Reps stay constant — adding sets is the cleaner volume lever for
  // an automated plan. Never exceed 6 sets per exercise (matches the
  // per-exercise cap in realisticLimits).
  const sets = Math.min(6, baseSetsReps.sets + (advIdx >= 3 ? 1 : 0) + (advIdx >= 4 ? 1 : 0));
  const reps = baseSetsReps.reps;

  const exercises = exerciseNames.map(name => {
    const libEntry = EX(name);
    // Cardio gets a longer "rep" target so the display reads correctly;
    // mountain-climber / plank style get a moderate-high target.
    let targetReps = reps;
    if (CARDIO_NAMES.has(name)) targetReps = 30;
    else if (CARDIO_HIGH_REP_NAMES.has(name)) targetReps = 20;

    return {
      name,
      displayName: name,
      muscle_groups: libEntry.muscles,
      // RegimenForm sets muscle_group to the first of muscle_groups for
      // backwards-compat with older renderers that read the singular field.
      muscle_group: libEntry.muscles[0],
      target_sets: sets,
      target_reps: targetReps,
      notes: '',
    };
  });

  const safeDays = Number.isFinite(daysCount) && daysCount > 0 ? daysCount : 3;

  return {
    name: `Your Starter Plan — ${goalTitle}`,
    description: `${level || 'newbie'} · ${safeDays}×/week · auto-generated from onboarding`,
    exercises,
    is_public: false,
  };
}

/**
 * Idempotently create a starter regimen for a new user.
 *
 * - Skips if the user already has any regimens (handles account-reset
 *   re-onboarding and double-tap race conditions).
 * - Returns the created row, or null if skipped.
 * - Throws on hard DB failure — the caller is expected to .catch() since
 *   this should never block onboarding completion.
 *
 * @param {Object} input
 * @param {Object} input.user                - The authenticated user object (needs .email).
 * @param {Object} input.profile             - { goals, level, daysCount } from onboarding.
 * @returns {Promise<Object|null>}
 */
export async function ensureStarterRegimen({ user, profile } = {}) {
  if (!user?.email) return null;

  // Idempotency: bail if anything is already in this user's regimen list.
  // db.entities.Regimen.filter() returns [] on RLS denial / read failure, so a
  // read hiccup falls through to creation — better than silently no-op'ing.
  let existing = [];
  try {
    existing = await db.entities.Regimen.filter({ created_by: user.email }, '-created_date', 1);
  } catch {
    // Treat read failure as "no regimens"; the create() path has its own
    // strip-and-retry resilience.
  }
  if (existing && existing.length > 0) return null;

  const payload = buildStarterRegimen(profile || {});
  return db.entities.Regimen.create(payload);
}
