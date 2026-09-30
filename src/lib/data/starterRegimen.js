// src/lib/data/starterRegimen.js
// Generates a real, persisted starter regimen at the end of onboarding so the
// "personalized plan" the Reveal step promises is something the user can
// actually open in Workout → Regimens. Pure logic, no React.
//
// Foolproof properties:
//  - All exercise names are pre-flight-checked against EXERCISE_LIBRARY at
//    module load. A typo throws at import time so CI catches it before users.
//  - Idempotent: ensureStarterRegimen() skips creation if the user already has
//    any regimens, so account-reset re-onboarding never doubles up. If it
//    cannot tell (the read fails) it throws rather than guessing.
//  - Fire-and-forget at the caller: a regimen-table outage cannot block
//    onboarding completion (Onboarding.jsx wraps the call in .catch()).
//  - Payload shape mirrors RegimenForm exactly, so the regimen renders the
//    same as one a user typed in by hand.

import * as regimensData from '@/lib/data/regimens';
import { EXERCISE_LIBRARY } from '@/components/regimens/ExerciseAutocomplete';
import { runningTargets, formatPace, formatClock, repTime } from '@/lib/running/paces';
import { classifyEquipment } from '@/lib/exerciseEquipment';
import { getMaxRealisticSetsPerWorkout, getMaxSetsPerExercise, getMuscleGroupCap, countSetsPerMuscleGroup } from '@/lib/workoutFatigue';

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
  speed:     'Run Faster',
  endurance: 'Run Further',
  mobility:  'Move Better',
};

// Cardio goal IDs — these drive real running sessions (not sets×reps).
const CARDIO_GOALS = new Set(['speed', 'endurance']);

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
  // Runner-support strength (posterior chain + core) for a cardio-only user, so
  // "Run faster/further" still ships a couple of injury-proofing lifts.
  run_support: ['Glute Bridge', 'Body Weight Lunge', 'Plank', 'Side Plank', 'Push-Up'],
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

// ── Equipment. Onboarding asks "Where do you train?" with the SAME four ids
// the Coach's quick generator uses (gym / dumbbells / minimal / bodyweight),
// so the answer can seed that picker later without a translation table.
// Unset means a full gym, which is what every plan assumed before the
// question existed.
export const TRAINING_EQUIPMENT = ['gym', 'dumbbells', 'minimal', 'bodyweight'];

// Every name in the curated pools that needs more than the user has, with
// what replaces it at each level. `minimal` is a bench, a band and a pull-up
// bar, which is what the Coach's "Minimal (band, bench)" means. A null drops
// the exercise; the goal's pool is deep enough to fill the gap.
//
// An explicit table rather than classifyEquipment: that classifier is a
// coarse name regex (it reads "Goblet Squat" as barbell, because of the word
// squat) and it only says what an exercise NEEDS, not what to do instead.
const EQUIPMENT_SWAPS = {
  //                        dumbbells                     minimal                          bodyweight
  'Squat':                  ['Goblet Squat',               'Bulgarian Split Squat',         'Air Squat'],
  'Bench Press':            ['Dumbbell Chest Press',       'Push-Up',                       'Push-Up'],
  'Deadlift':               ['Dumbbell Deadlift',          'Single Leg Romanian Deadlift',  'Glute Bridge'],
  'Overhead Press':         ['Dumbbell Shoulder Press',    'Decline Push-Up',               'Decline Push-Up'],
  'Barbell Row':            ['Dumbbell Row',               'Inverted Row',                  'Towel Row'],
  'Pull-Up':                ['Dumbbell Pullover',          'Pull-Up',                       'Superman Raise'],
  'Romanian Deadlift':      ['Dumbbell Romanian Deadlift', 'Single Leg Romanian Deadlift',  'Single Leg Romanian Deadlift'],
  'Incline Dumbbell Press': ['Incline Dumbbell Press',     'Decline Push-Up',               'Decline Push-Up'],
  'Dumbbell Curl':          ['Dumbbell Curl',              'Chin-Up',                       null],
  'Goblet Squat':           ['Goblet Squat',               'Bulgarian Split Squat',         'Air Squat'],
  'Dumbbell Row':           ['Dumbbell Row',               'Inverted Row',                  'Towel Row'],
  'Dumbbell Lunge':         ['Dumbbell Lunge',             'Body Weight Lunge',             'Body Weight Lunge'],
};
Object.values(EQUIPMENT_SWAPS).flat().filter(Boolean).forEach(EX); // pre-flight validate
Object.keys(EQUIPMENT_SWAPS).forEach(EX);

