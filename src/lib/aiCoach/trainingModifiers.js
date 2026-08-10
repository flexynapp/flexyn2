// src/lib/aiCoach/trainingModifiers.js
//
// Turns context — training goal, diet phase, menstrual-cycle phase and an
// optional "how do you feel today?" check-in — into a small set of numeric
// nudges that generateWorkout() applies to load, sets, reps and rest.
//
// Pure. No I/O, no React. Callers fetch the context and pass it in.
//
// ── Why the cycle nudges are deliberately small ─────────────────────────
//
// The popular version of cycle-based training ("follicular = peak strength
// window, go heavy") is not well supported. A 2023 systematic review in
// Frontiers in Sports and Active Living found no reliable effect of cycle
// phase on acute strength performance OR on adaptations to resistance
// training, and concluded the follicular-superiority idea rests on a small
// number of papers. A 2022 Sports Medicine meta-analysis found a possible
// small advantage for follicular-emphasis training but flagged the evidence
// as low certainty with high between-study heterogeneity.
//
// ACSM's guidance, and the direction the field has moved, is to adapt to
// SYMPTOMS and individual response rather than prescribe from phase alone,
// because the variation between two women in the same phase is larger than
// the average difference between phases.
//
// So phase here is a hint of at most ±5% load, never a block on training,
// and the moment the user tells us how they actually feel that answer wins.
// The one phase effect with decent mechanistic support is connective-tissue
// laxity around the estrogen peak (late follicular / ovulation), which is
// associated with elevated ACL injury risk — that surfaces as a warm-up and
// landing-mechanics note rather than as a load change.
//
// Everything returned here is advisory and additive; with no context at all
// the modifiers are identity (×1.0, +0, +0) and the generated workout is
// byte-identical to what it was before this module existed.

import { asT } from './coachI18n';
import { formatList } from '@/lib/intlFormat';

// Every note below carries `noteKey` beside its English. The English stays
// in the table rather than moving to i18n-coach.js alone, because it is the
// tFallback fallback — a locale with no coach translations must render this
// exact sentence, and keeping it at the point of use is what stops the two
// drifting. See coachI18n.js for why `t` arrives as an argument.

/** Optional daily check-in. When present it overrides the phase load nudge. */
export const FEEL = {
  good:  'good',
  ok:    'ok',
  rough: 'rough',
};

export const FEEL_OPTIONS = [
  // labelKey/hintKey are for WorkoutQuickGenerator, which renders these and
  // HAS a hook. The English stays as the tFallback fallback.
  { id: FEEL.good,  label: 'Good',  emoji: '💪', hint: 'Strong, ready to push',
    labelKey: 'coach.feel.good.label',  hintKey: 'coach.feel.good.hint' },
  { id: FEEL.ok,    label: 'OK',    emoji: '👍', hint: 'Normal day',
    labelKey: 'coach.feel.ok.label',    hintKey: 'coach.feel.ok.hint' },
  { id: FEEL.rough, label: 'Rough', emoji: '🥱', hint: 'Tired, sore or cramping',
    labelKey: 'coach.feel.rough.label', hintKey: 'coach.feel.rough.hint' },
];

// Load multipliers are intentionally shallow. ±5% is inside the noise of a
// normal day's readiness — enough to change the suggested top set by one
// plate increment, not enough to derail a training block if the phase
// estimate is wrong (and with a predicted cycle, it often is).
const CYCLE_RULES = {
  menstrual: {
    load: 0.95,
    restSec: 15,
    noteKey: 'coach.note.cycle.menstrual',
    note: 'Period week — starting ~5% lighter. If cramps or fatigue hit, drop a set; if you feel fine, ignore this and train as normal.',
  },
  follicular: {
    load: 1.0,
    restSec: 0,
    noteKey: 'coach.note.cycle.follicular',
    note: 'Follicular phase. Many people feel strongest here, but the evidence is mixed — go by how the warm-up sets move, not the calendar.',
  },
  ovulation: {
    load: 1.0,
    restSec: 0,
    // The one phase note that is NOT hedged: oestrogen peak is associated
    // with greater ligament laxity and elevated ACL injury risk.
    noteKey: 'coach.note.cycle.ovulation',
    note: 'Around ovulation, oestrogen peaks and ligaments sit a little laxer — take an extra warm-up set and be strict on knee tracking in squats, lunges and any landing.',
  },
  luteal: {
    load: 0.95,
    restSec: 15,
    noteKey: 'coach.note.cycle.luteal',
    note: 'Luteal phase — core temperature runs higher and the same weight can feel heavier. Longer rests are built in; judge the session on effort, not the number.',
  },
};

