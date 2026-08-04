// src/lib/questCatalog.js
//
// Daily quest definitions. Each user gets one easy + one medium + one hard
// quest per day, picked deterministically from this catalog.
//
// Adding a quest:
//   1. Add an entry below with a unique key (the `quest_id` written to DB)
//   2. Make sure the action emitted by the relevant code path matches one of
//      the listed actionType values — see src/lib/data/quests.js → ACTION_TYPES.
//
// Removing a quest:
//   Don't delete the entry — set `enabled: false` instead so existing rows in
//   user_daily_quests still resolve their label and reward correctly.

// Coin rewards halved (was 15/40/100 = 155/day) — see C3/C4 in
// docs/coin-economy-audit-2026-07-29.md. Daily quests were 51% of all coin
// income, ~4,650 of the ~9,100 coins a dedicated user earned in month one,
// against a shop whose priciest item costs 1,000.
//
// MIRROR WARNING: migration 199's user_daily_quests trigger is the
// AUTHORITATIVE copy of these numbers — it overwrites client-supplied
// coin_reward on insert precisely so a crafted client can't mint. If you
// change these, change migration 265's CASE too, or the server will keep
// paying the old rate and this file will be a lie.
// `color` was a hardcoded green / blue / purple triple. Blue and purple
// are outside the app's colour budget (see the note in src/index.css) and
// rendered as bright blue and purple difficulty pills on the Dashboard —
// on an orange-brand app. They're CSS-var references now, so they theme
// with everything else, and the ramp actually reads as escalating
// difficulty: success -> primary -> destructive.
//
// Only DailyQuestsCard consumes `color`; the catalog tests assert on
// coinReward, not colour.
export const QUEST_DIFFICULTY = {
  easy:   { coinReward: 8,  color: 'var(--success)' },
  medium: { coinReward: 20, color: 'var(--primary)' },
  hard:   { coinReward: 50, color: 'var(--destructive)' },
};

// Action types emitted by user actions. Quests subscribe to these.
export const ACTION_TYPES = {
  MEAL_LOGGED:        'meal_logged',
  WATER_LOGGED:       'water_logged',         // 1 per glass
  WORKOUT_COMPLETED:  'workout_completed',    // 1 per saved workout
  WORKOUT_MINUTES:    'workout_minutes',      // duration in minutes
  CARDIO_COMPLETED:   'cardio_completed',     // 1 per saved cardio session
  CARDIO_SECONDS:     'cardio_seconds',       // duration in seconds
  PR_ACHIEVED:        'pr_achieved',          // 1 per PR
  PROGRESS_PHOTO:     'progress_photo_taken',
  HUB_POST:           'hub_post_created',
  GOAL_COMPLETED:     'goal_completed',
};

/**
 * QUEST CATALOG
 * key → quest definition. The key is stored as quest_id in the DB.
 *
 * label / description support a {n} placeholder for `target` so a single
 * entry can cover several copy permutations (e.g. "Log 3 meals" / "Log 4 meals").
 *
 * `icon` is the NAME of a lucide-react export (e.g. 'Droplet'), not a
 * component and not an emoji. It was an emoji (💧 🚴 🏆 …) rendered at
 * text-2xl, which meant the quest rows couldn't take the accent colour,
 * ignored font weight, and rendered differently on every OS. Keeping it a
 * string keeps this module free of React imports — DailyQuestsCard owns
 * the name -> component resolution — and keeps the existing
 * `typeof q.icon === 'string'` catalog test honest.
 *
 * When adding a quest, use a name that already appears here if the concept
 * matches; the Dashboard shares one icon vocabulary across cards.
 */
