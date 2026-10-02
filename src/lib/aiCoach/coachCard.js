// src/lib/aiCoach/coachCard.js
//
// A Coach answer arrives as parts (coach-chat, 2026-10-02): a one-line
// headline, up to four short points and a next step. A point may NAME a
// visual, such as "readiness" or "top_lift: Squat", and this module draws
// the numbers for it from the user's own digest, the same object the model
// read. The model chooses which picture; it never supplies the figures.
// A chart is the most believable thing on a screen, so it is the one thing
// a language model must not be able to invent.
//
// Resolution happens ONCE, when the reply arrives, and the result is stored
// on the message. A thread reopened next week must show the numbers the
// answer was written against, not this week's numbers beside last week's
// sentence.
//
// Anything that does not resolve (no such data, an unknown lift, a muscle
// group the digest does not track) drops to text only. A missing picture is
// a smaller failure than a picture of zero.
//
// Pure. No I/O, no React.

export const TONES = ['go', 'hold', 'wait', 'care', 'info'];
const MAX_POINTS = 4;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// The digest groups sets into six buckets (responders.js classifyExercise).
// The model is told to copy the key, but "quads" or "Legs" should still land.
const MUSCLE_ALIASES = {
  chest: 'chest', pecs: 'chest',
  back: 'back', lats: 'back',
  shoulders: 'shoulders', delts: 'shoulders',
  arms: 'arms', biceps: 'arms', triceps: 'arms',
  legs: 'legs', quads: 'legs', hamstrings: 'legs', glutes: 'legs', calves: 'legs',
  core: 'core', abs: 'core',
};

function findLift(topLifts, ref) {
  if (!Array.isArray(topLifts) || !ref) return null;
  const want = ref.toLowerCase();
  return topLifts.find((l) => String(l?.name || '').toLowerCase() === want)
    || topLifts.find((l) => {
      const n = String(l?.name || '').toLowerCase();
      return n && (n.includes(want) || want.includes(n));
    })
    || null;
}

/**
 * The data behind one visual, or null when the digest cannot back it.
 *
 * @param {string} visual  one of the coach-chat VISUALS
 * @param {string} ref     muscle group or lift name, where the visual needs one
 * @param {object} ctx     the digest from buildCoachContext
 */
export function resolveVisual(visual, ref, ctx) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const units = c.units === 'kg' ? 'kg' : 'lb';
  switch (visual) {
    case 'week_sessions': {
      const done = num(c.training?.sessionsLast7);
      if (done == null) return null;
      const target = num(c.profile?.trainingDaysPerWeek);
      return { type: visual, done, target: target && target > 0 && target <= 7 ? target : null };
    }
    case 'readiness': {
      const score = num(c.recovery?.score100);
      return score == null ? null : { type: visual, score: Math.max(0, Math.min(100, Math.round(score))) };
    }
    case 'sleep': {
      const hours = num(c.recovery?.avgSleepHours);
      return hours == null ? null : { type: visual, hours, days: num(c.recovery?.sleepDaysLogged) };
    }
    case 'soreness': {
      const value = num(c.recovery?.lastSoreness1to5);
      return value == null ? null : { type: visual, value: Math.max(1, Math.min(5, Math.round(value))) };
    }
    case 'calories': {
      const kcal = num(c.nutritionLast7?.avgCaloriesPerLoggedDay);
      const days = num(c.nutritionLast7?.daysLogged);
      return kcal == null || !days ? null : { type: visual, kcal, days: Math.min(7, days) };
    }
    case 'protein': {
      const grams = num(c.nutritionLast7?.avgProteinGPerLoggedDay);
      return grams == null ? null : { type: visual, grams, days: num(c.nutritionLast7?.proteinDaysLogged) };
    }
    case 'muscle_sets': {
      const sets = c.training?.setsByMuscleLast14;
      const key = MUSCLE_ALIASES[String(ref || '').toLowerCase().trim()];
      if (!sets || !key || num(sets[key]) == null) return null;
      return { type: visual, muscle: key, sets: sets[key] };
    }
    case 'top_lift': {
      const lift = findLift(c.topLifts, String(ref || '').trim());
      if (!lift || num(lift.weightLb) == null) return null;
      return {
        type: visual,
        name: String(lift.name),
        weight: lift.weightLb,
        reps: num(lift.reps),
        daysAgo: num(lift.daysAgo),
        units,
      };
    }
    case 'body_trend': {
      const current = num(c.bodyTrend?.currentLb);
      if (current == null) return null;
      return {
        type: visual,
        current,
        change: num(c.bodyTrend?.changeLb),
        overDays: num(c.bodyTrend?.overDays),
        units,
      };
    }
    case 'cardio': {
      const sessions = num(c.cardioLast14?.sessions);
      return !sessions ? null : { type: visual, sessions, minutes: num(c.cardioLast14?.totalMinutes) };
    }
    case 'streak': {
      const days = num(c.streaks?.workoutStreakDays);
      return days == null ? null : { type: visual, days, best: num(c.streaks?.longestWorkoutStreakDays) };
    }
    default:
      return null;
  }
}

/**
 * Turn the function's card into the shape a message stores: every point's
 * visual resolved to data or dropped. Returns null for anything that is not a
 * usable card, so the caller falls back to the text reply.
 */
export function resolveCoachCard(card, ctx) {
  if (!card || typeof card !== 'object') return null;
  const headline = str(card.headline);
  const seen = new Set();
  const points = (Array.isArray(card.points) ? card.points : [])
    .map((p) => {
      const text = str(p?.text);
      if (!text) return null;
      let viz = null;
      if (p?.visual && p.visual !== 'none' && !seen.has(p.visual)) {
        viz = resolveVisual(p.visual, str(p?.ref, 60), ctx);
        if (viz) seen.add(p.visual);
      }
      return { text, viz };
    })
    .filter(Boolean)
    .slice(0, MAX_POINTS);
  if (!headline && !points.length) return null;
  return {
    tone: TONES.includes(card.tone) ? card.tone : 'info',
    headline,
    points,
    next: str(card.next),
  };
}
