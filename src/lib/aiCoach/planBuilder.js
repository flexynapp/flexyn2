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
// buildCoachPlan touches the DB, via generateWorkout's history lookup). The
// language model in coach.js decides WHETHER a message is a build-me-a-session
// request and restates the goal, and writes the intro copy — but the session
// itself is always generated here, so it stays reproducible, saveable, and
// works with zero config when no model is available.

import { buildStarterRegimen } from '@/lib/data/starterRegimen';
import { generateWorkout } from './workoutGenerator';
import { buildTrainingModifiers, profileAge } from './trainingModifiers';
import { runningTargets, fiveKSplits, formatPace, formatClock } from '@/lib/running/paces';
import { weeklyRunningLoad } from '@/lib/running/fueling';
import { getMaxRealisticSetsPerWorkout, sumWorkoutVolume } from '@/lib/workoutFatigue';
import { CREW_WAR_WEIGHTS } from '@/lib/data/crewWars';
import { formatNumber } from '@/lib/intl';

// Default 5K baseline when the runner hasn't told us their time — a mid
// recreational ~28:00. We flag it as an estimate and invite them to share
// their real time for exact paces.
const DEFAULT_5K_SEC = 28 * 60;

// ── Goal prompts shown on the generate-mode welcome ──────────────────────────
// `war_points` leads the list on purpose: it's the only prompt tied to a
// running competition (a rival week or a crew war), so it has to be reachable
// without scrolling the horizontal strip or the welcome list.
export const GENERATE_PROMPTS = [
  { id: 'war_points',  text: 'Max points against my rival / crew war' },
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

// ── Competition mode ─────────────────────────────────────────────────────────
//
// "Score the most points this week" is a different question from any training
// goal, because the scoring formula — not physiology — decides what the best
// session looks like. Both live scoreboards pay for TONNAGE:
//
//   • Crew war   (mig 249 _crew_war_score, mirrored in lib/data/crewWars.js):
//       floor(volume / 100) + sessions×50 + days_active×100,
//       capped at 200,000 lb / 28 sessions / 7 days per member.
//   • Gym rival  (mig 225 gym_rival_net_rating): round(volume / 100), no cap.
//   • Cardio rival scores km × 20 and ignores lifting entirely — the reply
//       says so rather than handing a runner a barbell session.
//
// So the point-maximal session is simply the most total weight×reps the user
// can legitimately log in one sitting. The binding constraint is the
// anti-cheat plausibility gate (workoutFatigue.detectImplausibleWorkout),
// which rejects a save over the user's realistic set ceiling — so we size the
// session to sit just under that ceiling instead of blindly maxing sets.
const COMPETE_RE = /\b(crew\s*war|clan\s*war|war\s*(points|score)|rival|opponent|matchup|head\s*to\s*head|leader\s*board|leaderboard)\b|\b(max|maximum|most|more)\s+(points|score|tonnage)\b|\bout(score|lift)\b/;

// duration → exercise count inside generateWorkout(). Mirrored here so we can
// pick the shape whose total set count lands closest under the ceiling.
const COMPETE_SHAPES = [
  { durationMinutes: 90, exCount: 7 },
  { durationMinutes: 60, exCount: 6 },
  { durationMinutes: 45, exCount: 5 },
  { durationMinutes: 30, exCount: 4 },
];

/**
 * Largest (exercises × sets) session that still fits under this user's
 * plausibility ceiling. Pure — takes the ceiling as a number.
 */
export function competeSessionShape(maxSets, preferredDuration = null) {
  const ceiling = Number.isFinite(maxSets) && maxSets > 0 ? maxSets : 25;
  // When the user names a length, that wins over point-maximizing: "45 minutes"
  // is a constraint on their evening, not a suggestion. We still pack that slot
  // as densely as the ceiling allows.
  const shapes = COMPETE_SHAPES.filter(s => s.durationMinutes === preferredDuration);
  let best = null;
  for (const shape of (shapes.length ? shapes : COMPETE_SHAPES)) {
    // generateWorkout clamps set count to 2..5, so that's the search space.
    for (let setCount = 5; setCount >= 2; setCount--) {
      const totalSets = shape.exCount * setCount;
      if (totalSets > ceiling) continue;
      if (!best || totalSets > best.totalSets) best = { ...shape, setCount, totalSets };
      break; // largest set count that fits this shape — smaller ones can't beat it
    }
  }
  // Ceiling below 8 sets (the floor of every shape) → smallest legal session.
  return best || { durationMinutes: 30, exCount: 4, setCount: 2, totalSets: 8 };
}

const GOAL_LABEL = {
  compete:   'out-score your rival',
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

// Returns null when the message says nothing about length, so callers can tell
// "the user asked for 45" apart from "45 is our default". Competition mode
// needs that distinction: it sizes the session itself unless told otherwise.
function detectDuration(m) {
  if (/90\s*min|1\.5\s*(hr|hour)|hour and a half/.test(m)) return 90;
  const hr = /(\ban?\b\s*hour|1\s*(hr|hour)|60\s*min)/.test(m);
  if (hr) return 60;
  const min = m.match(/(\d{2,3})\s*(min|minute)/);
  if (min) {
    const n = Number(min[1]);
    return [30, 45, 60, 90].reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a), 45);
  }
  if (/quick|short|express/.test(m)) return 30;
  return null;
}

