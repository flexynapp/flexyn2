// src/lib/aiCoach/workoutGenerator.js
//
// Personalized workout generator. Given parameters (focus, time, equipment,
// experience), creates a balanced 3-7 exercise session with starting weights
// pulled from the user's recent workout history.
//
// Why rule-based: Fitbod charges $79/yr for this. The core logic — pick
// exercises, balance push/pull, scale weights from history, set reasonable
// reps — is deterministic and explainable. Real LLMs would only add flair.

import { db } from '@/api/db';
import { subDays } from 'date-fns';
import { IDENTITY_MODIFIERS } from './trainingModifiers';

// ── Exercise catalog by muscle group, scored by equipment + experience ────

// Each exercise has:
//   name, group, equipment ('gym'|'dumbbells'|'bodyweight'|'minimal'),
//   compound (yes = anchor lift, no = accessory),
//   skillLevel (1=beginner, 2=intermediate, 3=advanced)
//   part (OPTIONAL) — a finer body part, for injury exclusion only.
//
// `part` exists because the injury vocabulary is finer than the catalog's.
// InjuryForm lets someone report Biceps, Triceps or Glutes; this catalog only
// ever had six groups, and `arms` holds three curls next to three triceps
// movements. So `excludeMuscleGroups.has(ex.group)` — the only test there was
// — matched NOTHING for those three body parts, and a logged biceps tear was
// still handed Barbell Curl. Three of the eight areas the form offers were
// inert. Verified against production: of the six injuries on file, one is
// Glutes and one synergist-expands to biceps, so this was live, not
// hypothetical.
//
// Only `arms` and the glute-dominant hinges carry a part: for every other
// exercise the group IS the finest thing we know, and inventing a part there
// would claim precision the catalog does not have.
const CATALOG = [
  // Push
  { name: 'Bench Press',                 group: 'chest',     equipment: 'gym',         compound: true,  skillLevel: 1 },
  { name: 'Incline Dumbbell Press',      group: 'chest',     equipment: 'dumbbells',   compound: true,  skillLevel: 1 },
  { name: 'Push-up',                     group: 'chest',     equipment: 'bodyweight',  compound: true,  skillLevel: 1 },
  { name: 'Dumbbell Fly',                group: 'chest',     equipment: 'dumbbells',   compound: false, skillLevel: 1 },
  { name: 'Cable Crossover',             group: 'chest',     equipment: 'gym',         compound: false, skillLevel: 2 },
  { name: 'Dips',                        group: 'chest',     equipment: 'minimal',     compound: true,  skillLevel: 2 },

  // Pull
  { name: 'Pull-up',                     group: 'back',      equipment: 'minimal',     compound: true,  skillLevel: 2 },
  { name: 'Barbell Row',                 group: 'back',      equipment: 'gym',         compound: true,  skillLevel: 2 },
  { name: 'Dumbbell Row',                group: 'back',      equipment: 'dumbbells',   compound: true,  skillLevel: 1 },
  { name: 'Lat Pulldown',                group: 'back',      equipment: 'gym',         compound: true,  skillLevel: 1 },
  { name: 'Seated Cable Row',            group: 'back',      equipment: 'gym',         compound: true,  skillLevel: 1 },
  { name: 'Inverted Row',                group: 'back',      equipment: 'bodyweight',  compound: true,  skillLevel: 1 },
  { name: 'Face Pull',                   group: 'back',      equipment: 'gym',         compound: false, skillLevel: 1 },

  // Legs
  { name: 'Back Squat',                  group: 'legs',      equipment: 'gym',         compound: true,  skillLevel: 2 },
  { name: 'Front Squat',                 group: 'legs',      equipment: 'gym',         compound: true,  skillLevel: 3 },
  { name: 'Goblet Squat',                group: 'legs',      equipment: 'dumbbells',   compound: true,  skillLevel: 1 },
  { name: 'Bodyweight Squat',            group: 'legs',      equipment: 'bodyweight',  compound: true,  skillLevel: 1 },
  { name: 'Romanian Deadlift',           group: 'legs',      equipment: 'gym',         compound: true,  skillLevel: 2, part: 'glutes' },
  { name: 'Dumbbell Romanian Deadlift',  group: 'legs',      equipment: 'dumbbells',   compound: true,  skillLevel: 1, part: 'glutes' },
  { name: 'Leg Press',                   group: 'legs',      equipment: 'gym',         compound: true,  skillLevel: 1 },
  { name: 'Lunge',                       group: 'legs',      equipment: 'bodyweight',  compound: true,  skillLevel: 1, part: 'glutes' },
  { name: 'Leg Curl',                    group: 'legs',      equipment: 'gym',         compound: false, skillLevel: 1 },
  { name: 'Leg Extension',               group: 'legs',      equipment: 'gym',         compound: false, skillLevel: 1 },
  { name: 'Calf Raise',                  group: 'legs',      equipment: 'bodyweight',  compound: false, skillLevel: 1 },

  // Shoulders
  { name: 'Overhead Press',              group: 'shoulders', equipment: 'gym',         compound: true,  skillLevel: 2 },
  { name: 'Dumbbell Shoulder Press',     group: 'shoulders', equipment: 'dumbbells',   compound: true,  skillLevel: 1 },
  { name: 'Lateral Raise',               group: 'shoulders', equipment: 'dumbbells',   compound: false, skillLevel: 1 },
  { name: 'Pike Push-up',                group: 'shoulders', equipment: 'bodyweight',  compound: true,  skillLevel: 2 },

  // Arms
  { name: 'Barbell Curl',                group: 'arms',      equipment: 'gym',         compound: false, skillLevel: 1, part: 'biceps' },
  { name: 'Dumbbell Curl',               group: 'arms',      equipment: 'dumbbells',   compound: false, skillLevel: 1, part: 'biceps' },
  { name: 'Hammer Curl',                 group: 'arms',      equipment: 'dumbbells',   compound: false, skillLevel: 1, part: 'biceps' },
  { name: 'Tricep Pushdown',             group: 'arms',      equipment: 'gym',         compound: false, skillLevel: 1, part: 'triceps' },
  { name: 'Skull Crusher',               group: 'arms',      equipment: 'gym',         compound: false, skillLevel: 2, part: 'triceps' },
  { name: 'Tricep Dips',                 group: 'arms',      equipment: 'bodyweight',  compound: false, skillLevel: 1, part: 'triceps' },

  // Core
  { name: 'Plank',                       group: 'core',      equipment: 'bodyweight',  compound: false, skillLevel: 1, hold: 45 },
  { name: 'Hanging Leg Raise',           group: 'core',      equipment: 'minimal',     compound: false, skillLevel: 2 },
  { name: 'Cable Crunch',                group: 'core',      equipment: 'gym',         compound: false, skillLevel: 1 },
  { name: 'Russian Twist',               group: 'core',      equipment: 'bodyweight',  compound: false, skillLevel: 1 },
  { name: 'Dead Bug',                    group: 'core',      equipment: 'bodyweight',  compound: false, skillLevel: 1 },
];

