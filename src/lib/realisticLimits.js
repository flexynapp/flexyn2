/**
 * Realistic physiological limits for anti-cheat validation.
 * Values are based on bodyweight multipliers used by strength standards
 * databases (Symmetric Strength, ExRx) for advanced/elite amateur lifters.
 *
 * These are intentionally generous — we want to flag obvious cheating,
 * not annoy strong users. The cap is "world-class amateur + safety margin".
 */

// Exercise-specific bodyweight multipliers keyed by lowercase substrings.
// Evaluated in order; first match wins. Be specific before general.
const EXERCISE_MULTIPLIERS = [
  // ── Powerlifting big three ─────────────────────────────────────────────────
  { match: 'deadlift',           bwMult: 3.5 },
  { match: 'romanian deadlift',  bwMult: 2.8 },
  { match: 'sumo deadlift',      bwMult: 3.5 },
  { match: 'trap bar deadlift',  bwMult: 3.5 },
  { match: 'stiff leg deadlift', bwMult: 2.5 },
  { match: 'deficit deadlift',   bwMult: 3.0 },

  { match: 'back squat',         bwMult: 3.0 },
  { match: 'front squat',        bwMult: 2.5 },
  { match: 'goblet squat',       bwMult: 1.0 },
  { match: 'hack squat',         bwMult: 2.5 },
  { match: 'box squat',          bwMult: 2.8 },
  { match: 'squat',              bwMult: 3.0 },   // fallback squat

  { match: 'bench press',        bwMult: 2.2 },
  { match: 'incline bench',      bwMult: 1.9 },
  { match: 'decline bench',      bwMult: 2.3 },
  { match: 'close grip bench',   bwMult: 1.8 },

  // ── Overhead pressing ─────────────────────────────────────────────────────
  { match: 'overhead press',     bwMult: 1.5 },
  { match: 'military press',     bwMult: 1.5 },
  { match: 'push press',         bwMult: 1.7 },
  { match: 'z press',            bwMult: 1.2 },
  { match: 'dumbbell press',     bwMult: 0.8 }, // per-hand DB, roughly 40% of BW each

  // ── Rows & pulls ─────────────────────────────────────────────────────────
  { match: 'barbell row',        bwMult: 2.0 },
  { match: 'pendlay row',        bwMult: 2.0 },
  { match: 'cable row',          bwMult: 1.8 },
  { match: 'dumbbell row',       bwMult: 1.0 },  // one-arm DB row
  { match: 'chest supported',    bwMult: 1.8 },
  { match: 'row',                bwMult: 2.0 },   // general row fallback

  // ── Arms ─────────────────────────────────────────────────────────────────
  { match: 'barbell curl',       bwMult: 1.0 },
  { match: 'ez bar curl',        bwMult: 1.0 },
  { match: 'dumbbell curl',      bwMult: 0.55 }, // per-hand
  { match: 'hammer curl',        bwMult: 0.55 },
  { match: 'preacher curl',      bwMult: 0.85 },
  { match: 'curl',               bwMult: 1.0 },   // fallback

  { match: 'tricep extension',   bwMult: 0.8 },
  { match: 'skull crusher',      bwMult: 0.85 },
  { match: 'tricep pushdown',    bwMult: 0.7 },
  { match: 'tricep',             bwMult: 0.8 },

  // ── Shoulders (isolation) ─────────────────────────────────────────────────
  { match: 'lateral raise',      bwMult: 0.35 },
  { match: 'front raise',        bwMult: 0.35 },
  { match: 'rear delt',          bwMult: 0.35 },
  { match: 'fly',                bwMult: 0.45 },
  { match: 'flye',               bwMult: 0.45 },

  // ── Legs (isolation) ─────────────────────────────────────────────────────
  { match: 'leg press',          bwMult: 4.5 },  // machine — much more than barbell
  { match: 'leg extension',      bwMult: 0.9 },
  { match: 'leg curl',           bwMult: 0.75 },
  { match: 'hip thrust',         bwMult: 2.5 },
  { match: 'glute bridge',       bwMult: 2.0 },
  { match: 'lunge',              bwMult: 1.0 },
  { match: 'step up',            bwMult: 0.8 },
  { match: 'calf raise',         bwMult: 2.0 },

  // ── Olympic lifts ─────────────────────────────────────────────────────────
  { match: 'clean and jerk',     bwMult: 2.2 },
  { match: 'power clean',        bwMult: 2.0 },
  { match: 'hang clean',         bwMult: 1.8 },
  { match: 'snatch',             bwMult: 1.8 },

  // ── Core ─────────────────────────────────────────────────────────────────
  { match: 'cable crunch',       bwMult: 0.7 },
  { match: 'ab wheel',           bwMult: 0 },    // bodyweight
  { match: 'plank',              bwMult: 0 },
];