const DEFAULT_DURATION_MIN = 45;

/**
 * Parse a training goal from free text.
 * Returns a structured descriptor (pure — no I/O):
 *   {
 *     goal,          // one of: compete|speed|endurance|strength|muscle|lose|mobility|general
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

  // Current 5K time ("24:30", "I run 25:00 now") and an optional stated goal
  // ("sub 24", "sub 22:30"). mm:ss is unambiguous for a race time; we strip a
  // "sub …" goal first so it isn't also read as the current time.
  const subM = m.match(/\bsub[-\s]?(\d{1,2})(?::(\d{2}))?\b/);
  const goalFiveKSec = subM ? Number(subM[1]) * 60 + Number(subM[2] || 0) : null;
  const timeM = m.replace(/\bsub[-\s]?\d{1,2}(?::\d{2})?\b/, '').match(/\b(\d{1,2}):(\d{2})\b/);
  const current5kSec = timeM && Number(timeM[2]) < 60 ? Number(timeM[1]) * 60 + Number(timeM[2]) : null;
  const isRun = /run|jog|5\s*k|10\s*k|marathon|mile|sprint|pace|race|cardio/.test(m);
  const faster = /faster|quicker|speed|sprint|sub[-\s]?\d|pace|pr (my |a )?(5|10)/.test(m);
  const further = /further|longer|distance|endurance|go the distance|first (5k|10k|marathon|half)|finish (a|my)|complete (a|my)/.test(m);

  // ── Goal classification (order matters: most specific first) ──────────────
  let goal = 'general';
  if (COMPETE_RE.test(m)) {
    // Checked first: "max points for my crew war" also trips the strength and
    // muscle patterns, and scoring — not the training goal — drives this one.
    goal = 'compete';
  } else if (isRun && (faster || further || event)) {
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
  const statedDuration = detectDuration(m);

  let wantsPlan;
  if (goal === 'compete') wantsPlan = false;  // points are scored per logged session, so ship one
  else if (isCardio) wantsPlan = true;        // cardio goals are inherently multi-session
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
    durationMinutes: statedDuration ?? DEFAULT_DURATION_MIN,
    durationStated: statedDuration != null,
    focus: lift ? (LIFT_TO_FOCUS[lift] || 'full_body') : sessionFocusForGoal(goal),
    label,
    current5kSec,
    goalFiveKSec,
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

// `label` is the English fallback for `coach.cardioStyle.<id>` AND the name
// that lands in the saved plan payload, which is data. Keep it English here
// and resolve at the pill row.
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
export async function buildHiitSession({
  user, durationMinutes = 30, equipment = 'bodyweight', skillLevel = 'intermediate',
  bodyweightLbs = 165,
  // These three used to be missing entirely, so the HIIT branch of the
  // Quick-pick generator ran with generateWorkout's inert defaults: no injury
  // exclusions, no training modifiers, no demographic scaling. `full_body`
  // focus makes the injury half the worst of the three — it maximises the
  // chance of programming the exact group the user reported hurt. All three
  // default to inert here too, so a caller that passes none is unchanged.
  excludeMuscleGroups = new Set(),
  modifiers,
  demographics,
} = {}) {
  const workout = await generateWorkout({
    user, focus: 'full_body', durationMinutes, equipment, skillLevel, bodyweightLbs, seed: Date.now(),
    excludeMuscleGroups, modifiers, demographics,
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
    // Carried through so the card can explain why the session was adjusted.
    coachNotes: workout.coachNotes || [],
    evidence: workout.evidence || null,
  };
}

/**
 * The per-exercise half of the evidence panel, derived from the session as it
 * currently stands rather than stored alongside it.
 *
 * Derived, not stored, because the session is editable: a stored list would go
 * on citing "Bench Press — last hit 185 × 5" after the user swapped Bench Press
 * out, and an evidence panel that describes a workout the user isn't looking at
 * is worse than no panel at all. That's the exact failure this feature exists
 * to prevent, so it must not be the one it commits.
 */
