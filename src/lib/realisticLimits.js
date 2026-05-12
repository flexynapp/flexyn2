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

// Bodyweight / calisthenics name detection — expanded so we recognize
// common variants the original list missed (pike push-up, diamond, decline,
// hindu, wall sit, hollow hold, V-up, flutter kick, Russian twist, etc).
// First check is fast (Set membership on tokens), with substring fallback
// for hyphenated forms.
const BODYWEIGHT_NAME_PATTERNS = [
  'push-up', 'pushup', 'push up',
  'pull-up', 'pullup', 'pull up',
  'chin-up', 'chinup', 'chin up',
  'sit-up',  'situp',  'sit up',
  'crunch', 'plank', 'side plank', 'hollow hold',
  'dip', 'tricep dip', 'bench dip',
  'jumping jack', 'burpee', 'mountain climber',
  'wall sit', 'wall squat',
  'air squat', 'bodyweight squat',
  'glute bridge', 'hip bridge',
  'flutter kick', 'scissor kick',
  'v-up', 'vup', 'v up',
  'russian twist',
  'superman', 'bird dog', 'dead bug',
  'jumping squat', 'jump squat', 'box jump',
  'inverted row',
  'ab wheel', 'leg raise', 'knee raise', 'toes to bar',
  'hindu push', 'pike push', 'diamond push', 'decline push', 'incline push',
];

function looksLikeBodyweight(name) {
  const lower = String(name || '').toLowerCase();
  if (!lower) return false;
  for (const p of BODYWEIGHT_NAME_PATTERNS) {
    if (lower.includes(p)) return true;
  }
  return false;
}

/**
 * Returns the max realistic reps for a given set using the inverse Epley
 * formula relative to the exercise's 1RM ceiling.
 *
 *   maxReps = (1RM / weight - 1) / 0.0333
 *
 * Bodyweight / calisthenics exercises use a flat 300-rep cap instead.
 *
 * @param {string} exerciseName
 * @param {number} weightUsed         Pounds. Zero = no weight on the set.
 * @param {object} userProfile        For 1RM calc.
 * @param {object} [options]
 * @param {boolean} [options.isBodyweight]   Explicit override — when true,
 *   treat as bodyweight regardless of name. Set this when the caller knows
 *   from context (muscle_groups, exercise type) that the set is bodyweight.
 *   This prevents legit 60-rep pushup variants whose names don't match the
 *   built-in pattern list from being flagged as cheating.
 * @param {string[]} [options.muscle_groups] Convenience hint — if the set
 *   has weight=0 AND any muscle group hints at calisthenics (core, none),
 *   we treat as bodyweight too.
 */
export function getMaxRealisticReps(exerciseName = '', weightUsed = 0, userProfile = {}, options = {}) {
  // Explicit caller override always wins.
  if (options.isBodyweight === true) return 300;

  // Name-pattern check — generous list covering common variants.
  if (looksLikeBodyweight(exerciseName)) return 300;

  // Weight-zero heuristic: when the user enters NO weight, the set is
  // by definition bodyweight even if the name doesn't match a known
  // pattern (e.g. custom exercise names). Without this branch a custom
  // pushup variant called "Wall Tap" got the weighted 60-rep cap, which
  // flagged legitimate 60+ rep sets.
  if (!weightUsed || weightUsed <= 0) return 300;

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
