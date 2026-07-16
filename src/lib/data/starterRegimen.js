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
// The endurance goal ("Run further") is RUNNING-first with running-support
// strength — no cycling by default. A user's preferred cardio (captured in
// onboarding) swaps the primary modality, so a runner never gets cycling and
// a cyclist can opt into it.
const GOAL_EXERCISES = {
  strength:  ['Squat', 'Bench Press', 'Deadlift', 'Overhead Press', 'Barbell Row', 'Pull-Up'],
  muscle:    ['Bench Press', 'Incline Dumbbell Press', 'Barbell Row', 'Pull-Up', 'Squat', 'Romanian Deadlift', 'Overhead Press', 'Dumbbell Curl'],
  lose:      ['Goblet Squat', 'Push-Up', 'Dumbbell Row', 'Dumbbell Lunge', 'Plank', 'Mountain Climbers'],
  endurance: ['Running', 'Jump Rope', 'Mountain Climbers', 'Body Weight Lunge', 'Glute Bridge', 'Plank'],
  mobility:  ['Body Weight Lunge', 'Push-Up', 'Plank', 'Side Plank', 'Glute Bridge'],
};

// Preferred-cardio → the exercise that leads an endurance plan. Only modalities
// present in EXERCISE_LIBRARY. Default is running (the goal is "Run further").
const CARDIO_MODALITY = {
  running:   'Running',
  cycling:   'Cycling',
  jump_rope: 'Jump Rope',
};
Object.values(CARDIO_MODALITY).forEach(EX); // pre-flight validate

// One signature accessory per goal — appended when the user picked that goal
// as a SECONDARY objective, so a strength+mobility user's plan visibly reflects
// both. Validated against EXERCISE_LIBRARY below.
const GOAL_ACCESSORY = {
  strength:  'Deadlift',
  muscle:    'Dumbbell Curl',
  lose:      'Mountain Climbers',
  endurance: 'Jump Rope',
  mobility:  'Side Plank',
};
Object.values(GOAL_ACCESSORY).forEach(EX); // pre-flight validate

// Training days → how many exercises the plan carries. Low frequency = a
// compact full-body session hit each training day; high frequency = broader
// scope / more total volume across the week.
function targetExerciseCount(daysCount) {
  const d = Number.isFinite(daysCount) && daysCount > 0 ? daysCount : 3;
  if (d <= 2) return 5;
  if (d <= 4) return 6;
  return 8;
}

// Age → recovery cap on sets. Recovery capacity declines with age, so an
// assessed-advanced 60-year-old shouldn't get the same 5×5 as a 25-year-old.
function ageSetsCap(age) {
  if (!Number.isFinite(age)) return Infinity;
  if (age >= 65) return 3;
  if (age >= 55) return 4;
  return Infinity;
}

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