// Diet. Training under a deficit protects strength best by holding intensity
// and cutting VOLUME — so a deficit removes a set rather than lightening the
// bar. A surplus buys back that set.
const DIET_RULES = {
  lose: {
    sets: -1,
    noteKey: 'coach.note.diet.lose',
    note: 'You are eating in a deficit, so this session trims a set and keeps the weight heavy — intensity is what protects strength while cutting.',
  },
  gain: {
    sets: +1,
    noteKey: 'coach.note.diet.gain',
    note: 'You are eating in a surplus — there is room for an extra set.',
  },
  maintain: { sets: 0, note: '' },
};

// ── Post-workout fuel, filtered against allergies and dietary restrictions ──
//
// The coach should never name a food the user has told us they cannot eat.
// `avoids` lists the restriction / allergen ids from nutritionPlans.js
// (DIETARY_RESTRICTIONS + ALLERGENS) that rule each option out. The first
// option that clashes with nothing wins; if a user's combination rules out
// every named option we fall back to unnamed macros rather than guessing.
//
// Note that halal / kosher are treated as ruling out the meat options here.
// That is stricter than reality — certified meat is fine — but the coach has
// no way to know whether the user's chicken is certified, and a wrong
// suggestion is worse than a vaguer one.
const FUEL_OPTIONS = [
  { text: 'Greek yogurt and some fruit', key: 'coach.fuel.greek_yogurt_and_some_fruit', avoids: ['dairy_free', 'vegan', 'keto', 'paleo'] },
  { text: 'chicken and rice', key: 'coach.fuel.chicken_and_rice',            avoids: ['vegetarian', 'vegan', 'keto', 'paleo', 'halal', 'kosher'] },
  { text: 'eggs and toast', key: 'coach.fuel.eggs_and_toast',              avoids: ['egg', 'gluten_free', 'vegan', 'keto', 'paleo'] },
  { text: 'salmon and potatoes', key: 'coach.fuel.salmon_and_potatoes',         avoids: ['fish', 'vegetarian', 'vegan', 'keto'] },
  { text: 'a tofu rice bowl', key: 'coach.fuel.a_tofu_rice_bowl',            avoids: ['soy', 'keto', 'paleo'] },
  { text: 'lentils and rice', key: 'coach.fuel.lentils_and_rice',            avoids: ['keto', 'paleo'] },
  { text: 'eggs and avocado', key: 'coach.fuel.eggs_and_avocado',            avoids: ['egg', 'vegan'] },
  { text: 'beef and sweet potato', key: 'coach.fuel.beef_and_sweet_potato',       avoids: ['vegetarian', 'vegan', 'keto', 'halal', 'kosher'] },
  { text: 'chicken and avocado', key: 'coach.fuel.chicken_and_avocado',         avoids: ['vegetarian', 'vegan', 'halal', 'kosher'] },
];

/**
 * Build a post-workout fuel line that respects the user's restrictions.
 * @param {string[]} restrictions ids from DIETARY_RESTRICTIONS / ALLERGENS
 */
export function fuelNote(restrictions = [], t) {
  const T = asT(t);
  const blocked = new Set(
    (Array.isArray(restrictions) ? restrictions : []).map(r => String(r).toLowerCase())
  );
  const safe = FUEL_OPTIONS.find(o => !o.avoids.some(a => blocked.has(a)));
  // The food name is a key of its own rather than being baked into the
  // sentence: a translator needs to render "Greek yogurt and some fruit" in
  // their language, and splitting it out is also what lets the un-named
  // fallback below stay a single separate sentence rather than a template
  // with an awkward hole in it.
  return safe
    ? T('coach.note.fuel.named', 'Refuel within a couple of hours — {food} works.', {
        food: T(safe.key, safe.text),
      })
    : T('coach.note.fuel.generic',
        'Refuel within a couple of hours: a protein source and a carb source that fit your plan.');
}