export function evidenceForExercises(exercises) {
  const list = exercises || [];
  const seededFromHistory = list
    .filter((ex) => ex.seededFrom === 'history' && ex.historyTop)
    .map((ex) => ({ name: ex.name, weight: ex.historyTop.weight, reps: ex.historyTop.reps }));
  return {
    seededFromHistory,
    estimatedCount:  list.filter((ex) => ex.seededFrom === 'estimate').length,
    bodyweightCount: list.filter((ex) => ex.seededFrom === 'bodyweight').length,
  };
}

/**
 * Re-derive a session plan after the user has edited its workout in the chat
 * card (swapped an exercise, dropped one, changed a set count).
 *
 * Three representations of the same session travel on a plan — the view rows
 * StarterPlanView renders, the payload Save-as-regimen persists, and the
 * workout Start-workout hands to the logger. They are generated from the same
 * source and must stay generated from the same source: an edit applied to only
 * some of them is invisible until the user notices they started a workout that
 * doesn't match the card they were reading.
 *
 * Everything that describes the REQUEST rather than its result — goal, label,
 * the parsed descriptor behind the follow-up chips, the coach's notes about why
 * the session looks like this — is carried through untouched. Dropping an
 * exercise doesn't change what the user asked for.
 *
 * @param {object} plan     the original session plan
 * @param {object} workout  the edited generateWorkout()-shaped session
 */
