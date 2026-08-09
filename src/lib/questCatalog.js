// src/lib/questCatalog.js
//
// Daily quest definitions. Each user gets one easy + one medium + one hard
// quest per day, plus a fourth CREW quest when they belong to a crew, picked
// deterministically from this catalog.
//
// Adding a quest:
//   1. Add an entry below with a unique key (the `quest_id` written to DB)
//   2. Make sure the action emitted by the relevant code path matches one of
//      the listed actionType values — see src/lib/data/quests.js → ACTION_TYPES.
//   3. Add `quest.<id>.label` / `quest.<id>.desc` to src/lib/i18n-gamification.js.
//
// Removing a quest:
//   Don't delete the entry — set `enabled: false` instead so existing rows in
//   user_daily_quests still resolve their label and reward correctly.

// Coin rewards halved (was 15/40/100 = 155/day) — see C3/C4 in
// docs/coin-economy-audit-2026-07-29.md. Daily quests were 51% of all coin
// income, ~4,650 of the ~9,100 coins a dedicated user earned in month one,
// against a shop whose priciest item costs 1,000.
//
// MIRROR WARNING: migration 316's user_daily_quests trigger is the
// AUTHORITATIVE copy of BOTH numbers — it overwrites client-supplied
// coin_reward AND xp_reward on insert precisely so a crafted client can't
// mint. If you change these, change migration 316's two CASE blocks too, or
// the server will keep paying the old rate and this file will be a lie.
//
// `color` was a hardcoded green / blue / purple triple. Blue and purple
// are outside the app's colour budget (see the note in src/index.css) and
// rendered as bright blue and purple difficulty pills on the Dashboard —
// on an orange-brand app. They're CSS-var references now, so they theme
// with everything else, and the ramp actually reads as escalating
// difficulty: success -> primary -> destructive.
//
// XP was added in the same pass that added the crew tier (Aug 2026). Quests
// paid coins and nothing else, which put them outside the progression the
// rest of the app runs on — a claimed quest moved a shop balance and left
// level, league and crew untouched. The numbers are deliberately small
// against training: a full quest day is 250 XP where `workout_completed`
// alone caps at 4,000/day. Quests point you AT the training; they are not a
// substitute for it, and the server cap in migration 316 enforces that even
// if this file drifts.
//
// crewXpShare is the fraction of the quest's XP that ALSO lands on the
// user's crew (it is not deducted from the user's own grant — both sides
// win). A crew-tier quest passes its full value through; everything else
// passes a quarter. The server recomputes this; the value here is what the
// UI is allowed to promise.
export const QUEST_DIFFICULTY = {
  easy:   { coinReward: 8,  xpReward: 20,  crewXpShare: 0.25, color: 'var(--success)' },
  medium: { coinReward: 20, xpReward: 50,  crewXpShare: 0.25, color: 'var(--primary)' },
  hard:   { coinReward: 50, xpReward: 120, crewXpShare: 0.25, color: 'var(--destructive)' },
  crew:   { coinReward: 25, xpReward: 60,  crewXpShare: 1,    color: 'var(--primary)' },
};

// Rendering order. Not alphabetical, and not the DB's `order by difficulty`
// either — 'crew' sorts between 'cardio' and 'easy' lexically, which would
// put the crew quest first. Easy → hard → crew is the order the card and
// the sheet both draw: the ladder, then the one that belongs to other people.
export const DIFFICULTY_ORDER = ['easy', 'medium', 'hard', 'crew'];

// Completing every quest the day handed you pays this on top, once per day,
// through claim_perfect_day_bonus (migration 316). Mirror of the server
// constants — same warning as above applies.
export const PERFECT_DAY_BONUS = { coinReward: 30, xpReward: 100, crewXp: 50 };

