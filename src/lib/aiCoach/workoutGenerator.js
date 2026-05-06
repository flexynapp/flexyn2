// src/lib/aiCoach/workoutGenerator.js
//
// Personalized workout generator. Given parameters (focus, time, equipment,
// experience), creates a balanced 3-7 exercise session with starting weights
// pulled from the user's recent workout history.
//
// Why rule-based: Fitbod charges $79/yr for this. The core logic — pick
// exercises, balance push/pull, scale weights from history, set reasonable
// reps — is deterministic and explainable. Real LLMs would only add flair.

import { base44 } from '@/api/base44Client';
import { subDays } from 'date-fns';

// ── Exercise catalog by muscle group, scored by equipment + experience ────

// Each exercise has:
//   name, group, equipment ('gym'|'dumbbells'|'bodyweight'|'minimal'),
//   compound (yes = anchor lift, no = accessory),
//   skillLevel (1=beginner, 2=intermediate, 3=advanced)
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
  { name: 'Romanian Deadlift',           group: 'legs',      equipment: 'gym',         compound: true,  skillLevel: 2 },
  { name: 'Dumbbell Romanian Deadlift',  group: 'legs',      equipment: 'dumbbells',   compound: true,  skillLevel: 1 },
  { name: 'Leg Press',                   group: 'legs',      equipment: 'gym',         compound: true,  skillLevel: 1 },
  { name: 'Lunge',                       group: 'legs',      equipment: 'minimal',     compound: true,  skillLevel: 1 },
  { name: 'Leg Curl',                    group: 'legs',      equipment: 'gym',         compound: false, skillLevel: 1 },
  { name: 'Leg Extension',               group: 'legs',      equipment: 'gym',         compound: false, skillLevel: 1 },
  { name: 'Calf Raise',                  group: 'legs',      equipment: 'minimal',     compound: false, skillLevel: 1 },

  // Shoulders
  { name: 'Overhead Press',              group: 'shoulders', equipment: 'gym',         compound: true,  skillLevel: 2 },
  { name: 'Dumbbell Shoulder Press',     group: 'shoulders', equipment: 'dumbbells',   compound: true,  skillLevel: 1 },
  { name: 'Lateral Raise',               group: 'shoulders', equipment: 'dumbbells',   compound: false, skillLevel: 1 },
  { name: 'Pike Push-up',                group: 'shoulders', equipment: 'bodyweight',  compound: true,  skillLevel: 2 },

  // Arms
  { name: 'Barbell Curl',                group: 'arms',      equipment: 'gym',         compound: false, skillLevel: 1 },
  { name: 'Dumbbell Curl',               group: 'arms',      equipment: 'dumbbells',   compound: false, skillLevel: 1 },
  { name: 'Hammer Curl',                 group: 'arms',      equipment: 'dumbbells',   compound: false, skillLevel: 1 },
  { name: 'Tricep Pushdown',             group: 'arms',      equipment: 'gym',         compound: false, skillLevel: 1 },
  { name: 'Skull Crusher',               group: 'arms',      equipment: 'gym',         compound: false, skillLevel: 2 },
  { name: 'Tricep Dips',                 group: 'arms',      equipment: 'bodyweight',  compound: false, skillLevel: 1 },

  // Core
  { name: 'Plank',                       group: 'core',      equipment: 'bodyweight',  compound: false, skillLevel: 1 },
  { name: 'Hanging Leg Raise',           group: 'core',      equipment: 'minimal',     compound: false, skillLevel: 2 },
  { name: 'Cable Crunch',                group: 'core',      equipment: 'gym',         compound: false, skillLevel: 1 },
  { name: 'Russian Twist',               group: 'core',      equipment: 'minimal',     compound: false, skillLevel: 1 },
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
  core:      ['core'],
};