// ── Focus → which muscle groups to target ────────────────────────────────────

const FOCUS_TO_GROUPS = {
  full_body: ['legs', 'chest', 'back', 'shoulders', 'core'],
  upper:     ['chest', 'back', 'shoulders', 'arms'],
  lower:     ['legs', 'core'],
  push:      ['chest', 'shoulders', 'arms'],
  pull:      ['back', 'arms'],
  legs:      ['legs', 'core'],
  chest:     ['chest', 'arms'],
  back:      ['back', 'arms'],
  shoulders: ['shoulders', 'arms'],
  arms:      ['arms'],
  core:      ['core'],
};

// Display labels for each focus (keeps FOCUS_OPTIONS readable as the list grows).
const FOCUS_LABELS = {
  full_body: 'Full Body',
  upper:     'Upper Body',
  lower:     'Lower Body',
  push:      'Push',
  pull:      'Pull',
  legs:      'Legs',
  chest:     'Chest',
  back:      'Back',
  shoulders: 'Shoulders',
  arms:      'Arms',
  core:      'Core',
};

// Equipment expansion. 'minimal' means APPARATUS YOU DO NOT OWN — a pull-up
// bar or parallel bars (Pull-up, Dips, Hanging Leg Raise). It used to also
// hold Lunge, Calf Raise and Russian Twist, which need nothing at all, and
// because 'bodyweight' expanded to include 'minimal' so it could reach those
// three, it dragged the bar work along with them. A user who said they had no
// equipment was handed Pull-up. Those three are now tagged 'bodyweight', where
// they always belonged, and 'bodyweight' means exactly that: no equipment.
//
// Do not re-add 'minimal' to the bodyweight set. The whole point is that a
// tag says what a movement NEEDS, not roughly how little it needs.
function _equipmentFilter(level) {
  switch (level) {
    case 'gym':        return new Set(['gym', 'dumbbells', 'minimal', 'bodyweight']);
    case 'dumbbells':  return new Set(['dumbbells', 'minimal', 'bodyweight']);
    case 'bodyweight': return new Set(['bodyweight']);
    case 'minimal':    return new Set(['minimal', 'bodyweight']);
    default:           return new Set(['gym', 'dumbbells', 'minimal', 'bodyweight']);
  }
}