/** What `name` becomes for someone training with `equipment`; null drops it. */
export function swapForEquipment(name, equipment) {
  const col = { dumbbells: 0, minimal: 1, bodyweight: 2 }[equipment];
  if (col === undefined || !(name in EQUIPMENT_SWAPS)) return name;
  return EQUIPMENT_SWAPS[name][col];
}

// For the last-resort library search, where there is no table: which
// classifyEquipment kinds each setting can do. Crude, and only reached when
// injuries have excluded every curated pool.
const EQUIPMENT_KINDS = {
  dumbbells:  new Set(['dumbbell', 'bodyweight', 'cardio', 'other']),
  minimal:    new Set(['bodyweight', 'band', 'cardio', 'other']),
  bodyweight: new Set(['bodyweight', 'cardio', 'other']),
};

// ── Session length. Same ids as the Coach's duration picker, and the same
// exercise counts its generator uses for them, so a 30 minute starter plan
// and a 30 minute Coach session are the same size. Unset changes nothing.
export const SESSION_MINUTES = [30, 45, 60, 90];
function sessionExerciseCap(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return Infinity;
  return minutes <= 30 ? 4 : minutes <= 45 ? 5 : minutes <= 60 ? 6 : 8;
}

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

// Training days → per-session VOLUME, inversely. Weekly work is roughly fixed;
// spreading it over fewer sessions means each session must carry more (an extra
// set), and over more sessions means each is lighter (a set less). This is the
// counterpart to targetExerciseCount: days widen the plan's *scope* but thin
// its *per-session* volume, so a 2-day full-body hit stays potent and a 6-day
// schedule doesn't overreach on any single day.
function daysVolumeAdjust(daysCount) {
  const d = Number.isFinite(daysCount) && daysCount > 0 ? daysCount : 3;
  if (d <= 2) return +1;
  if (d >= 5) return -1;
  return 0;
}

// BMI from the onboarding height + weight (both always captured). Null when we
// can't compute it. Used for humane, achievable targets — not judgement.
function bmiFrom(weightKg, heightCm) {
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm) || heightCm <= 0) return null;
  const m = heightCm / 100;
  return weightKg / (m * m);
}

// Sets/reps by experience level. Newbies and returning lifters share a
// program (3×10) to keep the on-ramp gentle.
const LEVEL_SETS_REPS = {
  newbie:     { sets: 3, reps: 10 },
  returning:  { sets: 3, reps: 10 },
  consistent: { sets: 4, reps: 8  },
  advanced:   { sets: 5, reps: 5  },
};

// The onboarding self-assessment comes in two tiers.
//
// STRENGTH is the original four, and they are all ADVANCED benchmarks —
// published standards put most untrained men at 0-3 pull-ups. So a beginner
// scored 0 here and so did someone a year in: no resolution at the end of the
// range where nearly every new user sits.
//
// FOUNDATION is the addition. These are answerable by someone who trains a
// little, so they separate "never trained" from "trains a bit" — which is
// exactly the distinction that decides whether week one is achievable.
//
// Keep these in step with ASSESSMENT_QUESTIONS in Onboarding.jsx. A question
// that isn't listed here is collected and ignored.
const STRENGTH_KEYS = ['squat_bw15', 'pullups_10', 'mile_under10'];
const FOUNDATION_KEYS = ['pushups_20', 'plank_60s'];

// `bench_bw` and `squats_25` were asked at one point and are still read here
// on purpose: a profile answered before the question list was cut still has
// them in its blob, and dropping them from the count would silently demote
// that user's plan on any recompute. They can't be answered any more, so they
// only ever add signal, never remove it.
const LEGACY_STRENGTH_KEYS = ['bench_bw'];
const LEGACY_FOUNDATION_KEYS = ['squats_25'];

const countYes = (assessment, keys) => {
  if (!assessment || typeof assessment !== 'object') return 0;
  let n = 0;
  for (const k of keys) if (assessment[k] === 'yes') n++;
  return n;
};

// 0..4 over the strength tier — three live questions plus the retired one.
function advancedIndex(assessment) {
  return countYes(assessment, STRENGTH_KEYS) + countYes(assessment, LEGACY_STRENGTH_KEYS);
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
    if (a.mile_under10 === 'yes' && adv >= 2) idx = LEVEL_ORDER.length - 1; // + broadly fit → advanced
  } else {
    // Three live strength questions, so "aces everything" is 3 — but a
    // profile from when there were four can still score 4, and must not be
    // demoted for it.
    if (adv >= 3) idx = LEVEL_ORDER.length - 1;                    // aces everything → advanced
    else if (adv >= 2) idx = Math.max(idx, 2);                     // solid → consistent
  }
  // The foundation tier can only lift someone OFF the floor — a person who
  // can do 20 push-ups and hold a plank is not a day-one newbie, whatever
  // they picked on the experience step. It never promotes past 'returning',
  // because clearing a beginner bar says nothing about handling real volume.
  if (countYes(a, FOUNDATION_KEYS) + countYes(a, LEGACY_FOUNDATION_KEYS) >= 2) idx = Math.max(idx, 1);
  return LEVEL_ORDER[idx];
}