const FEEL_RULES = {
  good:  { load: 1.05, sets:  0, restSec:   0, noteKey: 'coach.note.feel.good', note: 'You said you feel good — nudged slightly heavier. Stop the set with a rep in reserve.' },
  ok:    { load: 1.0,  sets:  0, restSec:   0, note: '' },
  rough: { load: 0.85, sets: -1, restSec:  30, noteKey: 'coach.note.feel.rough', note: 'You said you feel rough — lighter, shorter and with more rest. Showing up counts; this still maintains.' },
};

// Goal shapes the rep/rest character of the session.
const GOAL_RULES = {
  strength: { repDelta: -2, restSec:  30, label: 'strength',  labelKey: 'coach.goal.strength.label', noteKey: 'coach.note.goal.strength', note: 'Built for strength: lower reps, longer rests.' },
  muscle:   { repDelta:  0, restSec:   0, label: 'muscle',    labelKey: 'coach.goal.muscle.label', noteKey: 'coach.note.goal.muscle', note: 'Built for hypertrophy: moderate reps, moderate rests.' },
  lose:     { repDelta: +2, restSec: -15, label: 'fat loss',  labelKey: 'coach.goal.lose.label', noteKey: 'coach.note.goal.lose', note: 'Built for a cut: slightly higher reps, tighter rests to keep the heart rate up.' },
  endurance:{ repDelta: +4, restSec: -20, label: 'endurance', labelKey: 'coach.goal.endurance.label', noteKey: 'coach.note.goal.endurance', note: 'Built for endurance: higher reps, short rests.' },
  // Onboarding offers these two as well. `speed` trains like conditioning in a
  // lifting session; `mobility` doesn't change loading at all, so it carries a
  // note and no numbers rather than being silently dropped into `general`.
  speed:    { repDelta: +3, restSec: -15, label: 'speed',     labelKey: 'coach.goal.speed.label', noteKey: 'coach.note.goal.speed', note: 'Speed work: keep the bar moving fast and the rests short.' },
  mobility: { repDelta:  0, restSec:   0, label: 'mobility',  labelKey: 'coach.goal.mobility.label', noteKey: 'coach.note.goal.mobility', note: 'Mobility is one of your goals — give the warm-up its full time and take the end-range positions slowly.' },
  general:  { repDelta:  0, restSec:   0, label: 'general',   note: '' },
};

// Rest lengthens with age. Recovery between sets slows as people get older,
// and prescribing a 30-year-old's rest to a 60-year-old quietly turns a
// strength session into a conditioning one because the later sets are run
// under-recovered. This is additive on top of whatever the goal blend asked
// for, and only ever adds time — it never rushes anyone.
function ageRestBonus(age) {
  const a = Number(age);
  if (!Number.isFinite(a) || a <= 40) return 0;
  if (a <= 55) return 10;
  if (a <= 65) return 20;
  return 30;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * Age from the onboarding profile. Prefers `birthday` (which stays correct as
 * the user gets older) and falls back to the `age` column captured at signup.
 * Returns null rather than a guess when neither is usable, so callers can
 * decide — a wrong age silently scaling someone's weights is worse than none.
 */
export function profileAge(profile = {}) {
  if (profile?.birthday) {
    const birth = new Date(profile.birthday);
    if (!Number.isNaN(birth.getTime())) {
      const now = new Date();
      let years = now.getFullYear() - birth.getFullYear();
      const m = now.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) years--;
      if (years >= 0 && years < 120) return years;
    }
  }
  const a = Number(profile?.age);
  return Number.isFinite(a) && a > 0 && a < 120 ? a : null;
}

/**
 * Normalize the many shapes a training goal arrives in (fitness_goals_arr,
 * a CSV fitness_goals string, or a parsed coach goal) into one of the
 * GOAL_RULES keys.
 */
// Order matters for the single-goal answer below: `lose` is tested BEFORE
// `muscle` because "tone up" belongs to the muscle pattern, and the very
// common combined phrasing "lose weight, tone up" is a cut — matching muscle
// first classified it as hypertrophy and handed the user an extra set while
// they were eating in a deficit.
const GOAL_PATTERNS = [
  ['strength',  /strength|stronger|power|\bpr\b/],
  ['lose',      /lose|cut|fat|weight.?loss|lean/],
  ['muscle',    /muscle|hypertroph|bulk|size|tone/],
  ['speed',     /\bspeed\b|sprint|faster|explosive/],
  ['endurance', /endur|cardio|\brun\b|5k|10k|marathon|stamina/],
  ['mobility',  /mobility|flexib|stretch|range of motion/],
];