export const QUEST_CATALOG = {
  // ── Easy (15 coins) ────────────────────────────────────────────────────────
  log_meal: {
    difficulty: 'easy',
    target: 1,
    actionType: ACTION_TYPES.MEAL_LOGGED,
    label: 'Log a meal',
    description: 'Track what you eat today.',
    icon: 'UtensilsCrossed',
    enabled: true,
  },
  drink_water_4: {
    difficulty: 'easy',
    target: 4,
    actionType: ACTION_TYPES.WATER_LOGGED,
    label: 'Drink 4 glasses of water',
    description: 'Stay hydrated.',
    icon: 'Droplet',
    enabled: true,
  },
  workout_15min: {
    difficulty: 'easy',
    target: 15,
    actionType: ACTION_TYPES.WORKOUT_MINUTES,
    label: 'Train for 15 minutes',
    description: 'Even a quick session counts.',
    icon: 'Dumbbell',
    enabled: true,
  },
  cardio_10min: {
    difficulty: 'easy',
    target: 600, // seconds
    actionType: ACTION_TYPES.CARDIO_SECONDS,
    label: 'Get 10 min of cardio',
    description: 'Get the blood pumping.',
    icon: 'HeartPulse',
    enabled: true,
  },
  hub_post: {
    difficulty: 'easy',
    target: 1,
    actionType: ACTION_TYPES.HUB_POST,
    label: 'Share a post on Hub',
    description: 'Inspire someone.',
    icon: 'Megaphone',
    enabled: true,
  },

  // ── Medium (40 coins) ──────────────────────────────────────────────────────
  workout_complete: {
    difficulty: 'medium',
    target: 1,
    actionType: ACTION_TYPES.WORKOUT_COMPLETED,
    label: 'Complete a workout',
    description: 'Finish and save a session.',
    icon: 'Dumbbell',
    enabled: true,
  },
  cardio_30min: {
    difficulty: 'medium',
    target: 1800, // seconds
    actionType: ACTION_TYPES.CARDIO_SECONDS,
    label: 'Get 30 min of cardio',
    description: 'A proper cardio session.',
    icon: 'Bike',
    enabled: true,
  },
  log_3_meals: {
    difficulty: 'medium',
    target: 3,
    actionType: ACTION_TYPES.MEAL_LOGGED,
    label: 'Log 3 meals',
    description: 'Track your full day.',
    icon: 'UtensilsCrossed',
    enabled: true,
  },
  drink_water_8: {
    difficulty: 'medium',
    target: 8,
    actionType: ACTION_TYPES.WATER_LOGGED,
    label: 'Drink 8 glasses of water',
    description: 'Hit the daily target.',
    icon: 'Droplet',
    enabled: true,
  },
  progress_photo: {
    difficulty: 'medium',
    target: 1,
    actionType: ACTION_TYPES.PROGRESS_PHOTO,
    label: 'Take a progress photo',
    description: 'Document the journey.',
    icon: 'Camera',
    enabled: true,
  },

  // ── Hard (100 coins) ───────────────────────────────────────────────────────
  workout_45min: {
    difficulty: 'hard',
    target: 45,
    actionType: ACTION_TYPES.WORKOUT_MINUTES,
    label: 'Train for 45 minutes',
    description: 'A full quality session.',
    icon: 'Flame',
    enabled: true,
  },
  cardio_45min: {
    difficulty: 'hard',
    target: 2700, // seconds
    actionType: ACTION_TYPES.CARDIO_SECONDS,
    label: 'Get 45 min of cardio',
    description: 'Endurance work.',
    icon: 'Trophy',
    enabled: true,
  },
  hit_pr: {
    difficulty: 'hard',
    target: 1,
    actionType: ACTION_TYPES.PR_ACHIEVED,
    label: 'Set a personal record',
    description: 'Beat your previous best.',
    icon: 'Zap',
    enabled: true,
  },
  goal_complete: {
    difficulty: 'hard',
    target: 1,
    actionType: ACTION_TYPES.GOAL_COMPLETED,
    label: 'Complete a goal',
    description: 'Cross the finish line.',
    icon: 'Target',
    enabled: true,
  },
};