const SKILL_TO_LEVEL = { beginner: 1, intermediate: 2, advanced: 3 };

// Swap candidates offered per exercise. Three is enough to cycle through
// without thinking; the whole session's worth of them also rides along in the
// chat message that gets persisted to localStorage, so the list stays short.
const MAX_ALTERNATIVES = 3;

// ── Pull recent workout history for personalized weights ─────────────────────

// Returns the per-lift top set AND a `_meta` record of what was actually read,
// so the card can show the user which numbers came from their own training
// rather than asserting an unbacked "personalized from your data". A count the
// caller derived by guessing would be exactly the kind of claim this is meant
// to replace. Non-enumerable so it can't be mistaken for a lift named "_meta"
// by anything iterating the map.
function _withMeta(map, meta) {
  Object.defineProperty(map, '_meta', { value: meta, enumerable: false });
  return map;
}

async function _historyByExercise(userEmail, days = 60) {
  if (!userEmail) return _withMeta({}, { logsRead: 0, windowDays: days, latestDate: null });
  const since = subDays(new Date(), days);
  let logs = [];
  try {
    logs = await db.entities.WorkoutLog.filter({ created_by: userEmail }, '-date', 100);
  } catch {
    return _withMeta({}, { logsRead: 0, windowDays: days, latestDate: null });
  }
  logs = (logs || []).filter(w => new Date(w.date) >= since);

  const map = {};
  for (const w of logs) {
    for (const ex of w.exercises || []) {
      const name = ex.name?.trim();
      if (!name) continue;
      const top = (ex.sets || []).reduce((best, s) => {
        const w = Number(s.weight) || 0;
        const r = Number(s.reps) || 0;
        if (w > (best?.weight || 0)) return { weight: w, reps: r };
        return best;
      }, null);
      if (!top) continue;
      const cur = map[name.toLowerCase()];
      if (!cur || (top.weight || 0) > (cur.weight || 0)) {
        map[name.toLowerCase()] = top;
      }
    }
  }
  // logs are already sorted '-date', so the first survivor is the most recent.
  return _withMeta(map, {
    logsRead: logs.length,
    windowDays: days,
    latestDate: logs[0]?.date || null,
  });
}

// ── Bodyweight default starting weights (lbs) for compound lifts ─────────────

// Muscle groups that are driven by the lower body. The sex difference in
// strength is much larger in the upper body than the lower, so the two get
// separate scaling rather than one blanket number.
const LOWER_BODY_GROUPS = new Set(['legs']);

/**
 * Scale the bodyweight multipliers below by onboarding demographics.
 *
 * The multiplier table was calibrated against male norms and applied to every
 * user, so a 60-year-old woman and a 25-year-old man of the same bodyweight
 * were handed the same first-set weight. Sex and age are the two demographic
 * factors with the largest, best-documented effect on absolute strength, so
 * they scale it here.
 *
 *   Sex   — female upper-body strength sits around 50-60% of male at matched
 *           bodyweight, and lower-body around 65-75%; the gap is much smaller
 *           in the legs. 'other' / unset takes a conservative middle value
 *           rather than defaulting to male, because over-prescribing a first
 *           working set is the harmful direction.
 *   Age   — strength holds roughly flat to ~40, then declines gradually, and
 *           faster past 60.
 *   Activity — a light nudge from the nutrition onboarding's activity level;
 *           sedentary users start lower.
 *
 * These are STARTING estimates, only used when the user has no history for a
 * lift. The first logged set replaces them, so the bias is deliberately
 * toward too light — an easy first set costs one warm-up, a heavy one can
 * cost an injury.
 */