/**
 * Returns the max realistic working weight (lbs) for an exercise given the
 * user's profile. Values are generous — aimed at catching obvious cheating,
 * not blocking legitimate strong lifters.
 */
export function getMaxRealisticWeight(exerciseName = '', userProfile = {}) {
  const bodyWeight = Math.min(Number(userProfile.weight_lbs) || 180, 700);
  const gender = userProfile.gender || 'male';
  const genderMult = gender === 'female' ? 0.72 : 1.0;
  const name = exerciseName.toLowerCase();

  let bwMult = 2.5; // conservative fallback for unknown exercises
  for (const entry of EXERCISE_MULTIPLIERS) {
    if (name.includes(entry.match)) {
      bwMult = entry.bwMult;
      break;
    }
  }

  if (bwMult === 0) return 0; // bodyweight exercise — no loaded weight expected

  const cap = Math.round(bodyWeight * bwMult * genderMult);
  // Hard ceiling: 1100 lbs regardless of profile (no human has benched 1100 lbs)
  return Math.min(cap, 1100);
}

/**
 * Returns the max realistic reps for a given set using the inverse Epley
 * formula relative to the exercise's 1RM ceiling.
 *
 *   maxReps = (1RM / weight - 1) / 0.0333
 *
 * Bodyweight / calisthenics exercises use flat caps instead.
 * Minimum return is always 1. Maximum is 60 for weighted, 300 for bodyweight.
 */
export function getMaxRealisticReps(exerciseName = '', weightUsed = 0, userProfile = {}) {
  const name = exerciseName.toLowerCase();

  // Calisthenics — no weight dependency
  const isBodyweight = (
    name.includes('push-up') || name.includes('pushup') ||
    name.includes('sit-up')  || name.includes('situp')  ||
    name.includes('crunch')  ||
    name.includes('plank')   ||
    name.includes('pull-up') || name.includes('pullup') ||
    name.includes('chin-up') || name.includes('chinup') ||
    name.includes('dip')     ||
    name.includes('jumping jack') ||
    name.includes('burpee')  ||
    name.includes('mountain climber') ||
    name.includes('ab wheel') ||
    name.includes('leg raise')
  );
  if (isBodyweight) return 300;

  // No weight entered yet — allow generous default so the field isn't blocked
  if (!weightUsed || weightUsed <= 0) return 60;

  const oneRMCeiling = getMaxRealisticWeight(exerciseName, userProfile);
  if (oneRMCeiling <= 0) return 300; // bodyweight exercise from multiplier table

  // If weight meets or exceeds 1RM ceiling, only 1 rep is physically possible
  if (weightUsed >= oneRMCeiling) return 1;

  // Inverse Epley formula
  const maxReps = Math.floor((oneRMCeiling / weightUsed - 1) / 0.0333);

  // Clamp: at least 1, at most 60 for weighted exercises (increased from 50 —
  // high-rep sets at very light weight are legitimate)
  return Math.max(1, Math.min(60, maxReps));
}

/**
 * Max realistic duration for a single exercise in minutes.
 * (Effectively unlimited within reason — 3 hours of planks is the absurdity cap.)
 */
export function getMaxRealisticDuration() {
  return 180;
}
