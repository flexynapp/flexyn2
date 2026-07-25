// src/lib/aiCoach/planBuilder.js
//
// Turns a free-text training goal ("train for a faster 5K", "help me PR my
// bench", "build muscle", "quick full-body workout today") into a concrete,
// saveable plan the AI Coach can attach to the conversation.
//
// Two output shapes:
//   • kind: 'plan'    — a weekly plan that COUPLES cardio + strength, built by
//                        buildStarterRegimen(). Used for goal-oriented asks
//                        (get faster, run further, PR a lift, build muscle…).
//   • kind: 'session' — a single workout for today, built by generateWorkout().
//                        Used when the user just wants something to do now.
//
// Everything here is rule-based and deterministic (the parser is pure; only
// buildCoachPlan touches the DB, via generateWorkout's history lookup). If
// VITE_ANTHROPIC_API_KEY is set, coach.js can polish the intro text — but the
// plan itself is always generated locally so it works with zero config.

import { buildStarterRegimen } from '@/lib/data/starterRegimen';
import { generateWorkout } from './workoutGenerator';

// ── Goal prompts shown on the generate-mode welcome ──────────────────────────
export const GENERATE_PROMPTS = [
  { id: 'faster_5k',   text: 'Train for a faster 5K' },
  { id: 'pr_bench',    text: 'Help me PR my bench press' },
  { id: 'build_muscle',text: 'Build muscle — upper body' },
  { id: 'lose_fat',    text: 'A fat-loss plan I can stick to' },
  { id: 'today',       text: 'Give me a quick full-body workout today' },
];

// ── Lift name → EXERCISE_LIBRARY canonical (must match starterRegimen keys) ──
const LIFT_PATTERNS = [
  [/dead\s*lift/,                              'Deadlift'],
  [/bench|chest press/,                        'Bench Press'],
  [/back squat|front squat|\bsquat/,           'Squat'],
  [/overhead|\bohp\b|shoulder press|military/, 'Overhead Press'],
  [/barbell row|\brow\b/,                      'Barbell Row'],
  [/pull\s*up|chin\s*up/,                       'Pull-Up'],
];

// Session focus for a strength lift, so "give me a bench workout today" leads
// with the right movement pattern.
const LIFT_TO_FOCUS = {
  'Bench Press': 'push',
  'Overhead Press': 'push',
  'Squat': 'legs',
  'Deadlift': 'legs',
  'Barbell Row': 'pull',
  'Pull-Up': 'pull',
};

const GOAL_LABEL = {
  speed:     'run a faster',   // + event, e.g. "run a faster 5K"
  endurance: 'go the distance',
  strength:  'build strength',
  muscle:    'build muscle',
  lose:      'lose fat',
  mobility:  'move better',
  general:   'train',
};

function detectLift(m) {
  for (const [re, name] of LIFT_PATTERNS) if (re.test(m)) return name;
  return null;
}

function detectEvent(m) {
  if (/marathon/.test(m) && !/half/.test(m)) return 'marathon';
  if (/half\s*marathon|half\b|21\s*k/.test(m)) return 'half';
  if (/10\s*k|ten\s*k/.test(m)) return '10k';
  if (/5\s*k|five\s*k|couch to 5/.test(m)) return '5k';
  return null;
}

function detectEquipment(m) {
  if (/body\s*weight|no (gym|equipment|weights)|at home|home workout|calisthenic/.test(m)) return 'bodyweight';
  if (/dumbbell/.test(m)) return 'dumbbells';
  if (/minimal|resistance band|\bbands?\b|bench only|garage gym/.test(m)) return 'minimal';
  return 'gym';
}

function detectDuration(m) {
  const hr = /(\ban?\b\s*hour|1\s*(hr|hour)|60\s*min)/.test(m);
  if (hr) return 60;
  if (/90\s*min|1\.5\s*(hr|hour)|hour and a half/.test(m)) return 90;
  const min = m.match(/(\d{2,3})\s*(min|minute)/);
  if (min) {
    const n = Number(min[1]);
    return [30, 45, 60, 90].reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a), 45);
  }
  if (/quick|short|express/.test(m)) return 30;
  return 45;
}

/**
 * Parse a training goal from free text.
 * Returns a structured descriptor (pure — no I/O):
 *   {
 *     goal,          // one of: speed|endurance|strength|muscle|lose|mobility|general
 *     lift,          // canonical lift name for strength PRs, or null
 *     event,         // 5k|10k|half|marathon|null (cardio target)
 *     wantsPlan,     // true → weekly plan; false → single session
 *     equipment,     // gym|dumbbells|minimal|bodyweight (session only)
 *     durationMinutes,
 *     focus,         // session focus hint
 *     label,         // human goal label for the reply/title
 *   }
 */