export function _demographicScale({ gender, age, activityLevel } = {}) {
  const g = String(gender || '').toLowerCase();
  let upper, lower;
  if (g === 'male')        { upper = 1.00; lower = 1.00; }
  else if (g === 'female') { upper = 0.55; lower = 0.72; }
  else                     { upper = 0.75; lower = 0.85; } // 'other' / unset

  const a = Number(age);
  let ageFactor = 1;
  if (Number.isFinite(a)) {
    if (a > 60)      ageFactor = Math.max(0.60, 0.90 - (a - 60) * 0.01);
    else if (a > 40) ageFactor = 1 - (a - 40) * 0.005;
  }

  const ACTIVITY = { sedentary: 0.90, light: 0.95, moderate: 1.00, very: 1.05, extra: 1.10 };
  const actFactor = ACTIVITY[String(activityLevel || '').toLowerCase()] ?? 1;

  return {
    upper: upper * ageFactor * actFactor,
    lower: lower * ageFactor * actFactor,
  };
}

function _defaultStartingWeight(exerciseName, bodyweightLbs, skillLevel, group, scale) {
  const bw = bodyweightLbs || 165; // demographic default
  const lvl = SKILL_TO_LEVEL[skillLevel] || 1;
  // Multipliers: rough industry guidance for first-rep weights
  const multipliers = {
    'Back Squat':                 [0.6, 0.9, 1.3],
    'Front Squat':                [0.5, 0.8, 1.1],
    'Goblet Squat':               [0.2, 0.3, 0.4],
    'Bodyweight Squat':           [0,   0,   0],
    'Romanian Deadlift':          [0.6, 1.0, 1.4],
    'Dumbbell Romanian Deadlift': [0.3, 0.5, 0.7],
    'Leg Press':                  [1.0, 1.6, 2.4],
    'Bench Press':                [0.5, 0.8, 1.1],
    'Incline Dumbbell Press':     [0.2, 0.35, 0.5],
    'Push-up':                    [0,   0,   0],
    'Dips':                       [0,   0,   0],
    'Pull-up':                    [0,   0,   0],
    'Inverted Row':               [0,   0,   0],
    'Barbell Row':                [0.5, 0.8, 1.1],
    'Dumbbell Row':               [0.2, 0.35, 0.5],
    'Lat Pulldown':               [0.4, 0.65, 0.9],
    'Seated Cable Row':           [0.4, 0.65, 0.9],
    'Overhead Press':             [0.35, 0.55, 0.8],
    'Dumbbell Shoulder Press':    [0.15, 0.25, 0.35],
    'Pike Push-up':               [0,   0,   0],
    'Lateral Raise':              [0.05, 0.08, 0.12],
    'Barbell Curl':               [0.2, 0.35, 0.5],
    'Dumbbell Curl':              [0.1, 0.15, 0.2],
    'Hammer Curl':                [0.1, 0.15, 0.2],
    'Tricep Pushdown':            [0.2, 0.35, 0.5],
    'Skull Crusher':              [0.15, 0.25, 0.35],
    'Tricep Dips':                [0,   0,   0],
    'Calf Raise':                 [0.3, 0.5, 0.7],
    'Leg Curl':                   [0.25, 0.4, 0.55],
    'Leg Extension':              [0.25, 0.4, 0.55],
    'Cable Crossover':            [0.15, 0.25, 0.35],
    'Dumbbell Fly':               [0.1, 0.15, 0.2],
    'Face Pull':                  [0.15, 0.25, 0.35],
    'Lunge':                      [0,   0.15, 0.25],
    'Hanging Leg Raise':          [0,   0,   0],
    'Cable Crunch':               [0.2, 0.3, 0.45],
    'Russian Twist':              [0,   0.05, 0.1],
    'Dead Bug':                   [0,   0,   0],
    'Plank':                      [0,   0,   0],
  };
  const mult = multipliers[exerciseName]?.[lvl - 1] ?? 0;
  // Round to 5 lb increments (or to nothing if 0)
  if (mult === 0) return 0;
  // Bodyweight movements stay at 0 above; everything else scales by the
  // demographic factor for that half of the body.
  const s = scale || { upper: 1, lower: 1 };
  const factor = LOWER_BODY_GROUPS.has(String(group || '').toLowerCase()) ? s.lower : s.upper;
  return Math.max(5, Math.round((bw * mult * factor) / 5) * 5);
}

