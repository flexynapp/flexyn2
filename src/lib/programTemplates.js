// src/lib/programTemplates.js
//
// Canonical built-in workout programs that ship with the app.
// Powers the "Start from a proven program" picker — removes the
// blank-slate friction that kills new users who don't know what to
// program.
//
// Each template has:
//   id         slug — stable identifier
//   name       display name
//   level      'beginner' | 'intermediate' | 'advanced'
//   days       sessions per week (sample plan)
//   summary    one-line description
//   tagline    pitch line for the picker card
//   sessions   array of session objects: { name, exercises: [{name, sets, reps_target}] }
//
// When the user picks a template, the client clones it as a new
// regimens row owned by them with is_template=true and template_id=id,
// so they can modify their personal copy without affecting the
// canonical version.

export const PROGRAM_TEMPLATES = [
  // ── Starting Strength ───────────────────────────────────────────────
  {
    id: 'starting_strength',
    name: 'Starting Strength',
    level: 'beginner',
    days: 3,
    summary: 'Mark Rippetoe\'s 3-day linear progression for true beginners.',
    tagline: 'Squat, press, deadlift. Add 5lb per session.',
    sessions: [
      {
        name: 'Workout A',
        exercises: [
          { name: 'Squat',         sets: 3, reps_target: 5 },
          { name: 'Bench Press',   sets: 3, reps_target: 5 },
          { name: 'Deadlift',      sets: 1, reps_target: 5 },
        ],
      },
      {
        name: 'Workout B',
        exercises: [
          { name: 'Squat',         sets: 3, reps_target: 5 },
          { name: 'Overhead Press', sets: 3, reps_target: 5 },
          { name: 'Power Clean',   sets: 5, reps_target: 3 },
        ],
      },
    ],
  },

  // ── 5/3/1 (Wendler) ─────────────────────────────────────────────────
  {
    id: '531',
    name: '5/3/1 (Wendler)',
    level: 'intermediate',
    days: 4,
    summary: '4-week wave loading on the big 4 lifts.',
    tagline: 'Slow, steady, undefeated. Built for the long game.',
    sessions: [
      { name: 'OHP Day',      exercises: [
        { name: 'Overhead Press', sets: 3, reps_target: 5 },
        { name: 'Bench Press',    sets: 5, reps_target: 10 },
        { name: 'Chin-up',        sets: 5, reps_target: 10 },
      ]},
      { name: 'Deadlift Day', exercises: [
        { name: 'Deadlift',       sets: 3, reps_target: 5 },
        { name: 'Romanian Deadlift', sets: 5, reps_target: 10 },
        { name: 'Hanging Leg Raise', sets: 5, reps_target: 15 },
      ]},
      { name: 'Bench Day',    exercises: [
        { name: 'Bench Press',    sets: 3, reps_target: 5 },
        { name: 'Overhead Press', sets: 5, reps_target: 10 },
        { name: 'Barbell Row',    sets: 5, reps_target: 10 },
      ]},
      { name: 'Squat Day',    exercises: [
        { name: 'Squat',          sets: 3, reps_target: 5 },
        { name: 'Front Squat',    sets: 5, reps_target: 10 },
        { name: 'Calf Raise',     sets: 5, reps_target: 15 },
      ]},
    ],
  },

  // ── Push Pull Legs (PPL) ────────────────────────────────────────────
  {
    id: 'ppl',
    name: 'Push / Pull / Legs',
    level: 'intermediate',
    days: 6,
    summary: 'Classic 6-day hypertrophy split.',
    tagline: 'High volume, perfectly balanced. The hypertrophy workhorse.',
    sessions: [
      { name: 'Push', exercises: [
        { name: 'Bench Press',       sets: 4, reps_target: 8 },
        { name: 'Overhead Press',    sets: 4, reps_target: 8 },
        { name: 'Incline Dumbbell Press', sets: 3, reps_target: 12 },
        { name: 'Tricep Pushdown',   sets: 3, reps_target: 12 },
        { name: 'Lateral Raise',     sets: 3, reps_target: 15 },
      ]},
      { name: 'Pull', exercises: [
        { name: 'Barbell Row',       sets: 4, reps_target: 8 },
        { name: 'Pull-up',           sets: 4, reps_target: 8 },
        { name: 'Lat Pulldown',      sets: 3, reps_target: 12 },
        { name: 'Face Pull',         sets: 3, reps_target: 15 },
        { name: 'Bicep Curl',        sets: 3, reps_target: 12 },
      ]},
      { name: 'Legs', exercises: [
        { name: 'Squat',             sets: 4, reps_target: 8 },
        { name: 'Romanian Deadlift', sets: 4, reps_target: 8 },
        { name: 'Leg Press',         sets: 3, reps_target: 12 },
        { name: 'Leg Curl',          sets: 3, reps_target: 12 },
        { name: 'Calf Raise',        sets: 4, reps_target: 15 },
      ]},
    ],
  },

  // ── GZCLP ───────────────────────────────────────────────────────────
  {
    id: 'gzclp',
    name: 'GZCLP',
    level: 'intermediate',
    days: 4,
    summary: 'Cody Lefever\'s GZCL-Linear-Progression for hardgainers.',
    tagline: 'Heavy T1, volume T2, accessory T3. Built for grinders.',
    sessions: [
      { name: 'Squat / Bench', exercises: [
        { name: 'Squat',         sets: 5, reps_target: 3 }, // T1
        { name: 'Bench Press',   sets: 3, reps_target: 10 }, // T2
        { name: 'Lat Pulldown',  sets: 3, reps_target: 15 }, // T3
      ]},
      { name: 'OHP / Deadlift', exercises: [
        { name: 'Overhead Press', sets: 5, reps_target: 3 },
        { name: 'Deadlift',       sets: 3, reps_target: 10 },
        { name: 'Barbell Row',    sets: 3, reps_target: 15 },
      ]},
      { name: 'Bench / Squat', exercises: [
        { name: 'Bench Press',   sets: 5, reps_target: 3 },
        { name: 'Squat',         sets: 3, reps_target: 10 },
        { name: 'Lat Pulldown',  sets: 3, reps_target: 15 },
      ]},
      { name: 'Deadlift / OHP', exercises: [
        { name: 'Deadlift',       sets: 5, reps_target: 3 },
        { name: 'Overhead Press', sets: 3, reps_target: 10 },
        { name: 'Barbell Row',    sets: 3, reps_target: 15 },
      ]},
    ],
  },

  // ── nSuns 5/3/1 LP ──────────────────────────────────────────────────
  {
    id: 'nsuns',
    name: 'nSuns 5/3/1 LP',
    level: 'advanced',
    days: 5,
    summary: 'High-frequency, high-volume modification of 5/3/1.',
    tagline: '9 sets of the main lift per day. Brutal, but it works.',
    sessions: [
      { name: 'Bench / OHP',     exercises: [
        { name: 'Bench Press',    sets: 9, reps_target: 5 },
        { name: 'Overhead Press', sets: 8, reps_target: 5 },
      ]},
      { name: 'Squat / Sumo DL', exercises: [
        { name: 'Squat',          sets: 9, reps_target: 5 },
        { name: 'Sumo Deadlift',  sets: 8, reps_target: 5 },
      ]},
      { name: 'OHP / Incline',   exercises: [
        { name: 'Overhead Press', sets: 9, reps_target: 5 },
        { name: 'Incline Bench Press', sets: 8, reps_target: 5 },
      ]},
      { name: 'Deadlift / Front Squat', exercises: [
        { name: 'Deadlift',       sets: 9, reps_target: 5 },
        { name: 'Front Squat',    sets: 8, reps_target: 5 },
      ]},
      { name: 'Bench / CGBP',    exercises: [
        { name: 'Bench Press',    sets: 9, reps_target: 5 },
        { name: 'Close-Grip Bench Press', sets: 8, reps_target: 5 },
      ]},
    ],
  },

  // ── Upper / Lower ───────────────────────────────────────────────────
  {
    id: 'upper_lower',
    name: 'Upper / Lower',
    level: 'beginner',
    days: 4,
    summary: 'Classic 4-day split, beginner-friendly volume.',
    tagline: 'Two upper days, two lower days. Easy to schedule.',
    sessions: [
      { name: 'Upper A', exercises: [
        { name: 'Bench Press',    sets: 4, reps_target: 6 },
        { name: 'Barbell Row',    sets: 4, reps_target: 6 },
        { name: 'Overhead Press', sets: 3, reps_target: 10 },
        { name: 'Pull-up',        sets: 3, reps_target: 10 },
      ]},
      { name: 'Lower A', exercises: [
        { name: 'Squat',          sets: 4, reps_target: 6 },
        { name: 'Romanian Deadlift', sets: 3, reps_target: 10 },
        { name: 'Leg Curl',       sets: 3, reps_target: 12 },
        { name: 'Calf Raise',     sets: 4, reps_target: 15 },
      ]},
      { name: 'Upper B', exercises: [
        { name: 'Incline Bench Press', sets: 4, reps_target: 8 },
        { name: 'Lat Pulldown',   sets: 4, reps_target: 8 },
        { name: 'Dumbbell Press', sets: 3, reps_target: 12 },
        { name: 'Bicep Curl',     sets: 3, reps_target: 12 },
      ]},
      { name: 'Lower B', exercises: [
        { name: 'Deadlift',       sets: 4, reps_target: 5 },
        { name: 'Front Squat',    sets: 3, reps_target: 10 },
        { name: 'Walking Lunge',  sets: 3, reps_target: 12 },
        { name: 'Hanging Leg Raise', sets: 3, reps_target: 15 },
      ]},
    ],
  },
];

export function findTemplate(id) {
  return PROGRAM_TEMPLATES.find(t => t.id === id) || null;
}