export function parseWorkoutGoal(message) {
  const m = String(message || '').toLowerCase();

  const lift = detectLift(m);
  const event = detectEvent(m);
  const isRun = /run|jog|5\s*k|10\s*k|marathon|mile|sprint|pace|race|cardio/.test(m);
  const faster = /faster|quicker|speed|sprint|sub[-\s]?\d|pace|pr (my |a )?(5|10)/.test(m);
  const further = /further|longer|distance|endurance|go the distance|first (5k|10k|marathon|half)|finish (a|my)|complete (a|my)/.test(m);

  // ── Goal classification (order matters: most specific first) ──────────────
  let goal = 'general';
  if (isRun && (faster || further || event)) {
    goal = faster && !further ? 'speed' : further ? 'endurance' : 'speed';
  } else if (/\bpr\b|personal record|personal best|1\s*rep max|\b1rm\b|max out|get stronger|build strength|stronger|increase my|add \d+\s*(lb|kg|pound)/.test(m) || (lift && /workout|session|plan|train/.test(m))) {
    goal = 'strength';
  } else if (/build muscle|gain muscle|grow|hypertroph|bigger|\bsize\b|\bmass\b|\btone\b|bulk|jacked|shredded muscle/.test(m)) {
    goal = 'muscle';
  } else if (/lose (weight|fat)|weight loss|fat loss|\bcut\b|get lean|leaner|\bshred\b|slim down|drop \d+\s*(lb|kg|pound)/.test(m)) {
    goal = 'lose';
  } else if (/mobility|flexible|flexibility|move better|stretch|range of motion/.test(m)) {
    goal = 'mobility';
  }

  // ── Plan vs single session ────────────────────────────────────────────────
  const planCue = /\bplan\b|program|routine|regimen|train(ing)? for|prepare|prep for|get ready|build up to|over (time|the next)|\d+\s*week|weekly|each week|per week/.test(m);
  const sessionCue = /\btoday\b|right now|\bnow\b|this (morning|afternoon|evening)|(a|one|me a|quick|single)\s+(workout|session)|workout (today|now|for today)|just (a|one)/.test(m);
  const isCardio = goal === 'speed' || goal === 'endurance';
  const isGoalOriented = goal !== 'general';

  let wantsPlan;
  if (isCardio) wantsPlan = true;             // cardio goals are inherently multi-session
  else if (planCue) wantsPlan = true;
  else if (sessionCue) wantsPlan = false;
  else wantsPlan = isGoalOriented;            // "build muscle" → plan; "give me a workout" → session

  // ── Labels ────────────────────────────────────────────────────────────────
  const EVENT_LABEL = { '5k': '5K', '10k': '10K', half: 'Half Marathon', marathon: 'Marathon' };
  let label;
  if (isCardio) {
    const ev = event ? EVENT_LABEL[event] : null;
    label = goal === 'speed'
      ? (ev ? `run a faster ${ev}` : 'run faster')
      : (ev ? `finish your ${ev}` : 'run further');
  } else if (goal === 'strength' && lift) {
    label = `PR your ${lift.toLowerCase()}`;
  } else {
    label = GOAL_LABEL[goal] || 'train';
  }

  return {
    goal,
    lift,
    event: event || (isCardio ? 'general' : null),
    wantsPlan,
    equipment: detectEquipment(m),
    durationMinutes: detectDuration(m),
    focus: lift ? (LIFT_TO_FOCUS[lift] || 'full_body') : sessionFocusForGoal(goal),
    label,
  };
}

function sessionFocusForGoal(goal) {
  switch (goal) {
    case 'muscle': return 'upper';
    case 'lose':   return 'full_body';
    case 'mobility': return 'core';
    default: return 'full_body';
  }
}

// ── Normalizers so BOTH shapes render in StarterPlanView ─────────────────────

// A generateWorkout() session → StarterPlanView exercise shape (strength rows).
function sessionToView(workout) {
  return (workout.exercises || []).map((ex) => {
    const sets = ex.sets || [];
    const reps = sets[0]?.reps ?? null;
    const weight = sets[0]?.weight ?? 0;
    const detail = weight > 0
      ? `${sets.length} × ${reps} @ ${weight} lb`
      : `${sets.length || 3} × ${reps ?? '—'}`;
    return {
      name: ex.name,
      displayName: ex.name,
      kind: 'strength',
      muscle_groups: ex.group ? [ex.group] : [],
      muscle_group: ex.group || '',
      target_sets: sets.length || 3,
      target_reps: reps,
      detail,
    };
  });
}