// ── Main generator ───────────────────────────────────────────────────────────

/**
 * Generate a workout. Returns:
 *   {
 *     title:    string,
 *     focus:    one of FOCUS_TO_GROUPS keys,
 *     duration_minutes: number,
 *     exercises: [
 *       {
 *         name: string,
 *         group: string,
 *         sets: [{ weight, reps }, ...],
 *         restSec: number,
 *         note: string,
 *       },
 *       ...
 *     ],
 *   }
 */
/**
 * Generate a comeback session using exercises the user has done before,
 * scaled to 65% of their historical average.
 * Only called from ComebackScreen — not exported to the generator modal.
 * Signature kept compatible with startFromGeneratedWorkout() in Workout.jsx.
 */
export async function generateComebackWorkout({ user, bodyweightLbs = 165 }) {
  const history = await _historyByExercise(user?.email, 60);
  if (Object.keys(history).length === 0) return null;

  const SCALE = 0.65;
  // Top 5 most-frequently-seen exercises (proxy: any that appear in history)
  const entries = Object.entries(history).slice(0, 5);
  const exercises = entries.map(([name, top]) => {
    const scaledWeight = Math.max(0, Math.round((top.weight * SCALE) / 5) * 5);
    const scaledReps   = Math.max(8, top.reps);
    const catalogEntry = CATALOG.find(c => c.name.toLowerCase() === name.toLowerCase());
    const group = catalogEntry?.group || 'full_body';
    return {
      name: catalogEntry?.name || name,
      group,
      sets: [
        { weight: scaledWeight, reps: scaledReps },
        { weight: scaledWeight, reps: scaledReps },
        { weight: scaledWeight, reps: scaledReps },
      ],
      restSec: 90,
      comeback: true,
      note: `Last hit: ${top.weight} lb × ${top.reps}. Today: 65%.`,
    };
  });

  const weekLabel = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return {
    title: `Comeback Session — Week of ${weekLabel}`,
    focus: 'full_body',
    duration_minutes: 45,
    exercises,
  };
}

