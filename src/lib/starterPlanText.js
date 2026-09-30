// src/lib/starterPlanText.js
//
// Localized text for the onboarding starter plan, built at RENDER time from
// structured fields rather than read out of the stored English strings.
//
// Why: `buildStarterRegimen` persists the plan as a regimen row, and the row
// used to carry only English prose — "Easy Run", "2.5 mi @ 8:05/mi ·
// conversational pace", "Your Starter Plan: Build Strength". A Spanish or
// French user read all of it in English, forever, because a string stored in
// a row is past the reach of any translation catalog.
//
// So each run now also carries a stable `session` id and `sessionParams`
// (distance + unit, pace, minutes, reps × rep length, rep time), and every
// surface that shows a run asks this module for its text. The English
// `displayName` / `detail` are still written, and they are what a row made
// before this existed falls back to.
//
// The regimen NAME keeps its stored English prefix on purpose: Workout.jsx
// finds the starter plan by `name.startsWith('Your Starter Plan')`. Only the
// rendering is translated.
//
// Pure: no React, no db. The translator is passed in with `tFallback`'s
// signature (see translatorArg.js), and it is named `tf` here so the orphan
// key scan sees every literal key.

import { asT, enT } from '@/lib/translatorArg';
import { formatNumber } from '@/lib/intlFormat';

export const STARTER_PLAN_PREFIX = 'Your Starter Plan';

// Goal ids (from GOALS in Onboarding.jsx) to the English title the builder
// writes after the prefix. Single source: starterRegimen imports this.
export const STARTER_GOAL_TITLES = {
  strength:  'Build Strength',
  muscle:    'Add Muscle',
  lose:      'Lose Fat',
  speed:     'Run Faster',
  endurance: 'Run Further',
  mobility:  'Move Better',
};

/** True for a regimen name the starter builder wrote. */
export function isStarterPlanName(name) {
  return typeof name === 'string' && name.startsWith(STARTER_PLAN_PREFIX);
}

function goalTitle(id, tf) {
  switch (id) {
    case 'strength':  return tf('starterPlan.goal.strength', STARTER_GOAL_TITLES.strength);
    case 'muscle':    return tf('starterPlan.goal.muscle', STARTER_GOAL_TITLES.muscle);
    case 'lose':      return tf('starterPlan.goal.lose', STARTER_GOAL_TITLES.lose);
    case 'speed':     return tf('starterPlan.goal.speed', STARTER_GOAL_TITLES.speed);
    case 'endurance': return tf('starterPlan.goal.endurance', STARTER_GOAL_TITLES.endurance);
    case 'mobility':  return tf('starterPlan.goal.mobility', STARTER_GOAL_TITLES.mobility);
    default:          return null;
  }
}

/**
 * "Your Starter Plan: Build Strength" in the reader's language. Any other
 * name (a regimen the user typed, or a starter plan they renamed) is
 * returned untouched.
 */
export function starterPlanName(name, t) {
  const tf = asT(t);
  const prefix = `${STARTER_PLAN_PREFIX}: `;
  if (typeof name !== 'string' || !name.startsWith(prefix)) return name;
  const suffix = name.slice(prefix.length).trim();
  const id = Object.keys(STARTER_GOAL_TITLES).find((k) => STARTER_GOAL_TITLES[k] === suffix);
  const goal = (id && goalTitle(id, tf)) || suffix;
  return tf('starterPlan.name', 'Your Starter Plan: {goal}', { goal });
}

function descriptionPiece(piece, tf) {
  const p = piece.trim();
  switch (p) {
    case 'newbie':     return tf('workout.starter.level.newbie', 'Beginner');
    case 'returning':  return tf('workout.starter.level.returning', 'Returning');
    case 'consistent': return tf('workout.starter.level.consistent', 'Consistent');
    case 'advanced':   return tf('workout.starter.level.advanced', 'Advanced');
    case 'dumbbells':  return tf('starterPlan.desc.kit.dumbbells', 'dumbbells');
    case 'minimal':    return tf('starterPlan.desc.kit.minimal', 'minimal kit');
    case 'bodyweight': return tf('starterPlan.desc.kit.bodyweight', 'bodyweight');
    case 'recovery-adjusted': return tf('starterPlan.desc.recovery', 'recovery-adjusted');
    case 'strength + cardio': return tf('starterPlan.desc.strengthCardio', 'strength + cardio');
    case 'cardio-led': return tf('starterPlan.desc.cardioLed', 'cardio-led');
    case 'auto-generated from onboarding': return tf('starterPlan.desc.auto', 'auto-generated from onboarding');
    default: break;
  }
  let m = p.match(/^(\d+)×\/week$/);
  if (m) return tf('workout.starter.daysPerWeek', '{n}×/week', { n: Number(m[1]) });
  m = p.match(/^(\d+) min$/);
  if (m) return tf('starterPlan.desc.minutes', '{n} min', { n: Number(m[1]) });
  return p;
}