// Action types emitted by user actions. Quests subscribe to these.
export const ACTION_TYPES = {
  MEAL_LOGGED:        'meal_logged',
  WATER_LOGGED:       'water_logged',         // 1 per glass
  WORKOUT_COMPLETED:  'workout_completed',    // 1 per saved workout
  WORKOUT_MINUTES:    'workout_minutes',      // duration in minutes
  WORKOUT_VOLUME:     'workout_volume',       // lbs of total volume
  SETS_COMPLETED:     'sets_completed',       // working sets in a saved session
  CARDIO_COMPLETED:   'cardio_completed',     // 1 per saved cardio session
  CARDIO_SECONDS:     'cardio_seconds',       // duration in seconds
  PR_ACHIEVED:        'pr_achieved',          // 1 per PR
  PROGRESS_PHOTO:     'progress_photo_taken',
  HUB_POST:           'hub_post_created',
  HUB_REACTION:       'hub_reaction_given',
  HUB_COMMENT:        'hub_comment_created',
  GOAL_COMPLETED:     'goal_completed',
  SLEEP_LOGGED:       'sleep_logged',
  MOOD_LOGGED:        'mood_logged',
  STEPS_LOGGED:       'steps_logged',         // amount = steps
  BODY_METRIC_LOGGED: 'body_metric_logged',
  // NOTE: there is deliberately no `gym_checkin` action type. Checking in is
  // QR-only (`/checkin/<CODE>` → CheckInPage, which reads the code from the
  // URL and has no manual-entry field), so a quest for it would have no
  // in-app destination — questDestinationRoute would resolve to nothing and
  // the row would be untappable. Add the action type in the same change that
  // gives check-in a screen, not before. The `cardio_completed` type spent
  // months emitted-but-unsubscribed for the mirror-image reason.
  CREW_MESSAGE:       'crew_message_sent',
  // NOTE: no `crew_fuel_sent` type either, for the same reason. Sending XP
  // fuel is a real feature on the DATA side — `fireXpFuel` in
  // src/lib/data/crews.js, and CrewMessageItem renders and claims an
  // 'xp_fuel' message — but fireXpFuel has ZERO callers anywhere in the app,
  // so no user can send one. A quest for it would be uncompletable. That
  // missing send affordance is worth fixing on its own; when it lands, this
  // is the quest to add.
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
 * matches; the Dashboard shares one icon vocabulary across cards. Any new
 * name must also be added to QUEST_ICONS in DailyQuestsCard.jsx, or the row
 * silently falls back to a Sparkles glyph.
 */
export const QUEST_CATALOG = {
  // ── Easy (8 coins, 20 XP) ─────────────────────────────────────────────────
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
  // CARDIO_COMPLETED was emitted by all three cardio surfaces and subscribed
  // to by NOTHING — every cardio quest in the catalog keyed on
  // CARDIO_SECONDS. So the action fired, matched zero rows and returned. This
  // is the entry that makes the existing call sites mean something.
  cardio_session: {
    difficulty: 'easy',
    target: 1,
    actionType: ACTION_TYPES.CARDIO_COMPLETED,
    label: 'Log a cardio session',
    description: 'Any distance, any pace.',
    icon: 'Bike',
    enabled: true,
  },
  log_sleep: {
    difficulty: 'easy',
    target: 1,
    actionType: ACTION_TYPES.SLEEP_LOGGED,
    label: "Log last night's sleep",
    description: 'Recovery is training too.',
    icon: 'Moon',
    enabled: true,
  },
  log_mood: {
    difficulty: 'easy',
    target: 1,
    actionType: ACTION_TYPES.MOOD_LOGGED,
    label: 'Check in on how you feel',
    description: 'One tap. It sharpens your readiness score.',
    icon: 'Smile',
    enabled: true,
  },
  steps_5k: {
    difficulty: 'easy',
    target: 5000,
    actionType: ACTION_TYPES.STEPS_LOGGED,
    label: 'Walk 5,000 steps',
    description: 'Movement between sessions counts.',
    icon: 'Footprints',
    enabled: true,
  },
  hub_react_3: {
    difficulty: 'easy',
    target: 3,
    actionType: ACTION_TYPES.HUB_REACTION,
    label: 'React to 3 posts',
    description: 'Back someone else up.',
    icon: 'Heart',
    enabled: true,
  },
  log_body_metric: {
    difficulty: 'easy',
    target: 1,
    actionType: ACTION_TYPES.BODY_METRIC_LOGGED,
    label: 'Log a body measurement',
    description: 'Weight, waist, anything you track.',
    icon: 'Scale',
    enabled: true,
  },

  // ── Medium (20 coins, 50 XP) ──────────────────────────────────────────────
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
  workout_30min: {
    difficulty: 'medium',
    target: 30,
    actionType: ACTION_TYPES.WORKOUT_MINUTES,
    label: 'Train for 30 minutes',
    description: 'A solid middle-of-the-week session.',
    icon: 'Timer',
    enabled: true,
  },
  sets_20: {
    difficulty: 'medium',
    target: 20,
    actionType: ACTION_TYPES.SETS_COMPLETED,
    label: 'Finish 20 working sets',
    description: 'Volume, counted honestly.',
    icon: 'Layers',
    enabled: true,
  },
  steps_10k: {
    difficulty: 'medium',
    target: 10000,
    actionType: ACTION_TYPES.STEPS_LOGGED,
    label: 'Walk 10,000 steps',
    description: 'The classic. Still works.',
    icon: 'Footprints',
    enabled: true,
  },
  hub_comment_2: {
    difficulty: 'medium',
    target: 2,
    actionType: ACTION_TYPES.HUB_COMMENT,
    label: 'Leave 2 comments on Hub',
    description: 'Say something worth reading.',
    icon: 'MessageCircle',
    enabled: true,
  },
  cardio_double: {
    difficulty: 'medium',
    target: 2,
    actionType: ACTION_TYPES.CARDIO_COMPLETED,
    label: 'Log 2 cardio sessions',
    description: 'Morning and evening, or two of anything.',
    icon: 'HeartPulse',
    enabled: true,
  },
  volume_10k: {
    difficulty: 'medium',
    target: 10000,
    actionType: ACTION_TYPES.WORKOUT_VOLUME,
    label: 'Move 10,000 lb of volume',
    description: 'Sets times reps times weight.',
    icon: 'Weight',
    enabled: true,
  },

  // ── Hard (50 coins, 120 XP) ───────────────────────────────────────────────
  //
  // Rebalanced Aug 2026. The old hard pool was four entries, two of which
  // (`hit_pr`, `goal_complete`) are not things a person can decide to do on a
  // given Tuesday — production measured 123 hard rows, 2 completed and 0 ever
  // claimed. They stay in the pool because landing one should feel like
  // landing one, but they're now 2 of 8 rather than 2 of 4, and the six
  // additions are all quests you can choose to complete.
  workout_45min: {
    difficulty: 'hard',
    target: 45,
    actionType: ACTION_TYPES.WORKOUT_MINUTES,
    label: 'Train for 45 minutes',
    description: 'A full quality session.',
    icon: 'Flame',
    enabled: true,
  },
  workout_60min: {
    difficulty: 'hard',
    target: 60,
    actionType: ACTION_TYPES.WORKOUT_MINUTES,
    label: 'Train for a full hour',
    description: 'No shortcuts today.',
    icon: 'Timer',
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
  sets_40: {
    difficulty: 'hard',
    target: 40,
    actionType: ACTION_TYPES.SETS_COMPLETED,
    label: 'Finish 40 working sets',
    description: 'A long session, or two short ones.',
    icon: 'Layers',
    enabled: true,
  },
  volume_25k: {
    difficulty: 'hard',
    target: 25000,
    actionType: ACTION_TYPES.WORKOUT_VOLUME,
    label: 'Move 25,000 lb of volume',
    description: 'A heavy day, honestly logged.',
    icon: 'Weight',
    enabled: true,
  },
  steps_15k: {
    difficulty: 'hard',
    target: 15000,
    actionType: ACTION_TYPES.STEPS_LOGGED,
    label: 'Walk 15,000 steps',
    description: 'On your feet all day.',
    icon: 'Footprints',
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

  // ── Crew (25 coins, 60 XP — and the crew banks the full 60) ───────────────
  //
  // Only seeded for users who belong to a crew (see pickDailyQuests's
  // `hasCrew` argument). A crew quest is the one slot whose reward leaves the
  // individual: claiming it calls award_crew_progress, so the crew's level
  // moves because a member showed up. That is the whole point of the tier —
  // the other three are things you do, this is a thing you do FOR someone.
  crew_workout: {
    difficulty: 'crew',
    target: 1,
    actionType: ACTION_TYPES.WORKOUT_COMPLETED,
    label: 'Bank a session for your crew',
    description: 'Complete a workout — the XP goes to the crew too.',
    icon: 'Users',
    enabled: true,
  },
  crew_cardio: {
    difficulty: 'crew',
    target: 1,
    actionType: ACTION_TYPES.CARDIO_COMPLETED,
    label: 'Run one for the crew',
    description: 'Log a cardio session — the XP goes to the crew too.',
    icon: 'Users',
    enabled: true,
  },
  crew_chat_3: {
    difficulty: 'crew',
    target: 3,
    actionType: ACTION_TYPES.CREW_MESSAGE,
    label: 'Post 3 messages in crew chat',
    description: 'A crew that talks is a crew that trains.',
    icon: 'MessageCircle',
    enabled: true,
  },
  crew_steps_8k: {
    difficulty: 'crew',
    target: 8000,
    actionType: ACTION_TYPES.STEPS_LOGGED,
    label: 'Walk 8,000 steps for the crew',
    description: 'Steps count for the crew as much as the bar does.',
    icon: 'Footprints',
    enabled: true,
  },
};

/**
 * Pick the day's quests for a given user/date pair: 1 easy, 1 medium, 1 hard,
 * plus 1 crew quest when `hasCrew` is true.
 * Deterministic — same (userId, date, hasCrew) always returns the same set.
 *
 * Why deterministic? So the user can't reset by reloading, and so the same set
 * shows on different devices. The picker uses per-difficulty independent hashes
 * of (userId + date + difficulty) so adjacent dates don't produce neighboring
 * indices (which, with small pools of 5, would surface the same quest day after
 * day even though the date had changed — beta tester feedback: "quests have
 * been consistent the whole time"). Mixing the day-of-year separately into
 * the seed ensures even minor date deltas produce large hash shifts.
 *
 * The pools are 11 / 11 / 8 / 4 as of Aug 2026, up from 5 / 5 / 4 / 0. That
 * ratio is most of the fix for the feedback above: with a pool of five, a
 * uniform picker repeats a quest inside a week about as often as not.
 */
export function pickDailyQuests(userId, dateStr, hasCrew = false) {
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

  // Per-difficulty seed so easy/medium/hard pick INDEPENDENTLY rather than
  // (seed, seed+1, seed+2) which clustered picks on small pools.
  const pick = (difficulty) => {
    const pool = eligible(difficulty);
    if (pool.length === 0) return null;
    const seed = (hashString(`${userId}:${dateStr}:${difficulty}`) ^ dayMix) >>> 0;
    return pool[seed % pool.length];
  };

  const picked = [pick('easy'), pick('medium'), pick('hard')];
  if (hasCrew) picked.push(pick('crew'));
  return picked.filter(Boolean);
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
  const tier = QUEST_DIFFICULTY[def.difficulty];
  return {
    id: questId,
    ...def,
    coinReward: tier?.coinReward ?? 0,
    xpReward:   tier?.xpReward ?? 0,
    // What the crew banks when this is claimed. Rounded UP so a quarter-share
    // of a 20 XP quest is 5 rather than a disappointing 5.0 rendered as 5 —
    // the server rounds the same way (migration 316) and the two must agree
    // or the toast promises a number the crew never receives.
    crewXpReward: Math.ceil((tier?.xpReward ?? 0) * (tier?.crewXpShare ?? 0)),
  };
}

/** Sort index for a difficulty. Unknown values sort last rather than NaN. */
export function difficultyRank(difficulty) {
  const i = DIFFICULTY_ORDER.indexOf(difficulty);
  return i === -1 ? 99 : i;
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
  [ACTION_TYPES.WORKOUT_VOLUME]:     '/workout',
  [ACTION_TYPES.SETS_COMPLETED]:     '/workout',
  [ACTION_TYPES.CARDIO_COMPLETED]:   '/workout?openCardio=1',
  [ACTION_TYPES.CARDIO_SECONDS]:     '/workout?openCardio=1',
  [ACTION_TYPES.PR_ACHIEVED]:        '/workout',
  [ACTION_TYPES.PROGRESS_PHOTO]:     '/progress?tab=photos',
  [ACTION_TYPES.HUB_POST]:           '/hub?compose=1',
  [ACTION_TYPES.HUB_REACTION]:       '/hub',
  [ACTION_TYPES.HUB_COMMENT]:        '/hub',
  [ACTION_TYPES.GOAL_COMPLETED]:     '/workout?openGoals=1',
  // Sleep, mood and steps are all logged from the Readiness sheet, which
  // Dashboard opens on ?openReadiness=<signal>. The signal scrolls the sheet
  // to that logger — same parameter TonightRow passes when you tap a column.
  [ACTION_TYPES.SLEEP_LOGGED]:       '/dashboard?openReadiness=sleep',
  [ACTION_TYPES.MOOD_LOGGED]:        '/dashboard?openReadiness=mood',
  [ACTION_TYPES.STEPS_LOGGED]:       '/dashboard?openReadiness=steps',
  // 'body', not 'metrics' — TAB_META in Progress.jsx defines exactly
  // trends | body | photos | insights, and an unknown tab silently falls
  // back to 'trends', which is not where the measurement form is.
  [ACTION_TYPES.BODY_METRIC_LOGGED]: '/progress?tab=body',
  [ACTION_TYPES.CREW_MESSAGE]:       '/hub?tab=crews',
};

/** Where should tapping this quest take the user? Returns a route string or null. */
export function questDestinationRoute(questId) {
  const def = QUEST_CATALOG[questId];
  if (!def) return null;
  return ROUTE_BY_ACTION[def.actionType] || '/dashboard';
}