/**
 * Pick three quests for a given user/date pair: 1 easy, 1 medium, 1 hard.
 * Deterministic — same (userId, date) always returns the same set.
 *
 * Why deterministic? So the user can't reset by reloading, and so the same set
 * shows on different devices. The picker uses per-difficulty independent hashes
 * of (userId + date + difficulty) so adjacent dates don't produce neighboring
 * indices (which, with small pools of 5, would surface the same quest day after
 * day even though the date had changed — beta tester feedback: "quests have
 * been consistent the whole time"). Mixing the day-of-year separately into
 * the seed ensures even minor date deltas produce large hash shifts.
 */
export function pickDailyQuests(userId, dateStr) {
  // Extract YMD numerically so the day-of-year acts as a strong, additive
  // entropy term separate from the lexical date string. Without this, two
  // adjacent dates ("2026-05-31" → "2026-06-01") differ in many characters
  // but the djb2 hash can still produce nearby mod values for small pools.
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dayMix = m
    ? (Number(m[1]) * 366 + Number(m[2]) * 31 + Number(m[3])) * 2654435761 >>> 0
    : 0;

  const eligible = (diff) =>
    Object.entries(QUEST_CATALOG)
      .filter(([, q]) => q.enabled && q.difficulty === diff)
      .map(([id, q]) => ({ id, ...q }));

  const easyPool   = eligible('easy');
  const mediumPool = eligible('medium');
  const hardPool   = eligible('hard');

  // Per-difficulty seed so easy/medium/hard pick INDEPENDENTLY rather than
  // (seed, seed+1, seed+2) which clustered picks on small pools.
  const pick = (pool, difficulty) => {
    if (pool.length === 0) return null;
    const seed = (hashString(`${userId}:${dateStr}:${difficulty}`) ^ dayMix) >>> 0;
    return pool[seed % pool.length];
  };

  return [
    pick(easyPool,   'easy'),
    pick(mediumPool, 'medium'),
    pick(hardPool,   'hard'),
  ].filter(Boolean);
}

/** Cheap deterministic string hash (djb2). */
function hashString(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return h >>> 0;
}

/** Get full definition for a stored quest_id, including label & reward. */
export function getQuestDefinition(questId) {
  const def = QUEST_CATALOG[questId];
  if (!def) return null;
  return { id: questId, ...def, coinReward: QUEST_DIFFICULTY[def.difficulty].coinReward };
}

// ── Quest → route map ────────────────────────────────────────────────────────
// When a user taps a daily-quest card, send them to the page where they can
// actually complete the quest. Routes are React Router paths; some include a
// query string the receiving page reads to auto-open a sub-section.

const ROUTE_BY_ACTION = {
  [ACTION_TYPES.MEAL_LOGGED]:        '/nutrition?openLogMeal=1',
  [ACTION_TYPES.WATER_LOGGED]:       '/nutrition',
  [ACTION_TYPES.WORKOUT_COMPLETED]:  '/workout',
  [ACTION_TYPES.WORKOUT_MINUTES]:    '/workout',
  [ACTION_TYPES.CARDIO_COMPLETED]:   '/workout?openCardio=1',
  [ACTION_TYPES.CARDIO_SECONDS]:     '/workout?openCardio=1',
  [ACTION_TYPES.PR_ACHIEVED]:        '/workout',
  [ACTION_TYPES.PROGRESS_PHOTO]:     '/progress?tab=photos',
  [ACTION_TYPES.HUB_POST]:           '/hub?compose=1',
  [ACTION_TYPES.GOAL_COMPLETED]:     '/workout?openGoals=1',
};

/** Where should tapping this quest take the user? Returns a route string or null. */
export function questDestinationRoute(questId) {
  const def = QUEST_CATALOG[questId];
  if (!def) return null;
  return ROUTE_BY_ACTION[def.actionType] || '/dashboard';
}