export function withEditedWorkout(plan, workout) {
  return {
    ...plan,
    subtitle: `${(workout.exercises || []).length} exercises · ${workout.duration_minutes} min`,
    exercises: sessionToView(workout),
    regimenPayload: sessionToRegimenPayload(workout),
    workout,
    edited: true,
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

function planReply({ parsed, payload, targets, estimated5k }) {
  const cardio = (payload.exercises || []).filter((e) => e.kind === 'cardio');
  const strength = (payload.exercises || []).filter((e) => e.kind !== 'cardio');
  if (parsed.goal === 'speed' || parsed.goal === 'endurance') {
    const lines = [
      `Here's a plan to ${parsed.label} 🏃`,
      '',
      `${cardio.length} running session${cardio.length === 1 ? '' : 's'} a week drive the goal, with ${strength.length} supporting lift${strength.length === 1 ? '' : 's'} to keep you powerful and injury-proof. Each session below carries your target pace — build the easy miles first, keep the hard days hard, and add a little each week.`,
    ];
    if (targets && targets.goalFiveKSeconds > 0) {
      const g = targets.goalSplits;
      lines.push('', `🎯 Goal: sub-${formatClock(targets.goalFiveKSeconds)} 5K — ${formatPace(g.perKm)}/km · ${formatPace(g.perMile)}/mi · ${formatClock(g.per400)}/400m.`);
      if (estimated5k) {
        lines.push(`(Paces assume a ~${formatClock(targets.currentFiveKSeconds)} 5K — reply with your recent time, e.g. "24:30", and I'll re-dial them exactly.)`);
      }
    }
    lines.push('', 'Save it as a regimen and I\'ll track it for you.');
    return lines.join('\n');
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

/**
 * Competition-mode intro. States the actual scoring rules rather than vague
 * hype, because the honest answer ("volume is the slow lever, showing up is
 * the fast one") is the one that wins a crew war.
 */
function competeReply({ workout }) {
  const volume = sumWorkoutVolume(workout.exercises);
  const sets = (workout.exercises || []).reduce((n, ex) => n + (ex.sets?.length || 0), 0);
  const { volumePerPoint, perSession, perDayActive, caps } = CREW_WAR_WEIGHTS;
  const volPoints = Math.floor(volume / volumePerPoint);

  // Tonnage is weight × reps, so an unloaded movement scores nothing at all.
  // The generator still picks them (they're good training), so say it outright
  // rather than let someone plank for zero points and wonder why.
  const unloaded = (workout.exercises || [])
    .filter(ex => (ex.sets || []).every(s => !(Number(s.weight) > 0)))
    .map(ex => ex.name);

  const lines = [
    `Here's your point-max session ⚔️`,
    '',
    `${(workout.exercises || []).length} exercises · ${sets} working sets · ~${formatNum(volume)} lb of total tonnage. Both scoreboards pay by weight lifted, so this leads with the big compounds and runs slightly higher reps — tonnage is weight × reps, and an extra rep is worth more than an extra pound.`,
    '',
    `**What it's worth**`,
    `• Crew war: ~${formatNum(volPoints + perSession + perDayActive)} pts — ${formatNum(volPoints)} from tonnage (1 pt per ${volumePerPoint} lb), +${perSession} for the session, +${perDayActive} for training today.`,
    `• Gym rival: ~${formatNum(volPoints)} pts. Rival week is tonnage only — sessions and days don't count there.`,
    '',
    `**The bigger lever**`,
    `In a crew war, each distinct day you train is worth ${perDayActive} pts — you'd need ${formatNum(perDayActive * volumePerPoint)} lb of extra lifting to match one more day on the calendar. Repeat this session across all ${caps.daysActive} days of the war before you chase heavier numbers. Sessions cap at ${caps.sessions} and days at ${caps.daysActive}; the tonnage cap is personal — it is what you could plausibly lift in a week, so it is not a number worth training toward.`,
    '',
    `Sized to stay under your realistic set ceiling, so the log will save clean — the anti-cheat gate rejects sessions past it. Chasing a **cardio** rival instead? That one scores kilometres, not tonnage — ask me for a distance session.`,
  ];

  if (unloaded.length) {
    lines.splice(-1, 0,
      `Bodyweight movements score zero tonnage — ${unloaded.join(' and ')} ${unloaded.length === 1 ? 'is' : 'are'} in there for balance, not points. Wear a belt or vest and log the added weight if you want ${unloaded.length === 1 ? 'it' : 'them'} to count.`,
      '',
    );
  }

  return lines.join('\n');
}

// The rest of this module's copy is English-only, so the grouping separator
// is too — formatNumber falls back to 'en' with no language passed.
function formatNum(n) {
  return formatNumber(Math.round(Number(n) || 0), undefined, { maximumFractionDigits: 0 });
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
export async function buildCoachPlan({ user, message, profile = {}, excludeMuscleGroups, t, language } = {}) {
  const parsed = parseWorkoutGoal(message);

  if (parsed.wantsPlan) {
    const goals = parsed.goal === 'general' ? ['strength'] : [parsed.goal];
    const isRun = parsed.goal === 'speed' || parsed.goal === 'endurance';
    const current5kSec = isRun ? (parsed.current5kSec || DEFAULT_5K_SEC) : undefined;
    const payload = buildStarterRegimen({
      goals,
      // starterRegimen levels are newbie|returning|consistent|advanced —
      // 'consistent' is the intermediate-equivalent default.
      level: profile.level || 'consistent',
      daysCount: profile.daysCount || 4,
      cardioEvent: parsed.event,
      strengthFocus: parsed.lift ? [parsed.lift] : [],
      age: profile.age,
      gender: profile.gender,
      current5kSec,
    });
    // Fuel: training load → diet adjustment (carbs/kcal on run days). Attached
    // so the card can show the nutrition implication and deep-link to Plans.
    const fuel = weeklyRunningLoad(payload.exercises, Number(profile.weight_lbs) || 165);
    const plan = {
      kind: 'plan',
      title: payload.name,
      subtitle: payload.description,
      exercises: payload.exercises,
      regimenPayload: payload,
      workout: null,
      goal: parsed.goal,
      label: parsed.label,
      // The descriptor that produced this, so the chat can offer follow-ups
      // ("just today's workout") that re-send the same request with one field
      // changed. Each message is parsed on its own, so the context has to
      // travel with the plan or the follow-up loses it.
      parsed,
      fuel: fuel.runDays > 0 ? fuel : null,
    };
    // Running targets power the goal-splits line in the reply. If the runner
    // stated a goal ("sub 24"), honor it; otherwise project a realistic one.
    const targets = isRun ? runningTargets(current5kSec) : null;
    if (targets && parsed.goalFiveKSec) {
      targets.goalFiveKSeconds = parsed.goalFiveKSec;
      targets.goalSplits = fiveKSplits(parsed.goalFiveKSec);
    }
    return {
      reply: planReply({ parsed, payload, targets, estimated5k: isRun && !parsed.current5kSec }),
      plan,
    };
  }

  // Single session
  const compete = parsed.goal === 'compete';
  // Point-max sessions are sized against the user's own plausibility ceiling
  // so the workout they're handed is one the save gate will actually accept.
  const shape = compete
    ? competeSessionShape(
        getMaxRealisticSetsPerWorkout(profile),
        parsed.durationStated ? parsed.durationMinutes : null,
      )
    : null;

  const baseModifiers = buildTrainingModifiers({
    goal:          parsed.goal,
    nutritionGoal: profile.nutrition_goal,
    weeklyRateLbs: profile.weekly_rate_lbs,
    age:           profileAge(profile),
    restrictions:  Array.isArray(profile.dietary_restrictions) ? profile.dietary_restrictions : [],
    // Forwarded from askCoach's ctx. Absent → English, per coachI18n.js.
    t, language,
  });

  const workout = await generateWorkout({
    user,
    focus: parsed.focus,
    durationMinutes: shape ? shape.durationMinutes : parsed.durationMinutes,
    equipment: parsed.equipment,
    skillLevel: profile.skillLevel || 'intermediate',
    bodyweightLbs: Number(profile.weight_lbs) || 165,
    seed: undefined,
    // Active injuries, if the caller resolved them. generateWorkout has always
    // taken this and nothing ever supplied it, so an injured user got the
    // injured group anyway. Passed through from buildCoachPlan's caller.
    excludeMuscleGroups: excludeMuscleGroups || new Set(),
    // Same demographic sizing the Quick-pick tab uses, so a lift with no
    // history starts at the same weight whichever surface asked for it.
    demographics: {
      gender:        profile.gender,
      age:           profileAge(profile),
      activityLevel: profile.activity_level,
    },
    // The chat path knows the parsed goal and the profile's diet direction;
    // it has no cycle context (that is opt-in and lives on the Coach screen),
    // so no phase is passed and none is assumed.
    //
    // Competition mode overrides the volume knobs on top of that: sets are
    // pinned to the shape that fits under the plausibility ceiling, and reps
    // run two higher than standard because tonnage is weight × reps and the
    // rep bump outweighs the ~10% load back-off it triggers on a lift whose
    // history was heavier-and-shorter.
    modifiers: compete
      ? { ...baseModifiers, setsDelta: shape.setCount - 3, repDelta: baseModifiers.repDelta + 2 }
      : baseModifiers,
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
    parsed, // see the 'plan' branch — powers the follow-up chips
    // What the session was actually built from. Measured by generateWorkout,
    // not reconstructed here — a count assembled at this layer would be a
    // guess about someone else's work, which is the failure this is meant to
    // prevent rather than commit.
    evidence: workout.evidence || null,
    coachNotes: workout.coachNotes || [],
  };
  return { reply: compete ? competeReply({ workout }) : sessionReply({ workout }), plan };
}