export async function generateWorkout({
  user,
  focus = 'full_body',
  durationMinutes = 45,
  equipment = 'gym',
  skillLevel = 'intermediate',
  bodyweightLbs = 165,
  excludeMuscleGroups = new Set(), // injury exclusions
  // Onboarding demographics — { gender, age, activityLevel }. Used only to
  // size the FIRST suggested weight on a lift with no history.
  demographics = null,
  // Context nudges from buildTrainingModifiers() — goal, diet, cycle phase,
  // daily feel check-in. Defaults to identity, so every existing caller that
  // doesn't pass this gets exactly the workout it got before.
  modifiers = IDENTITY_MODIFIERS,
}) {
  const groups = FOCUS_TO_GROUPS[focus] || FOCUS_TO_GROUPS.full_body;
  const equipSet = _equipmentFilter(equipment);
  const maxSkill = SKILL_TO_LEVEL[skillLevel] || 2;

  // Pull recent top-set weights for personalization
  const history = await _historyByExercise(user?.email, 60);

  // Filter catalog by equipment + skill + injury exclusions.
  //
  // Both `group` and `part` are tested. The group alone left Biceps, Triceps
  // and Glutes injuries with no effect at all, because no catalog entry has
  // ever carried those as its group — see the `part` note on CATALOG.
  const eligible = CATALOG.filter(ex =>
    equipSet.has(ex.equipment) &&
    ex.skillLevel <= maxSkill &&
    !excludeMuscleGroups.has(ex.group?.toLowerCase()) &&
    !excludeMuscleGroups.has(ex.part?.toLowerCase())
  );

  // Decide how many exercises based on duration:
  //   30 min → 4 exercises
  //   45 min → 5 exercises
  //   60 min → 6 exercises
  //   90 min → 7 exercises
  const exCount = Math.max(3, Math.min(7,
    durationMinutes <= 30 ? 4 :
    durationMinutes <= 45 ? 5 :
    durationMinutes <= 60 ? 6 : 7
  ));

  // Pick exercises: at least one compound per primary group, then accessories.
  const chosen = [];
  const usedNames = new Set();

  // Pass 1: one compound per group
  for (const group of groups) {
    if (chosen.length >= exCount) break;
    const pool = eligible.filter(ex => ex.group === group && ex.compound && !usedNames.has(ex.name));
    if (pool.length === 0) continue;
    // Prefer exercises the user has done before (familiarity = better warm-up)
    pool.sort((a, b) => {
      const aSeen = history[a.name.toLowerCase()] ? 1 : 0;
      const bSeen = history[b.name.toLowerCase()] ? 1 : 0;
      return bSeen - aSeen;
    });
    chosen.push(pool[0]);
    usedNames.add(pool[0].name);
  }

  // Pass 2: fill remaining slots with accessories (or more compounds if room)
  while (chosen.length < exCount) {
    const remaining = eligible.filter(ex =>
      groups.includes(ex.group) && !usedNames.has(ex.name)
    );
    if (remaining.length === 0) break;
    // Bias toward groups not yet hit twice
    const groupCount = {};
    for (const ex of chosen) groupCount[ex.group] = (groupCount[ex.group] || 0) + 1;
    remaining.sort((a, b) => (groupCount[a.group] || 0) - (groupCount[b.group] || 0));
    chosen.push(remaining[0]);
    usedNames.add(remaining[0].name);
  }

  // Build sets per exercise: 3 sets compound, 3 sets accessory; 8 reps
  // (compound) or 12 reps (accessory). Weight from history if available, else
  // default starting weight by skill level + bodyweight.
  const mods = { ...IDENTITY_MODIFIERS, ...(modifiers || {}) };
  const scale = _demographicScale(demographics || {});

  // One exercise, fully costed — sets, history-aware load, rest and the note
  // explaining where the number came from. Factored out of the map below so a
  // SWAP CANDIDATE gets byte-identical treatment to a chosen exercise: same
  // history lookup, same demographic sizing, same modifier nudges. A candidate
  // built by a second, similar-looking code path would drift from the session
  // it's offered inside, and the drift would show up as a suspiciously heavy
  // or light suggestion the moment someone used it.
  const buildExercise = (ex) => {
    // Volume: the diet / feel nudge adds or removes a working set, floored at
    // 2 so a "rough day" session is still a real session rather than a token.
    const setCount = Math.max(2, Math.min(5, 3 + mods.setsDelta));
    // Reps: goal drives the character (strength lower, cut/endurance higher).
    //
    // An isometric hold is not scored this way and never was — a plank has no
    // rep. It was landing here as `compound: false` and coming out "3 × 12",
    // which is not a hard prescription, it is a missing unit. starterRegimen
    // already knew this ("cardio + breath-heavy exercises don't take a literal
    // rep target") and worked around it with a high placeholder; this catalog
    // never learned, so the two generators disagreed about the same exercise.
    //
    // `hold` is the prescription in SECONDS. It rides alongside reps rather
    // than replacing it: 79 non-test files read `set.reps`, and a hold still
    // has weight 0 so it contributes 0 volume exactly as before. Only the
    // surfaces that should say "45s" need to know the field exists.
    const isHold = Number.isFinite(ex.hold) && ex.hold > 0;
    const baseReps = ex.compound ? 8 : 12;
    const reps = isHold ? 1 : Math.max(3, Math.min(20, baseReps + mods.repDelta));
    // Same clamp philosophy as everything else here: the diet / feel nudge
    // moves the hold, bounded, rather than compounding into a 3-minute plank.
    const holdSeconds = isHold
      ? Math.max(15, Math.min(120, ex.hold + (mods.repDelta * 5)))
      : null;

    const histTop = history[ex.name.toLowerCase()];
    let weight = histTop?.weight
      ?? _defaultStartingWeight(ex.name, bodyweightLbs, skillLevel, ex.group, scale);
    // If history reps were lower than target, scale weight down a bit
    if (histTop && histTop.reps < reps) {
      weight = Math.round((weight * 0.9) / 5) * 5;
    }
    // Load nudge last, so it applies to whatever the history logic settled on.
    // Re-rounded to 5 lb so the suggestion is loadable on a real bar; a
    // bodyweight movement (weight 0) stays 0 rather than becoming 5.
    if (weight > 0 && mods.loadMultiplier !== 1) {
      weight = Math.max(5, Math.round((weight * mods.loadMultiplier) / 5) * 5);
    }
    // `holdSeconds` is only present on a hold, so a consumer that has never
    // heard of it sees the same { weight, reps } shape it always has.
    const sets = Array.from({ length: setCount }, () => (
      isHold ? { weight, reps, holdSeconds } : { weight, reps }
    ));

    let note = '';
    if (isHold) note = `Hold for ${holdSeconds}s per set — stop the set when form breaks, not when the clock does.`;
    else if (histTop) note = `Last hit: ${histTop.weight} lb × ${histTop.reps}.`;
    else if (weight > 0) note = `Suggested start from your bodyweight, experience and demographics — adjust on your first set.`;
    else note = 'Bodyweight only.';

    const baseRest = ex.compound ? 120 : 75;

    return {
      name:    ex.name,
      group:   ex.group,
      sets,
      // Hoisted to the exercise as well as onto each set: the plan card reads
      // the exercise to render "3 × 45s" without inspecting set internals.
      ...(isHold ? { isHold: true, holdSeconds } : {}),
      restSec: Math.max(30, Math.min(240, baseRest + mods.restDeltaSec)),
      note,
      // Where this weight came from, as structured data rather than only as
      // the human-readable `note`. The evidence panel derives its summary from
      // these, so a session that is later edited in the chat card — an
      // exercise swapped or dropped — still describes itself accurately
      // instead of citing a lift that is no longer in it.
      seededFrom: histTop ? 'history' : (weight > 0 ? 'estimate' : 'bodyweight'),
      historyTop: histTop ? { weight: histTop.weight, reps: histTop.reps } : null,
    };
  };

  // ── Swap candidates ───────────────────────────────────────────────────────
  //
  // Precomputed here rather than in the UI, because picking a replacement
  // needs the catalog, the equipment and skill filters, the injury exclusions,
  // the user's lift history and their demographics — all of which are in scope
  // in this function and none of which belong in a chat card. The card just
  // cycles through a list.
  //
  // Same muscle group only: swapping the leg movement for a curl silently
  // changes what the session trains. Ordered so a compound offers compounds
  // first (a swap should keep the session's character), then by whether the
  // user has actually done the lift before, which is the same familiarity
  // preference the primary selection pass uses.
  const alternativesFor = (ex) => eligible
    .filter(alt => alt.group === ex.group && !usedNames.has(alt.name))
    .sort((a, b) => {
      const shape = Number(b.compound === ex.compound) - Number(a.compound === ex.compound);
      if (shape !== 0) return shape;
      return Number(!!history[b.name.toLowerCase()]) - Number(!!history[a.name.toLowerCase()]);
    })
    .slice(0, MAX_ALTERNATIVES)
    .map(buildExercise);

  const exercises = chosen.map(ex => ({
    ...buildExercise(ex),
    alternatives: alternativesFor(ex),
  }));

  // ── What this session was actually built from ─────────────────────────────
  //
  // The coach's tagline claims "personalized advice from your data" and until
  // now never showed which data. Dietvorst et al. (2015) documented algorithm
  // aversion: people abandon an algorithm permanently after seeing it err once,
  // far faster than they'd abandon a human. The mitigation is transparency plus
  // correctability — a wrong number the user can trace to a stale log reads as
  // bad input they can fix, where the same number unexplained reads as a coach
  // that doesn't know what it's doing.
  //
  // Every field here is measured, never inferred. `seededFromHistory` lists the
  // lifts whose weight came from a real logged set, with that set's numbers, so
  // the claim is checkable against the user's own log rather than asserted.
  const historyMeta = history._meta || { logsRead: 0, windowDays: 60, latestDate: null };

  return {
    title:            `${FOCUS_LABELS[focus] || 'Workout'} · ${durationMinutes} min`,
    focus,
    duration_minutes: durationMinutes,
    exercises,
    evidence: {
      logsRead:          historyMeta.logsRead,
      historyWindowDays: historyMeta.windowDays,
      latestLogDate:     historyMeta.latestDate,
      // Everything below is an INPUT the user can go change, which is the
      // other half of the point: the panel doubles as a list of the settings
      // that produced this, so a wrong session has an obvious next action.
      equipment,
      skillLevel,
      bodyweightLbs,
      demographics: demographics
        ? {
            gender:        demographics.gender || null,
            age:           demographics.age ?? null,
            activityLevel: demographics.activityLevel || null,
          }
        : null,
      excludedGroups: [...(excludeMuscleGroups || [])],
      modifiersApplied: mods.applied || null,
    },
    // Why this session looks the way it does. The UI renders these under the
    // workout so an adjustment is never silent — a user who suddenly gets a
    // lighter day can see it was the deficit, the phase, or their own check-in.
    coachNotes: mods.notes || [],
    modifiersApplied: mods.applied || null,
  };
}