/**
 * Every goal the input matches, in GOAL_PATTERNS order.
 *
 * Onboarding lets people tick several goals, and a profile carrying
 * "strength, muscle, lose" is normal rather than exotic. Collapsing that to a
 * single winner by fixed priority meant someone who asked for muscle AND fat
 * loss was programmed as pure strength and never saw the other two influence
 * anything — the extra goals were silently discarded.
 */
export function normalizeGoals(raw) {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : [];
  // Match per ENTRY, not against everything joined together. Joining let a
  // stray word in one goal satisfy the pattern for another.
  const found = [];
  for (const [key, re] of GOAL_PATTERNS) {
    if (list.some(item => re.test(String(item).toLowerCase().trim()))) found.push(key);
  }
  return found.length ? found : ['general'];
}

/** The single dominant goal. Kept for callers that want one label. */
export function normalizeGoal(raw) {
  return normalizeGoals(raw)[0];
}

/** Map the profile's nutrition_goal onto a diet direction. */
export function normalizeDiet(nutritionGoal, weeklyRateLbs) {
  const g = String(nutritionGoal || '').toLowerCase();
  if (/lose|cut|deficit/.test(g)) return 'lose';
  if (/gain|bulk|surplus/.test(g)) return 'gain';
  if (g === 'maintain') return 'maintain';
  // No explicit goal — infer from an intended weekly rate if one is set.
  const rate = Number(weeklyRateLbs);
  if (Number.isFinite(rate) && rate <= -0.25) return 'lose';
  if (Number.isFinite(rate) && rate >= 0.25) return 'gain';
  return 'maintain';
}

/**
 * Build the modifier bundle.
 *
 * @param {object}  ctx
 * @param {object}  [ctx.cycleState]  result of computeCycleState(), or null.
 *                                    Only pass this when the user has cycle
 *                                    tracking ENABLED — it is opt-in data.
 * @param {string}  [ctx.feel]        one of FEEL. Overrides the phase load nudge.
 * @param {string}  [ctx.goal]        raw goal (array | csv | keyword)
 * @param {string}  [ctx.nutritionGoal]
 * @param {number}  [ctx.weeklyRateLbs]
 * @returns {{ loadMultiplier:number, setsDelta:number, repDelta:number,
 *             restDeltaSec:number, notes:string[], applied:object }}
 */
