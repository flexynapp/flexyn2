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

export const QUEST_DIFFICULTY = {
  easy:   { coinReward: 15, color: '#22c55e' }, // green
  medium: { coinReward: 40, color: '#3b82f6' }, // blue
  hard:   { coinReward: 100, color: '#a855f7' }, // purple
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
 */
export const QUEST_CATALOG = {
  // ── Easy (15 coins) ────────────────────────────────────────────────────────
  log_meal: {
    difficulty: 'easy',
    target: 1,
    actionType: ACTION_TYPES.MEAL_LOGGED,
    label: 'Log a meal',
    description: 'Track what you eat today.',
    icon: '🍽️',
    enabled: true,
  },
  drink_water_4: {
    difficulty: 'easy',
    target: 4,
    actionType: ACTION_TYPES.WATER_LOGGED,
    label: 'Drink 4 glasses of water',
    description: 'Stay hydrated.',
    icon: '💧',
    enabled: true,
  },
  workout_15min: {
    difficulty: 'easy',
    target: 15,
    actionType: ACTION_TYPES.WORKOUT_MINUTES,
    label: 'Train for 15 minutes',
    description: 'Even a quick session counts.',
    icon: '💪',
    enabled: true,
  },
  cardio_10min: {
    difficulty: 'easy',
    target: 600, // seconds
    actionType: ACTION_TYPES.CARDIO_SECONDS,
    label: 'Get 10 min of cardio',
    description: 'Get the blood pumping.',
    icon: '🏃',
    enabled: true,
  },
  hub_post: {
    difficulty: 'easy',
    target: 1,
    actionType: ACTION_TYPES.HUB_POST,
    label: 'Share a post on Hub',
    description: 'Inspire someone.',
    icon: '📣',
    enabled: true,
  },

  // ── Medium (40 coins) ──────────────────────────────────────────────────────
  workout_complete: {
    difficulty: 'medium',
    target: 1,
    actionType: ACTION_TYPES.WORKOUT_COMPLETED,
    label: 'Complete a workout',
    description: 'Finish and save a session.',
    icon: '🏋️',
    enabled: true,
  },
  cardio_30min: {
    difficulty: 'medium',
    target: 1800, // seconds
    actionType: ACTION_TYPES.CARDIO_SECONDS,
    label: 'Get 30 min of cardio',
    description: 'A proper cardio session.',
    icon: '🚴',
    enabled: true,
  },
  log_3_meals: {
    difficulty: 'medium',
    target: 3,
    actionType: ACTION_TYPES.MEAL_LOGGED,
    label: 'Log 3 meals',
    description: 'Track your full day.',
    icon: '🥗',
    enabled: true,
  },
  drink_water_8: {
    difficulty: 'medium',
    target: 8,
    actionType: ACTION_TYPES.WATER_LOGGED,
    label: 'Drink 8 glasses of water',
    description: 'Hit the daily target.',
    icon: '🥤',
    enabled: true,
  },
  progress_photo: {
    difficulty: 'medium',
    target: 1,
    actionType: ACTION_TYPES.PROGRESS_PHOTO,
    label: 'Take a progress photo',
    description: 'Document the journey.',
    icon: '📸',
    enabled: true,
  },

  // ── Hard (100 coins) ───────────────────────────────────────────────────────
  workout_45min: {
    difficulty: 'hard',
    target: 45,
    actionType: ACTION_TYPES.WORKOUT_MINUTES,
    label: 'Train for 45 minutes',
    description: 'A full quality session.',
    icon: '🔥',
    enabled: true,
  },
  cardio_45min: {
    difficulty: 'hard',
    target: 2700, // seconds
    actionType: ACTION_TYPES.CARDIO_SECONDS,
    label: 'Get 45 min of cardio',
    description: 'Endurance work.',
    icon: '🏆',
    enabled: true,
  },
  hit_pr: {
    difficulty: 'hard',
    target: 1,
    actionType: ACTION_TYPES.PR_ACHIEVED,
    label: 'Set a personal record',
    description: 'Beat your previous best.',
    icon: '⚡',
    enabled: true,
  },
  goal_complete: {
    difficulty: 'hard',
    target: 1,
    actionType: ACTION_TYPES.GOAL_COMPLETED,
    label: 'Complete a goal',
    description: 'Cross the finish line.',
    icon: '🎯',
    enabled: true,
  },
};

/**
 * Pick three quests for a given user/date pair: 1 easy, 1 medium, 1 hard.
 * Deterministic — same (userId, date) always returns the same set.
 *
 * Why deterministic? So the user can't reset by reloading, and so the same set
 * shows on different devices. The picker uses a cheap hash of (userId + date).
 */
export function pickDailyQuests(userId, dateStr) {
  const seed = hashString(`${userId}:${dateStr}`);
  const eligible = (diff) =>
    Object.entries(QUEST_CATALOG)
      .filter(([, q]) => q.enabled && q.difficulty === diff)
      .map(([id, q]) => ({ id, ...q }));

  const easyPool   = eligible('easy');
  const mediumPool = eligible('medium');
  const hardPool   = eligible('hard');

  const pick = (pool, offset) => {
    if (pool.length === 0) return null;
    const idx = Math.abs((seed + offset) % pool.length);
    return pool[idx];
  };

  return [
    pick(easyPool,   0),
    pick(mediumPool, 1),
    pick(hardPool,   2),
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