// ── Cardio (Quick-pick "Cardio" type) ────────────────────────────────────────

export const CARDIO_STYLES = [
  { id: 'easy',      label: 'Easy Run' },
  { id: 'intervals', label: 'Intervals' },
  { id: 'tempo',     label: 'Tempo Run' },
  { id: 'long',      label: 'Long Run' },
];

const MI = 1609;
const LEVEL_FACTOR = { beginner: 0.75, intermediate: 1, advanced: 1.2 };

/**
 * Build a single cardio session for the Quick-pick "Cardio" type. Returns a
 * `plan` payload with a cardio exercise. It's Save-only (no `workout`, so
 * CoachPlanCard hides "Start workout") — cardio is logged via the Cardio
 * tracker, and saving drops it into the user's Regimens.
 */
export function buildCardioSession({ style = 'easy', durationMinutes = 45, skillLevel = 'intermediate' } = {}) {
  const f = LEVEL_FACTOR[skillLevel] || 1;
  const label = (CARDIO_STYLES.find((s) => s.id === style) || CARDIO_STYLES[0]).label;

  let detail;
  let target_duration_s = null;
  let target_distance_m = null;
  if (style === 'intervals') {
    const reps = Math.min(10, Math.max(4, Math.round((durationMinutes / 6) * f)));
    detail = `${reps} × 400 m · hard efforts, full recovery`;
  } else if (style === 'tempo') {
    const mins = Math.max(12, Math.round((durationMinutes - 12) * f));
    detail = `${mins} min · comfortably hard`;
    target_duration_s = mins * 60;
  } else if (style === 'long') {
    const miles = Math.max(3, Math.round((durationMinutes / 9) * f));
    detail = `${miles} mi · easy, build distance weekly`;
    target_distance_m = miles * MI;
  } else {
    detail = `${durationMinutes} min · conversational pace`;
    target_duration_s = durationMinutes * 60;
  }

  const exercise = {
    name: 'Running',
    displayName: label,
    kind: 'cardio',
    detail,
    target_sets: 1,
    target_reps: 1,
    target_duration_s,
    target_distance_m,
    muscle_groups: ['Quads', 'Hamstrings', 'Calves', 'Core'],
    muscle_group: 'Quads',
    notes: '',
  };

  return {
    kind: 'session',
    cardio: true,
    title: `${label} · ${durationMinutes} min`,
    subtitle: detail,
    exercises: [exercise],
    regimenPayload: {
      name: label,
      description: `Cardio — ${detail}`,
      exercises: [exercise],
      is_public: false,
    },
    workout: null, // no strength-logger handoff; run it from the Cardio tracker
    goal: 'endurance',
    label: 'run',
  };
}

/**
 * Build a bodyweight/conditioning circuit for the Quick-pick "HIIT" type:
 * a full-body session with minimal rest. Startable + saveable like any session.
 */
export async function buildHiitSession({ user, durationMinutes = 30, equipment = 'bodyweight', skillLevel = 'intermediate', bodyweightLbs = 165 } = {}) {
  const workout = await generateWorkout({
    user, focus: 'full_body', durationMinutes, equipment, skillLevel, bodyweightLbs, seed: Date.now(),
  });
  const exercises = (workout.exercises || []).map((ex) => ({ ...ex, restSec: 30 }));
  return sessionToPlan({ ...workout, exercises, title: `HIIT Circuit · ${durationMinutes} min`, focus: 'hiit' });
}

/**
 * Normalize a generateWorkout() session into the same `plan` payload shape the
 * chat produces, so the Quick-pick tab can reuse CoachPlanCard (Start / Save).
 */
export function sessionToPlan(workout) {
  return {
    kind: 'session',
    title: workout.title,
    subtitle: `${(workout.exercises || []).length} exercises · ${workout.duration_minutes} min`,
    exercises: sessionToView(workout),
    regimenPayload: sessionToRegimenPayload(workout),
    workout,
    goal: 'general',
    label: 'train',
  };
}