export function buildTrainingModifiers({
  cycleState = null,
  feel = null,
  goal = null,
  nutritionGoal = null,
  weeklyRateLbs = null,
  restrictions = [],
  age = null,
  // Defaults to English, so every caller that predates this — and every
  // existing test — gets byte-identical output. Same posture as the three
  // context inputs above. See coachI18n.js.
  t = null,
  language = 'en',
} = {}) {
  const T = asT(t);
  const notes = [];
  const applied = { goal: null, diet: null, cycle: null, feel: null };

  let loadMultiplier = 1;
  let setsDelta = 0;
  let repDelta = 0;
  let restDeltaSec = 0;

  // ── Goal: rep/rest character, blended across every goal the user picked ──
  //
  // Averaged rather than summed. Summing "strength + endurance" would cancel
  // to roughly nothing by luck and "strength + speed" would compound into
  // something neither goal asked for; the mean lands the session honestly
  // between them, which is what someone chasing both actually wants. Someone
  // who ticks every box averages out near neutral, which is also correct —
  // they have expressed no priority.
  const goalKeys = normalizeGoals(goal);
  const rules = goalKeys.map(k => GOAL_RULES[k] || GOAL_RULES.general);
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
  repDelta     += Math.round(mean(rules.map(r => r.repDelta)));
  restDeltaSec += Math.round(mean(rules.map(r => r.restSec)));
  applied.goal  = goalKeys[0];
  applied.goals = goalKeys;

  if (goalKeys.length === 1) {
    if (rules[0].note) notes.push(T(rules[0].noteKey, rules[0].note));
  } else {
    // Name what is being balanced, so a blended session doesn't look like the
    // Coach ignored half the profile.
    //
    // This used to hand-roll English grammar — `labels.slice(0, -1).join(', ')
    // + ' and ' + last` — which is a conjunction no other language forms the
    // same way. `formatList` is the locale's own rule.
    const list = formatList(rules.map(r => T(r.labelKey, r.label)), language);
    notes.push(T(
      'coach.note.goal.blend',
      'Balancing {goals} — reps and rests land between what each one would ask for on its own.',
      { goals: list },
    ));
    // Mobility changes nothing numerically, so its standalone advice would be
    // lost in the blend. Keep it.
    if (goalKeys.includes('mobility')) {
      notes.push(T(GOAL_RULES.mobility.noteKey, GOAL_RULES.mobility.note));
    }
  }

  // ── Diet: volume ──────────────────────────────────────────────────────
  const dietKey = normalizeDiet(nutritionGoal, weeklyRateLbs);
  const dietRule = DIET_RULES[dietKey] || DIET_RULES.maintain;
  setsDelta   += dietRule.sets;
  applied.diet = dietKey;
  if (dietRule.note) notes.push(T(dietRule.noteKey, dietRule.note));
  // Fuel advice is restriction-filtered and only offered when the user is
  // actually pushing calories in one direction — a maintenance day doesn't
  // need to be told what to eat.
  if (dietKey !== 'maintain') {
    notes.push(fuelNote(restrictions, T));
    applied.restrictions = (restrictions || []).length;
  }

  // ── Cycle: small load nudge + phase note ──────────────────────────────
  // Skipped entirely when the caller passes no cycleState, which is what
  // happens whenever cycle tracking is off. No phase, no note, no change.
  const phase = cycleState?.phase;
  const cycleRule = phase ? CYCLE_RULES[phase] : null;
  if (cycleRule) {
    applied.cycle = phase;
    // The feel check-in, when answered, replaces the phase's load guess —
    // a reported symptom beats a predicted phase every time.
    if (!feel) {
      loadMultiplier *= cycleRule.load;
      restDeltaSec   += cycleRule.restSec;
    }
    if (cycleRule.note) notes.push(T(cycleRule.noteKey, cycleRule.note));
  }

  // ── Feel: overrides the phase guess ───────────────────────────────────
  const feelRule = feel ? FEEL_RULES[feel] : null;
  if (feelRule) {
    loadMultiplier *= feelRule.load;
    setsDelta      += feelRule.sets;
    restDeltaSec   += feelRule.restSec;
    applied.feel    = feel;
    if (feelRule.note) notes.push(T(feelRule.noteKey, feelRule.note));
  }

  // ── Age: longer rest ──────────────────────────────────────────────────
  const ageRest = ageRestBonus(age);
  if (ageRest > 0) {
    restDeltaSec += ageRest;
    applied.ageRestSec = ageRest;
    notes.push(T(
      'coach.note.ageRest',
      'Rest is {sec}s longer than the default — recovery between sets slows with age, and rushing it turns a strength session into a conditioning one.',
      { sec: ageRest },
    ));
  }

  return {
    // Hard ceiling on how far context can move the bar in either direction.
    // Compounding diet + cycle + feel must never produce a wild suggestion.
    loadMultiplier: clamp(Number(loadMultiplier.toFixed(3)), 0.8, 1.1),
    setsDelta:      clamp(setsDelta, -1, 1),
    repDelta:       clamp(repDelta, -4, 6),
    // Upper bound is 60, not 45: a strength goal (+30) on a 70-year-old (+30)
    // legitimately wants a full extra minute, and the old 45s ceiling silently
    // collapsed the 55/65/65+ age steps into one value. generateWorkout caps
    // the final figure at 240s anyway, so this cannot run away.
    restDeltaSec:   clamp(restDeltaSec, -30, 60),
    notes,
    applied,
  };
}

export const IDENTITY_MODIFIERS = Object.freeze({
  loadMultiplier: 1,
  setsDelta: 0,
  repDelta: 0,
  restDeltaSec: 0,
  notes: [],
  applied: { goal: null, diet: null, cycle: null, feel: null },
});