/**
 * The starter plan's description ("consistent · 3×/week · 45 min ·
 * auto-generated from onboarding") with each known piece translated. The
 * builder writes it from a fixed vocabulary, so it can be read back piece by
 * piece; anything unrecognised (a user edit) passes through as written.
 * Call it only for a starter plan (see `isStarterPlanName`).
 */
export function starterPlanDescription(description, t) {
  if (typeof description !== 'string' || !description) return description;
  const tf = asT(t);
  return description.split(' · ').map((p) => descriptionPiece(p, tf)).join(' · ');
}

// ── Runs ─────────────────────────────────────────────────────────────────────

export const CARDIO_SESSION_IDS = ['easy', 'interval', 'tempo', 'long', 'steady'];

function hasStructure(ex) {
  return !!ex && CARDIO_SESSION_IDS.includes(ex.session)
    && ex.sessionParams && typeof ex.sessionParams === 'object';
}

/** "Easy Run", localized. Falls back to the stored name on an old row. */
export function cardioSessionName(ex, t) {
  const tf = asT(t);
  switch (ex?.session) {
    case 'easy':     return tf('starterPlan.run.easy', 'Easy Run');
    case 'interval': return tf('starterPlan.run.interval', 'Interval Run');
    case 'tempo':    return tf('starterPlan.run.tempo', 'Tempo Run');
    case 'long':     return tf('starterPlan.run.long', 'Long Run');
    case 'steady':   return tf('starterPlan.run.steady', 'Steady Run');
    default:         return ex?.displayName || ex?.name || '';
  }
}

// How one repeat is named: "400 m", "1 km", "1 mi" (imperial only), "1.6 km".
function repLabel(meters, unit, language) {
  const m = Number(meters) || 0;
  if (unit === 'mi' && Math.abs(m - 1609) <= 1) return '1 mi';
  if (m >= 1000) return `${formatNumber(Math.round(m / 100) / 10, language, { maximumFractionDigits: 1 })} km`;
  return `${m} m`;
}

/**
 * The two halves of a run's detail: what to run ("2.5 mi @ 8:05/mi") and how
 * it should feel ("conversational pace"). Null on a row with no structure.
 */
function detailParts(ex, tf, language) {
  if (!hasStructure(ex)) return null;
  const p = ex.sessionParams;
  const unit = p.unit === 'km' ? 'km' : 'mi';
  const num = (n) => formatNumber(n, language, { maximumFractionDigits: 1 });
  const pace = typeof p.pace === 'string' && p.pace ? p.pace : null;

  const distance = () => (pace
    ? tf('starterPlan.run.distancePace', '{distance} {unit} @ {pace}/{unit}', { distance: num(p.distance), unit, pace })
    : tf('starterPlan.run.distance', '{distance} {unit}', { distance: num(p.distance), unit }));

  switch (ex.session) {
    case 'easy':
      return [distance(), tf('starterPlan.cue.easy', 'conversational pace')];
    case 'long':
      return [distance(), tf('starterPlan.cue.long', 'easy, add distance weekly')];
    case 'steady':
      return [distance(), tf('starterPlan.cue.steady', 'steady effort')];
    case 'tempo':
      return [
        pace
          ? tf('starterPlan.run.minutesPace', '{minutes} min @ {pace}/{unit}', { minutes: p.minutes, pace, unit })
          : tf('starterPlan.run.minutes', '{minutes} min', { minutes: p.minutes }),
        tf('starterPlan.cue.tempo', 'comfortably hard'),
      ];
    case 'interval': {
      const rep = repLabel(p.repMeters, unit, language);
      const time = typeof p.repTime === 'string' && p.repTime ? p.repTime : null;
      return time
        ? [tf('starterPlan.run.repsTime', '{reps} × {rep} @ {time}/rep', { reps: p.reps, rep, time }),
          tf('starterPlan.cue.recovery', 'full recovery')]
        : [tf('starterPlan.run.reps', '{reps} × {rep}', { reps: p.reps, rep }),
          tf('starterPlan.cue.hardRecovery', 'hard efforts, full recovery')];
    }
    default:
      return null;
  }
}

/** The whole detail line, localized. Stored `detail` on an old row. */
export function cardioSessionDetail(ex, t, language = 'en') {
  const parts = detailParts(ex, asT(t), language);
  return parts ? parts.join(' · ') : (ex?.detail || '');
}

/** Only the "what to run" half, for compact rows. */
export function cardioSessionSummary(ex, t, language = 'en') {
  const parts = detailParts(ex, asT(t), language);
  return parts ? parts[0] : String(ex?.detail || '').split(' · ')[0];
}

/** English, for the builder's back-compat `displayName` / `detail`. */
export function englishSessionText(ex) {
  return { displayName: cardioSessionName(ex, enT), detail: cardioSessionDetail(ex, enT, 'en') };
}