// Equipment expansion: a user with a "gym" picks gym + dumbbells + minimal +
// bodyweight; a user with "dumbbells" picks dumbbells + minimal + bodyweight;
// "bodyweight" only picks bodyweight + minimal.
function _equipmentFilter(level) {
  switch (level) {
    case 'gym':        return new Set(['gym', 'dumbbells', 'minimal', 'bodyweight']);
    case 'dumbbells':  return new Set(['dumbbells', 'minimal', 'bodyweight']);
    case 'bodyweight': return new Set(['bodyweight', 'minimal']);
    case 'minimal':    return new Set(['minimal', 'bodyweight']);
    default:           return new Set(['gym', 'dumbbells', 'minimal', 'bodyweight']);
  }
}

const SKILL_TO_LEVEL = { beginner: 1, intermediate: 2, advanced: 3 };

// ── Pull recent workout history for personalized weights ─────────────────────

async function _historyByExercise(userEmail, days = 60) {
  if (!userEmail) return {};
  const since = subDays(new Date(), days);
  let logs = [];
  try {
    logs = await base44.entities.WorkoutLog.filter({ created_by: userEmail }, '-date', 100);
  } catch { return {}; }
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
  return map;
}

// ── Bodyweight default starting weights (lbs) for compound lifts ─────────────

function _defaultStartingWeight(exerciseName, bodyweightLbs, skillLevel) {
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
  return Math.max(5, Math.round(bw * mult / 5) * 5);
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
export async function generateWorkout({
  user,
  focus = 'full_body',
  durationMinutes = 45,
  equipment = 'gym',
  skillLevel = 'intermediate',
  bodyweightLbs = 165,
}) {
  const groups = FOCUS_TO_GROUPS[focus] || FOCUS_TO_GROUPS.full_body;
  const equipSet = _equipmentFilter(equipment);
  const maxSkill = SKILL_TO_LEVEL[skillLevel] || 2;

  // Pull recent top-set weights for personalization
  const history = await _historyByExercise(user?.email, 60);

  // Filter catalog by equipment + skill
  const eligible = CATALOG.filter(ex =>
    equipSet.has(ex.equipment) && ex.skillLevel <= maxSkill
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
  const exercises = chosen.map(ex => {
    const setCount = ex.compound ? 3 : 3;
    const reps = ex.compound ? 8 : 12;
    const histTop = history[ex.name.toLowerCase()];
    let weight = histTop?.weight ?? _defaultStartingWeight(ex.name, bodyweightLbs, skillLevel);
    // If history reps were lower than target, scale weight down a bit
    if (histTop && histTop.reps < reps) {
      weight = Math.round((weight * 0.9) / 5) * 5;
    }
    const sets = Array.from({ length: setCount }, () => ({ weight, reps }));

    let note = '';
    if (histTop) note = `Last hit: ${histTop.weight} lb × ${histTop.reps}.`;
    else if (weight > 0) note = `Starting weight from skill/bodyweight estimate.`;
    else note = 'Bodyweight only.';

    return {
      name:    ex.name,
      group:   ex.group,
      sets,
      restSec: ex.compound ? 120 : 75,
      note,
    };
  });

  const titleByFocus = {
    full_body: 'Full Body',
    upper:     'Upper Body',
    lower:     'Lower Body',
    push:      'Push Day',
    pull:      'Pull Day',
    legs:      'Leg Day',
    core:      'Core Focus',
  };

  return {
    title:            `${titleByFocus[focus] || 'Workout'} · ${durationMinutes} min`,
    focus,
    duration_minutes: durationMinutes,
    exercises,
  };
}

export const FOCUS_OPTIONS = Object.keys(FOCUS_TO_GROUPS).map(id => ({
  id,
  label: id === 'full_body' ? 'Full Body'
       : id === 'upper'     ? 'Upper Body'
       : id === 'lower'     ? 'Lower Body'
       : id === 'push'      ? 'Push'
       : id === 'pull'      ? 'Pull'
       : id === 'legs'      ? 'Legs'
       : 'Core',
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