/**
 * The level the starter plan is actually built at: the one the user picked,
 * promoted by the lift check. The loader and the reveal name this, not the
 * raw pick, or a "New" lifter who aces the check reads "for new lifters"
 * above an advanced plan.
 */
export function starterPlanLevel({ goals, level, assessment } = {}) {
  const goalList = Array.isArray(goals) ? goals.filter(Boolean) : (goals ? [goals] : []);
  const cardioWanted = goalList.some(g => CARDIO_GOALS.has(g));
  return effectiveLevel(level, assessment, cardioWanted ? 'endurance' : 'strength');
}

/** How long the starter block runs: 12 weeks from consistent up, else 8. */
export function starterPlanWeeks(effLevel) {
  return LEVEL_ORDER.indexOf(effLevel) >= 2 ? 12 : 8;
}

/**
 * A recent run time as a 5K time, which is what `runningTargets` paces from.
 * A mile or 10K is converted with Riegel's formula (t2 = t1 * (d2/d1)^1.06).
 * Anything unreadable is null, and the plan falls back to untargeted paces.
 */
export function fiveKSecondsFrom(current) {
  const t = Number(current?.timeSec);
  if (!Number.isFinite(t) || t <= 0) return null;
  const km = { '1mi': 1.609, '5k': 5, '10k': 10 }[current?.distance];
  if (!km) return null;
  return Math.round(t * Math.pow(5 / km, 1.06));
}

// Cardio + breath-heavy exercises don't take a literal rep target the way
// barbell lifts do; we set a higher placeholder so the displayed regimen
// reads sensibly ("3 × 30") instead of "3 × 5". Logging is still flexible.
const CARDIO_NAMES = new Set(['Running', 'Cycling', 'Jump Rope', 'Rowing']);
const CARDIO_HIGH_REP_NAMES = new Set(['Mountain Climbers', 'Plank', 'Side Plank']);

// Bodyweight-ratio movements — reps are gated by how much mass you move. A
// heavier beginner is given an achievable rep target on these rather than a
// demoralising one they can't hit on day one.
const BODYWEIGHT_RATIO_NAMES = new Set(['Pull-Up', 'Push-Up']);

// ── Pre-flight: assert every named exercise resolves. Runs at import time. ──
Object.values(GOAL_EXERCISES).forEach(list => list.forEach(EX));

// ── Cardio session library ──────────────────────────────────────────────────
// Real running sessions scaled by the user's target event + intent (faster vs
// further) + level. Sessions keep the real modality name ('Running') so they
// stay loggable, but carry a displayName + `detail` that describe the actual
// workout (distance / pace / intervals) instead of a meaningless "3 × 30".
const MI_TO_M = 1609.34;
const CARDIO_EVENT_SCALE = {
  //                                                                            reps × repMeters @ zone
  '5k':       { label: '5K',             easyMi: 2.5, longMi: 4,  tempoMin: 15, interval: '6 × 400 m', reps: 6, repMeters: 400,  intervalZone: 'interval' },
  '10k':      { label: '10K',            easyMi: 3.5, longMi: 6,  tempoMin: 20, interval: '5 × 800 m', reps: 5, repMeters: 800,  intervalZone: 'interval' },
  'half':     { label: 'Half Marathon',  easyMi: 4,   longMi: 9,  tempoMin: 25, interval: '4 × 1 mi',  reps: 4, repMeters: 1609, intervalZone: 'threshold' },
  'marathon': { label: 'Marathon',       easyMi: 5,   longMi: 14, tempoMin: 30, interval: '5 × 1 km',  reps: 5, repMeters: 1000, intervalZone: 'threshold' },
  'general':  { label: 'General fitness', easyMi: 3,  longMi: 5,  tempoMin: 18, interval: '8 × 200 m', reps: 8, repMeters: 200,  intervalZone: 'rep' },
};