/**
 * What an injury actually COSTS — the exercises it removes from every session
 * this generator builds, and the groups that survive.
 *
 * This exists so the Injuries screen can state the consequence instead of
 * echoing the label back. "Shoulders · serious" is a receipt for something the
 * user already knows; "8 exercises are out of your sessions" is the fact that
 * exists nowhere else in the app, and naming the lifts is the only way someone
 * can catch a mis-tap before it quietly reshapes a month of training.
 *
 * Derived from the SAME catalog and the SAME group/part test `generateWorkout`
 * filters on, so the number on screen cannot drift from the number of lifts
 * actually withheld. Equipment and skill are deliberately NOT applied: this
 * answers "what does this injury cost me", not "what does it cost me today at
 * this gym", and folding those in would make the figure move for reasons that
 * have nothing to do with the injury.
 *
 * @param {Set<string>|string[]} excludeMuscleGroups from getExcludedMuscleGroups()
 * @returns {{ removed: string[], removedCount: number, remainingGroups: string[], catalogSize: number }}
 */
export function injuryImpact(excludeMuscleGroups = new Set()) {
  const excluded = excludeMuscleGroups instanceof Set
    ? excludeMuscleGroups
    : new Set(excludeMuscleGroups || []);
  const hit = (ex) =>
    excluded.has(ex.group?.toLowerCase()) || excluded.has(ex.part?.toLowerCase());

  const removed = CATALOG.filter(hit).map(ex => ex.name);
  const remainingGroups = [...new Set(CATALOG.filter(ex => !hit(ex)).map(ex => ex.group))];

  return {
    removed,
    removedCount: removed.length,
    remainingGroups,
    catalogSize: CATALOG.length,
  };
}

export const FOCUS_OPTIONS = Object.keys(FOCUS_TO_GROUPS).map(id => ({
  id,
  label: FOCUS_LABELS[id] || id,
}));

export const EQUIPMENT_OPTIONS = [
  { id: 'gym',         label: 'Full gym' },
  { id: 'dumbbells',   label: 'Dumbbells only' },
  { id: 'minimal',     label: 'Minimal (band, bench)' },
  { id: 'bodyweight',  label: 'Bodyweight only' },
];

export const DURATION_OPTIONS = [
  { id: 30, label: '30 min' },
  { id: 45, label: '45 min' },
  { id: 60, label: '60 min' },
  { id: 90, label: '90 min' },
];

export const SKILL_OPTIONS = [
  { id: 'beginner',     label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced',     label: 'Advanced' },
];