// A generateWorkout() session → regimens payload for Regimen.create.
function sessionToRegimenPayload(workout) {
  const focusLabel = workout.focus ? `${workout.focus} ` : '';
  const mins = workout.duration_minutes;
  return {
    name: workout.title || 'AI Workout',
    description: `AI ${focusLabel}session${mins ? ` — ${mins} min` : ''}`.trim(),
    exercises: (workout.exercises || []).map((ex) => ({
      name: ex.name,
      target_sets: ex.sets?.length || 3,
      target_reps: ex.sets?.[0]?.reps ?? null,
      target_weight: ex.sets?.[0]?.weight ?? null,
      rest_seconds: ex.restSec ?? 90,
    })),
    is_public: false,
  };
}

// ── Intro copy ───────────────────────────────────────────────────────────────

function planReply({ parsed, payload }) {
  const cardio = (payload.exercises || []).filter((e) => e.kind === 'cardio');
  const strength = (payload.exercises || []).filter((e) => e.kind !== 'cardio');
  if (parsed.goal === 'speed' || parsed.goal === 'endurance') {
    return [
      `Here's a plan to ${parsed.label} 🏃`,
      '',
      `${cardio.length} running session${cardio.length === 1 ? '' : 's'} a week drive the goal, with ${strength.length} supporting lift${strength.length === 1 ? '' : 's'} to keep you powerful and injury-proof. Build the easy miles first, keep the hard days hard, and add a little each week. Save it as a regimen and I'll track it for you.`,
    ].join('\n');
  }
  if (parsed.goal === 'strength' && parsed.lift) {
    return [
      `Here's a ${parsed.lift}-focused plan to hit a new PR 🏋️`,
      '',
      `Run it 2–3× a week. Lead with the ${parsed.lift.toLowerCase()} while you're fresh, add ~5 lb (or 1 clean rep) each week it moves well, and deload if a session stalls twice in a row. Save it as a regimen to track your progress toward the PR.`,
    ].join('\n');
  }
  return [
    `Here's a plan to ${parsed.label} 💪`,
    '',
    `${strength.length} exercise${strength.length === 1 ? '' : 's'} across the week, balanced so nothing gets neglected. Progress the weight as it gets easy. Save it as a regimen and I'll keep it in your rotation.`,
  ].join('\n');
}

function sessionReply({ workout }) {
  const n = (workout.exercises || []).length;
  return [
    `Here's a session for today 🔥`,
    '',
    `${n} exercise${n === 1 ? '' : 's'}, ~${workout.duration_minutes} min. Weights are seeded from your recent history where I have it, otherwise from a sensible starting estimate. Hit **Start workout** to log it live, or save it as a regimen to repeat.`,
  ].join('\n');
}

// ── Main entry ────────────────────────────────────────────────────────────────

/**
 * Build a coach plan from a free-text message.
 * Returns { reply, plan } where plan is:
 *   {
 *     kind: 'plan' | 'session',
 *     title, subtitle,
 *     exercises,          // StarterPlanView shape (for rendering)
 *     regimenPayload,     // ready for db.entities.Regimen.create
 *     workout,            // generateWorkout result (session only; for Start handoff)
 *     goal, label,
 *   }
 */
export async function buildCoachPlan({ user, message, profile = {} } = {}) {
  const parsed = parseWorkoutGoal(message);

  if (parsed.wantsPlan) {
    const goals = parsed.goal === 'general' ? ['strength'] : [parsed.goal];
    const payload = buildStarterRegimen({
      goals,
      level: profile.level || 'intermediate',
      daysCount: profile.daysCount || 4,
      cardioEvent: parsed.event,
      strengthFocus: parsed.lift ? [parsed.lift] : [],
      age: profile.age,
      gender: profile.gender,
    });
    const plan = {
      kind: 'plan',
      title: payload.name,
      subtitle: payload.description,
      exercises: payload.exercises,
      regimenPayload: payload,
      workout: null,
      goal: parsed.goal,
      label: parsed.label,
    };
    return { reply: planReply({ parsed, payload }), plan };
  }

  // Single session
  const workout = await generateWorkout({
    user,
    focus: parsed.focus,
    durationMinutes: parsed.durationMinutes,
    equipment: parsed.equipment,
    skillLevel: profile.skillLevel || 'intermediate',
    bodyweightLbs: Number(profile.weight_lbs) || 165,
    seed: undefined,
  });
  const plan = {
    kind: 'session',
    title: workout.title,
    subtitle: `${(workout.exercises || []).length} exercises · ${workout.duration_minutes} min`,
    exercises: sessionToView(workout),
    regimenPayload: sessionToRegimenPayload(workout),
    workout,
    goal: parsed.goal,
    label: parsed.label,
  };
  return { reply: sessionReply({ workout }), plan };
}