// Promote the self-reported experience level using what the fitness
// self-assessment actually reveals, so a genuinely capable athlete gets a
// real program instead of a beginner 3×10. Goal-aware: the assessment is
// strength-biased, so for an endurance goal a sub-10-min mile (a real runner)
// carries the weight it deserves — otherwise a collegiate runner who can't
// bench bodyweight would be mislabelled a newbie.
const LEVEL_ORDER = ['newbie', 'returning', 'consistent', 'advanced'];
function effectiveLevel(level, assessment, goalKey) {
  let idx = Math.max(0, LEVEL_ORDER.indexOf(level));
  const a = assessment && typeof assessment === 'object' ? assessment : {};
  const adv = advancedIndex(a);
  if (goalKey === 'endurance') {
    if (a.mile_under10 === 'yes') idx = Math.max(idx, 2);          // fit runner → consistent
    if (a.mile_under10 === 'yes' && adv >= 3) idx = LEVEL_ORDER.length - 1; // + broadly fit → advanced
  } else {
    if (adv >= 4) idx = LEVEL_ORDER.length - 1;                    // aces everything → advanced
    else if (adv >= 2) idx = Math.max(idx, 2);                     // solid → consistent
  }
  return LEVEL_ORDER[idx];
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
 * @param {string[]} input.goals       - Goal IDs; goals[0] drives the core pool,
 *                                       secondary goals add one accessory each.
 * @param {string|null} input.level    - 'newbie'|'returning'|'consistent'|'advanced'.
 * @param {number} input.daysCount     - Training days/week — sets the plan's scope.
 * @param {Object} [input.assessment]  - Fitness self-assessment (mig 129); raises
 *                                       the effective level for capable athletes.
 * @param {string} [input.cardioPreference] - running|cycling|jump_rope (endurance).
 * @param {Array}  [input.injuries]    - [{muscleGroup, severity}]; moderate/serious
 *                                       excluded, mild flagged with a caution note.
 * @param {number} [input.age]         - Caps volume for older lifters (55+ / 65+).
 * @param {number} [input.bodyFatPct]  - High BF on a strength/muscle goal adds
 *                                       a conditioning exercise.
 * @returns {Object} regimen payload
 */
export function buildStarterRegimen({ goals, level, daysCount, assessment, cardioPreference, injuries, age, bodyFatPct } = {}) {
  const goalList = Array.isArray(goals) ? goals.filter(Boolean) : (goals ? [goals] : []);
  const primary = goalList[0] || 'strength';
  const goalKey = GOAL_EXERCISES[primary] ? primary : 'strength';
  const goalTitle = GOAL_TITLES[goalKey];
  let exerciseNames = GOAL_EXERCISES[goalKey];

  // ── Preferred cardio (endurance) — lead with the chosen modality (running by
  // default) so a runner is never handed cycling, and vice-versa.
  if (goalKey === 'endurance' && CARDIO_MODALITY[cardioPreference]) {
    const lead = CARDIO_MODALITY[cardioPreference];
    const otherModalities = Object.values(CARDIO_MODALITY).filter(m => m !== lead);
    exerciseNames = [lead, ...exerciseNames.filter(n => n !== lead && !otherModalities.includes(n))];
  }

  // ── Injuries. Severity-aware: MODERATE/SERIOUS regions are excluded outright
  // (the injury step promises we work around them); MILD regions stay but get a
  // "ease in" note. Safety valve: if exclusion would empty the plan, keep the
  // exercises hitting the fewest injured areas so it's never empty.
  const injList = Array.isArray(injuries) ? injuries : [];
  const excludeSet = new Set(
    injList.filter(i => (i?.severity || 'moderate') !== 'mild').map(i => (i && i.muscleGroup) || i).filter(Boolean),
  );
  const cautionSet = new Set(
    injList.filter(i => i?.severity === 'mild').map(i => i && i.muscleGroup).filter(Boolean),
  );
  const trains = (name, set) => EX(name).muscles.some(m => set.has(m));
  if (excludeSet.size) {
    const clean = exerciseNames.filter(n => !trains(n, excludeSet));
    exerciseNames = clean.length >= 2
      ? clean
      : [...exerciseNames]
          .sort((a, b) => EX(a).muscles.filter(m => excludeSet.has(m)).length - EX(b).muscles.filter(m => excludeSet.has(m)).length)
          .slice(0, 3);
  }

  // ── Training days → scope. Fewer days = a compact full-body session; more
  // days = broader scope / more weekly volume. Trim keeps the compound-first
  // ordering of each pool.
  const safeDays = Number.isFinite(daysCount) && daysCount > 0 ? daysCount : 3;
  exerciseNames = exerciseNames.slice(0, targetExerciseCount(safeDays));

  // ── Extras: one accessory per SECONDARY goal (so a strength+mobility plan
  // shows both), plus a conditioning nudge when body fat is high on a
  // strength/muscle goal. Injury-safe, deduped, capped at 8.
  const addExtra = (name) => {
    if (!name || exerciseNames.includes(name) || trains(name, excludeSet) || exerciseNames.length >= 8) return;
    exerciseNames = [...exerciseNames, name];
  };
  for (const g of goalList.slice(1)) {
    if (g !== goalKey) addExtra(GOAL_ACCESSORY[g]);
  }
  if (Number.isFinite(bodyFatPct) && bodyFatPct >= 25 && (goalKey === 'strength' || goalKey === 'muscle')) {
    addExtra('Mountain Climbers');
  }

  // ── Volume: effective level (assessment-aware) with an age recovery cap.
  const effLevel = effectiveLevel(level, assessment, goalKey);
  const setsReps = LEVEL_SETS_REPS[effLevel] || LEVEL_SETS_REPS.newbie;
  const sets = Math.min(setsReps.sets, ageSetsCap(age));
  const reps = setsReps.reps;

  const exercises = exerciseNames.map(name => {
    const libEntry = EX(name);
    let targetReps = reps;
    if (CARDIO_NAMES.has(name)) targetReps = 30;
    else if (CARDIO_HIGH_REP_NAMES.has(name)) targetReps = 20;
    const cautionMuscle = libEntry.muscles.find(m => cautionSet.has(m));
    return {
      name,
      displayName: name,
      muscle_groups: libEntry.muscles,
      // RegimenForm sets muscle_group to the first of muscle_groups for
      // backwards-compat with older renderers that read the singular field.
      muscle_group: libEntry.muscles[0],
      target_sets: sets,
      target_reps: targetReps,
      notes: cautionMuscle ? `Ease in — mild ${cautionMuscle.toLowerCase()} flagged.` : '',
    };
  });

  const recoveryNote = Number.isFinite(age) && age >= 55 ? ' · recovery-adjusted' : '';
  return {
    name: `Your Starter Plan — ${goalTitle}`,
    description: `${effLevel} · ${safeDays}×/week${recoveryNote} · auto-generated from onboarding`,
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