function cardioSession(displayName, detail, { meters = null, minutes = null } = {}) {
  const lib = EX('Running');
  return {
    name: 'Running',
    displayName,
    kind: 'cardio',
    detail,
    target_distance_m: meters ? Math.round(meters) : null,
    target_duration_s: minutes ? Math.round(minutes * 60) : null,
    // Loggable placeholder so the regimen still renders in older list views.
    target_sets: 1,
    target_reps: 1,
    muscle_groups: lib.muscles,
    muscle_group: lib.muscles[0],
    notes: '',
  };
}

// Build the week's running sessions. `speed` (Run faster) adds intervals +
// tempo; `distance` (Run further) adds a long run; a long target event (half /
// marathon) always includes a long run. When `targets` (from
// runningTargets(current5kSec)) is present, each session carries the runner's
// real pace for that zone — otherwise the detail stays effort-based (which is
// what onboarding/tests without a known 5K time expect).
function buildCardioSessions({ event, speed, distance, level, targets } = {}) {
  const scale = CARDIO_EVENT_SCALE[event] || CARDIO_EVENT_SCALE.general;
  const factor = (level === 'newbie' || level === 'returning') ? 0.7
    : level === 'advanced' ? 1.15 : 1;
  const mi = (m) => Math.max(1, Math.round(m * factor * 2) / 2); // nearest 0.5 mi, min 1
  const z = targets?.zones;
  const at = (zone) => (z ? ` @ ${formatPace(z[zone].perMile)}/mi` : ''); // e.g. " @ 8:05/mi"

  const easyMi = mi(scale.easyMi);
  const sessions = [cardioSession('Easy Run', `${easyMi} mi${at('easy')} · conversational pace`, { meters: easyMi * MI_TO_M })];
  if (speed) {
    let intervalDetail;
    if (z) {
      const zoneKey = scale.intervalZone || 'interval';
      const perKm = z[zoneKey].perKm;
      intervalDetail = `${scale.reps} × ${scale.repMeters} m @ ${formatClock(repTime(perKm, scale.repMeters))}/rep · full recovery`;
    } else {
      intervalDetail = `${scale.interval} · hard efforts, full recovery`;
    }
    sessions.push(cardioSession('Interval Run', intervalDetail));
    const tempoMin = Math.round(scale.tempoMin * factor);
    sessions.push(cardioSession('Tempo Run', `${tempoMin} min${at('threshold')} · comfortably hard`, { minutes: tempoMin }));
  }
  if (distance || event === 'half' || event === 'marathon') {
    const longMi = mi(scale.longMi);
    sessions.push(cardioSession('Long Run', `${longMi} mi${at('long')} · easy, add distance weekly`, { meters: longMi * MI_TO_M }));
  }
  if (sessions.length < 2) {
    const em = mi(scale.easyMi);
    sessions.push(cardioSession('Steady Run', `${em} mi${at('easy')} · steady effort`, { meters: em * MI_TO_M }));
  }
  return sessions;
}

/**
 * Build a deterministic regimen payload from the user's onboarding inputs.
 * Pure function — no I/O. The returned object is ready to hand to
 * `regimens.create()`.
 *
 * @param {Object} input
 * @param {string[]} input.goals       - Goal IDs; goals[0] drives the core pool,
 *                                       secondary goals add one accessory each.
 * @param {string|null} input.level    - 'newbie'|'returning'|'consistent'|'advanced'.
 * @param {number} input.daysCount     - Training days/week — widens the plan's
 *                                       scope but thins per-session volume.
 * @param {Object} [input.assessment]  - Fitness self-assessment (mig 129); raises
 *                                       the effective level for capable athletes.
 * @param {string} [input.cardioPreference] - running|cycling|jump_rope (endurance).
 * @param {Array}  [input.injuries]    - [{muscleGroup, severity}]; EVERY severity
 *                                       is excluded, mild included, so the plan
 *                                       agrees with what the generator does from
 *                                       the second session onwards.
 * @param {string} [input.equipment]   - gym|dumbbells|minimal|bodyweight; swaps
 *                                       what the user can't do for what they can.
 * @param {number} [input.sessionMinutes] - 30|45|60|90; caps exercises per session.
 * @param {number} [input.age]         - Caps volume for older lifters (55+ / 65+).
 * @param {number} [input.bodyFatPct]  - High BF on a strength/muscle goal adds
 *                                       a conditioning exercise.
 * @param {string} [input.gender]      - 'male'|'female'|'other'; female's greater
 *                                       fatigue-resistance nudges hypertrophy reps up.
 * @param {number} [input.weightKg]    - With height → BMI (conditioning + reps).
 * @param {number} [input.heightCm]    - With weight → BMI (conditioning + reps).
 * @returns {Object} regimen payload
 */
export function buildStarterRegimen({ goals, level, daysCount, assessment, cardioEvent, strengthFocus, injuries, age, bodyFatPct, gender, weightKg, heightCm, current5kSec, equipment, sessionMinutes } = {}) {
  const goalList = Array.isArray(goals) ? goals.filter(Boolean) : (goals ? [goals] : []);
  const primary = goalList[0] || 'strength';
  const goalTitle = GOAL_TITLES[primary] || GOAL_TITLES.strength;

  // Cardio (Run faster / Run further) is generated as real running sessions;
  // everything else drives the strength block.
  const cardioWanted = goalList.some(g => CARDIO_GOALS.has(g));
  const speedWanted = goalList.includes('speed');
  const distanceWanted = goalList.includes('endurance');

  // Strength pool: first non-cardio goal, else runner-support calisthenics for a
  // cardio-only user (so a pure runner still gets injury-proofing work).
  const strengthGoals = goalList.filter(g => !CARDIO_GOALS.has(g) && GOAL_EXERCISES[g]);
  const goalKey = strengthGoals[0] || (cardioWanted ? 'run_support' : 'strength');
  let exerciseNames = [...GOAL_EXERCISES[goalKey]];

  // Strength focus (onboarding "sharpen") → lead the pool with the user's picks.
  // Only while a strength or muscle goal is set: that is when the step shows
  // the lifts, so picks left over from a goal the user has since dropped
  // must not put Bench Press at the top of a fat loss plan.
  const focusApplies = goalList.some(g => g === 'strength' || g === 'muscle');
  const focus = focusApplies && Array.isArray(strengthFocus)
    ? strengthFocus.filter(n => EXERCISE_LIBRARY.some(e => e.name === n))
    : [];
  if (focus.length) exerciseNames = [...focus, ...exerciseNames.filter(n => !focus.includes(n))];

  // ── Equipment. Swap before the injury filter so the substitutes are what
  // gets checked against injured regions. A lift the user searched for by
  // name has no row in the table and is kept: they asked for it.
  const kit = TRAINING_EQUIPMENT.includes(equipment) ? equipment : 'gym';
  const fits = (name) => swapForEquipment(name, kit);
  const dedupe = (names) => [...new Set(names.filter(Boolean))];
  exerciseNames = dedupe(exerciseNames.map(fits));

  // ── Injuries. EVERY severity is excluded, mild included.
  //
  // Mild used to stay in with an "Ease in — mild legs flagged." note, on the
  // reasoning that soreness is trainable. The problem was never that reading —
  // it was that the runtime generator disagreed with it. `getExcludedMuscleGroups`
  // drops the region at every severity, so a user who reported a mild knee got
  // a starter plan containing squats and then, from the very next session
  // onwards, never saw a leg exercise again. One of the two had to move, and
  // moving the generator would have meant weakening injury protection on the
  // surface people actually train from.
  //
  // Safety valve below still applies and matters MORE now: with mild excluded
  // too, more users can exclude their way out of their goal's own pool.
  //
  // When that happens we WIDEN THE SEARCH rather than lower the bar. The old
  // fallback kept "the three exercises hitting the fewest injured areas" —
  // fewest, not none — so the moment it fired it handed back work on regions
  // the user had just flagged. Measured with five injuries across five
  // regions it returned Overhead Press, Barbell Row and Pull-Up against a
  // serious shoulder and a moderate back. It never looked outside the goal's
  // six-or-so curated exercises, while EXERCISE_LIBRARY holds 394 and the
  // injury vocabulary is only eight groups, so something clean almost always
  // existed one search away.
  //
  // Cascade, most-appropriate first:
  //   1. the goal's own pool, injury-filtered           (unchanged)
  //   2. every other curated goal pool — real, sensible picks we already ship
  //   3. the whole library, most-isolated first (fewest muscles), so what we
  //      reach for last is a single-joint movement rather than something
  //      obscure that happens to sort early
  //
  // Every tier requires touching NO injured area. Nothing here can hand back
  // work on a flagged region, which is what the onboarding copy promises.
  const injList = Array.isArray(injuries) ? injuries : [];
  const excludeSet = new Set(
    injList.map(i => (i && i.muscleGroup) || i).filter(Boolean),
  );
  // `EXERCISE_LIBRARY` tags two muscles that are NOT injury groups, and a
  // plain `set.has(m)` test can therefore never exclude them: **Full Body**
  // and **Cardio**. They are also the most loading things in the library, so
  // the filter was blindest exactly where it needed to be sharpest — asked
  // for a plan around eight injured groups it returned Jump Rope, Clean and
  // Jerk and Ground to Overhead, every one of which loads all of them.
  //
  // So a tag expands to what it actually loads. Full Body means everything.
  // Cardio here is running, jumping rope and mountain climbers — leg-driven
  // and braced through the trunk — so it counts as legs and core rather than
  // as nothing.
  // Traps is the third such tag, and it arrived the same way: the four neck
  // exercises were retagged off 'Full Body' (which had them loading all eight
  // groups) onto the nearest real mover. Left bare it would have swung the
  // filter the other way — 'Traps' matches no injury group, so a serious back
  // injury stopped excluding neck bridges and the every-region-flagged plan
  // answered with three of them. It loads the back, and that is what the
  // heat-map already resolves it to.
  //
  // 'Forearms' is the fourth tag outside the injury groups and is DELIBERATELY
  // absent from this map — the one case where the right answer was to let the
  // exclusion go. It arrived the same way Traps did, when the grip and wrist
  // work was retagged off 'Back', so adding it here would have been the
  // reflex. But a back injury excluding a seated wrist curl was never a rule;
  // it was a side effect of those exercises being mislabelled as back work.
  // The grip movements that genuinely load the back — the hangs, Farmers
  // Walk, Fat Bar Deadlift, Towel Pull-Up — kept their own 'Back' tag and are
  // still excluded through it, which is why nothing here has to fake it.
  // 'Full Body' lists every injurable region, so it gained 'Forearms' when
  // that became one. It is a CONSISTENCY GUARD and changes no plan today —
  // the commit that added it claimed otherwise and was wrong. Swept all 512
  // injury subsets across three severities and five goals: 7,680 plans,
  // byte-identical with and without it. The reason is that no Full Body
  // exercise is reachable here at all. The curated goal pools hold none, and
  // the full-library fallback only opens once so much is flagged that the
  // other eight entries have already excluded every clean and snatch.
  // Keep it anyway — without it 'Full Body' means "everything except the
  // grip", which is false, and it would become a live bug the moment an
  // Olympic lift enters a goal pool.
  const IMPLIED_LOAD = {
    'Full Body': ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms', 'Legs', 'Glutes', 'Core'],
    Cardio: ['Legs', 'Core'],
    Traps: ['Back'],
  };
  const loads = (muscle) => [muscle, ...(IMPLIED_LOAD[muscle] || [])];
  const trains = (name, set) => EX(name).muscles.some(m => loads(m).some(g => set.has(g)));
  if (excludeSet.size) {
    const clean = exerciseNames.filter(n => !trains(n, excludeSet));
    if (clean.length >= 2) {
      exerciseNames = clean;
    } else {
      const taken = new Set(clean);
      const safe = (n) => !taken.has(n) && !trains(n, excludeSet);

      // 2 — the other curated pools, in declaration order.
      const curated = dedupe(Object.values(GOAL_EXERCISES).flat().map(fits)).filter(safe);
      const widened = [...clean];
      for (const n of curated) {
        if (widened.length >= 3) break;
        if (!taken.has(n)) { widened.push(n); taken.add(n); }
      }

      // 3 — the full library, most-isolated first. Name breaks ties so the
      // same injuries always produce the same plan.
      if (widened.length < 2) {
        const rest = EXERCISE_LIBRARY
          .filter(e => safe(e.name))
          .filter(e => kit === 'gym' || EQUIPMENT_KINDS[kit].has(classifyEquipment(e.name)))
          .sort((a, b) => (a.muscles.length - b.muscles.length) || a.name.localeCompare(b.name));
        for (const e of rest) {
          if (widened.length >= 3) break;
          widened.push(e.name);
          taken.add(e.name);
        }
      }

      // Still nothing means every group the library knows about is flagged —
      // only reachable outside onboarding, which caps at 5 injuries across 8
      // groups. The strength block is then genuinely empty, and
      // ensureStarterRegimen declines to persist an exercise-less regimen
      // rather than shipping a plan that is a lie either way.
      exerciseNames = widened;
    }
  }

  // ── Training days → scope. Fewer days = a compact full-body session; more
  // days = broader scope / more weekly volume. Trim keeps the compound-first
  // ordering of each pool.
  const safeDays = Number.isFinite(daysCount) && daysCount > 0 ? daysCount : 3;
  // Keep the strength block leaner when cardio sessions also fill the week.
  const sessionCap = sessionExerciseCap(sessionMinutes);
  const strengthCap = Math.min(sessionCap, cardioWanted ? Math.min(4, targetExerciseCount(safeDays)) : targetExerciseCount(safeDays));
  exerciseNames = exerciseNames.slice(0, strengthCap);

  // ── Extras: one accessory per SECONDARY goal (so a strength+mobility plan
  // shows both), plus a conditioning nudge when adiposity is high (body fat OR
  // BMI) on a strength/muscle goal. Injury-safe, deduped, capped at 8.
  const bmi = bmiFrom(weightKg, heightCm);
  const highAdiposity =
    (Number.isFinite(bodyFatPct) && bodyFatPct >= 25) ||
    (Number.isFinite(bmi) && bmi >= 30);
  // Keep the strength block small when cardio sessions also fill the week, so
  // the combined plan never blows past 8 items.
  const maxStrength = Math.min(sessionCap, cardioWanted ? 4 : 8);
  const addExtra = (raw) => {
    const name = raw && fits(raw);
    if (!name || exerciseNames.includes(name) || trains(name, excludeSet) || exerciseNames.length >= maxStrength) return;
    exerciseNames = [...exerciseNames, name];
  };
  for (const g of goalList.slice(1)) {
    if (CARDIO_GOALS.has(g) || g === goalKey) continue; // cardio goals become sessions
    addExtra(GOAL_ACCESSORY[g]);
  }
  if (highAdiposity && (goalKey === 'strength' || goalKey === 'muscle')) {
    addExtra('Mountain Climbers');
  }

  // ── Volume. Base scheme from the effective (assessment-aware) level, then the
  // INVERSE days adjustment (fewer days → more per session, more days → less),
  // then the age recovery cap — with a floor so a starter plan never dips below
  // 2 working sets.
  const effLevel = effectiveLevel(level, assessment, cardioWanted ? 'endurance' : goalKey);
  const setsReps = LEVEL_SETS_REPS[effLevel] || LEVEL_SETS_REPS.newbie;
  let sets = setsReps.sets + daysVolumeAdjust(safeDays);
  sets = Math.min(sets, ageSetsCap(age));
  // Half an hour does not fit four sets of four exercises with rest.
  if (Number.isFinite(sessionMinutes) && sessionMinutes <= 30) sets = Math.min(sets, 3);
  sets = Math.max(2, sets);
  // The Workout page refuses to save a session past the lifter's realistic
  // limits (detectImplausibleWorkout), so a plan finished exactly as written
  // must stay inside them. Per exercise here; the session total is fitted
  // once the cardio block is known, below.
  const saveLimits = { age, gender, weight_lbs: Number.isFinite(weightKg) ? weightKg * 2.20462 : undefined };
  sets = Math.min(sets, getMaxSetsPerExercise(saveLimits));
  const reps = setsReps.reps;
  const female = gender === 'female';

  let strengthExercises = exerciseNames.map(name => {
    const libEntry = EX(name);
    let targetReps = reps;
    if (CARDIO_NAMES.has(name)) targetReps = 30;
    else if (CARDIO_HIGH_REP_NAMES.has(name)) targetReps = 20;
    else {
      // Female average fatigue-resistance → a touch more reps, but only in
      // hypertrophy/endurance ranges (≥8); never in the ≤5 max-strength scheme,
      // which would blur its purpose.
      if (female && targetReps >= 8) targetReps += 2;
      // Heavier (high-BMI) beginners get an achievable target on bodyweight-
      // ratio lifts instead of a rep count they can't reach on day one.
      if (Number.isFinite(bmi) && bmi >= 30 && BODYWEIGHT_RATIO_NAMES.has(name)) {
        targetReps = Math.min(targetReps, 8);
      }
    }
    return {
      name,
      displayName: name,
      kind: 'strength',
      muscle_groups: libEntry.muscles,
      // RegimenForm sets muscle_group to the first of muscle_groups for
      // backwards-compat with older renderers that read the singular field.
      muscle_group: libEntry.muscles[0],
      target_sets: sets,
      target_reps: targetReps,
      // No note. This used to carry "Ease in — mild X flagged." for a region
      // the plan had deliberately kept; nothing reaches this branch any more,
      // because a mild region is excluded like every other severity.
      notes: '',
    };
  });

  // Real running sessions for cardio goals, scaled by target event + level.
  // Injury-safe: an injury to a muscle running works (legs, core) drops the
  // running block — the injury step promises we work around it, so the
  // runner-support strength stands in instead of pounding a hurt knee. Now
  // that mild is excluded too, a mild knee drops the running block as well,
  // which is the same call the rest of the plan makes.
  const cardioSafe = !(excludeSet.size && trains('Running', excludeSet));
  const cardioTargets = current5kSec > 0 ? runningTargets(current5kSec) : null;
  const cardioExercises = cardioWanted && cardioSafe
    ? buildCardioSessions({ event: cardioEvent, speed: speedWanted, distance: distanceWanted, level: effLevel, targets: cardioTargets })
    : [];

  // Session total. A consistent lifter on one day a week gets 5 x 5 = 25 sets,
  // over a 26 year old woman's limit of 21, and the save was refused on the
  // very first session. Drop trailing accessories first, down to three lifts,
  // so each lift keeps its full scheme: fewer lifts done properly beats every
  // lift cut short. Only then share what is left evenly.
  const cardioSets = cardioExercises.reduce((n, e) => n + (e.target_sets || 0), 0);
  const setBudget = getMaxRealisticSetsPerWorkout(saveLimits) - cardioSets;
  // The conditioning move added for a high body fat lifter is the reason that
  // lifter's plan differs, so it is the last thing to go.
  while (strengthExercises.length > 3 && strengthExercises.length * sets > setBudget) {
    const drop = strengthExercises.findLastIndex((e) => e.name !== 'Mountain Climbers');
    strengthExercises = strengthExercises.filter((_, i) => i !== (drop < 0 ? strengthExercises.length - 1 : drop));
  }
  if (strengthExercises.length) {
    const fit = Math.max(2, Math.floor(setBudget / strengthExercises.length));
    strengthExercises = strengthExercises.map((e) => (e.target_sets > fit ? { ...e, target_sets: fit } : e));
  }
  // And per muscle group: three compound lifts at 6 sets all hit legs. Take a
  // set at a time off the biggest lift on an over-limit group, never below 2.
  for (let guard = 0; guard < 40; guard += 1) {
    const asLogged = [...strengthExercises, ...cardioExercises].map((e) => ({ muscle_groups: e.muscle_groups, sets: { length: e.target_sets || 0 } }));
    const counts = countSetsPerMuscleGroup(asLogged);
    const over = Object.keys(counts).find((g) => counts[g] > getMuscleGroupCap(g, saveLimits));
    if (!over) break;
    const hits = strengthExercises.filter((e) => e.target_sets > 2 && e.muscle_groups?.includes(over));
    if (!hits.length) break;
    const biggest = hits.reduce((a, b) => (b.target_sets > a.target_sets ? b : a));
    strengthExercises = strengthExercises.map((e) => (e === biggest ? { ...e, target_sets: e.target_sets - 1 } : e));
  }

  // Cardio leads the plan for a runner; strength leads for a lifter.
  const exercises = cardioWanted && !strengthGoals.length
    ? [...cardioExercises, ...strengthExercises]
    : cardioWanted
      ? [...strengthExercises, ...cardioExercises]
      : strengthExercises;

  const recoveryNote = Number.isFinite(age) && age >= 55 ? ' · recovery-adjusted' : '';
  const scopeNote = cardioWanted && strengthGoals.length ? ' · strength + cardio' : cardioWanted ? ' · cardio-led' : '';
  const minutesNote = Number.isFinite(sessionMinutes) && sessionMinutes > 0 ? ` · ${sessionMinutes} min` : '';
  const kitNote = kit === 'gym' ? '' : ` · ${kit}`;
  return {
    name: `Your Starter Plan: ${goalTitle}`,
    description: `${effLevel} · ${safeDays}×/week${minutesNote}${kitNote}${recoveryNote}${scopeNote} · auto-generated from onboarding`,
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
  // The read below is keyed on the id, so gate on the id.
  if (!user?.id) return null;

  // Idempotency: bail if anything is already in this user's regimen list.
  // A failed read THROWS. It used to fall through to creation, so a
  // returning user whose read hiccuped got a duplicate starter plan beside
  // the ones they already had. The caller catches and reports it, and
  // "no starter plan this time" is the recoverable outcome of the two.
  const existing = await regimensData.list(user.id, 1);
  if (existing && existing.length > 0) return null;

  const payload = buildStarterRegimen(profile || {});

  // An exercise-less regimen is not a plan, it is an empty screen with a
  // title. buildStarterRegimen only returns one when EVERY muscle group the
  // library knows about is flagged as injured — unreachable from onboarding,
  // which caps at 5 injuries across 8 groups, but reachable from a profile
  // assembled elsewhere. Skipping is the honest outcome: better no starter
  // plan than one that either loads the injuries or renders blank.
  if (!Array.isArray(payload.exercises) || payload.exercises.length === 0) return null;

  return regimensData.create(payload);
}
