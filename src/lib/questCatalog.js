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
//   3. Add `quest.<id>.label` / `quest.<id>.desc` to `src/locales/*.json`.
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
  // Added Aug 2026, once CrewChat's composer grew the button that makes it
  // reachable. This type was deliberately absent before that: `fireXpFuel`
  // had zero callers, so a quest for it would have been uncompletable — the
  // same reason there is still no `gym_checkin` type, above.
  CREW_FUEL_SENT:     'crew_fuel_sent',
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
    family: 'nutrition',
    difficulty: 'easy',
    target: 1,
    actionType: ACTION_TYPES.MEAL_LOGGED,
    label: 'Log a meal',
    description: 'Track what you eat today.',
    icon: 'UtensilsCrossed',
    enabled: true,
  },
  drink_water_4: {
    family: 'hydration',
    difficulty: 'easy',
    target: 4,
    actionType: ACTION_TYPES.WATER_LOGGED,
    label: 'Drink 4 glasses of water',
    description: 'Stay hydrated.',
    icon: 'Droplet',
    enabled: true,
  },
  workout_15min: {
    family: 'lifting',
    difficulty: 'easy',
    target: 15,
    actionType: ACTION_TYPES.WORKOUT_MINUTES,
    label: 'Train for 15 minutes',
    description: 'Even a quick session counts.',
    icon: 'Dumbbell',
    enabled: true,
  },
  cardio_10min: {
    family: 'cardio',
    difficulty: 'easy',
    target: 600, // seconds
    actionType: ACTION_TYPES.CARDIO_SECONDS,
    label: 'Get 10 min of cardio',
    description: 'Get the blood pumping.',
    icon: 'HeartPulse',
    enabled: true,
  },
  hub_post: {
    family: 'social',
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
    family: 'cardio',
    difficulty: 'easy',
    target: 1,
    actionType: ACTION_TYPES.CARDIO_COMPLETED,
    label: 'Log a cardio session',
    description: 'Any distance, any pace.',
    icon: 'Bike',
    enabled: true,
  },
  log_sleep: {
    family: 'recovery',
    difficulty: 'easy',
    target: 1,
    actionType: ACTION_TYPES.SLEEP_LOGGED,
    label: "Log last night's sleep",
    description: 'Recovery is training too.',
    icon: 'Moon',
    enabled: true,
  },
  log_mood: {
    family: 'recovery',
    difficulty: 'easy',
    target: 1,
    actionType: ACTION_TYPES.MOOD_LOGGED,
    label: 'Check in on how you feel',
    description: 'One tap. It sharpens your readiness score.',
    icon: 'Smile',
    enabled: true,
  },
  steps_5k: {
    family: 'steps',
    difficulty: 'easy',
    target: 5000,
    actionType: ACTION_TYPES.STEPS_LOGGED,
    label: 'Walk 5,000 steps',
    description: 'Movement between sessions counts.',
    icon: 'Footprints',
    enabled: true,
  },
  hub_react_3: {
    family: 'social',
    difficulty: 'easy',
    target: 3,
    actionType: ACTION_TYPES.HUB_REACTION,
    label: 'React to 3 posts',
    description: 'Back someone else up.',
    icon: 'Heart',
    enabled: true,
  },
  log_body_metric: {
    family: 'recovery',
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
    family: 'lifting',
    difficulty: 'medium',
    target: 1,
    actionType: ACTION_TYPES.WORKOUT_COMPLETED,
    label: 'Complete a workout',
    description: 'Finish and save a session.',
    icon: 'Dumbbell',
    enabled: true,
  },
  cardio_30min: {
    family: 'cardio',
    difficulty: 'medium',
    target: 1800, // seconds
    actionType: ACTION_TYPES.CARDIO_SECONDS,
    label: 'Get 30 min of cardio',
    description: 'A proper cardio session.',
    icon: 'Bike',
    enabled: true,
  },
  log_3_meals: {
    family: 'nutrition',
    difficulty: 'medium',
    target: 3,
    actionType: ACTION_TYPES.MEAL_LOGGED,
    label: 'Log 3 meals',
    description: 'Track your full day.',
    icon: 'UtensilsCrossed',
    enabled: true,
  },
  drink_water_8: {
    family: 'hydration',
    difficulty: 'medium',
    target: 8,
    actionType: ACTION_TYPES.WATER_LOGGED,
    label: 'Drink 8 glasses of water',
    description: 'Hit the daily target.',
    icon: 'Droplet',
    enabled: true,
  },
  progress_photo: {
    family: 'photo',
    difficulty: 'medium',
    target: 1,
    actionType: ACTION_TYPES.PROGRESS_PHOTO,
    label: 'Take a progress photo',
    description: 'Document the journey.',
    icon: 'Camera',
    enabled: true,
  },
  workout_30min: {
    family: 'lifting',
    difficulty: 'medium',
    target: 30,
    actionType: ACTION_TYPES.WORKOUT_MINUTES,
    label: 'Train for 30 minutes',
    description: 'A solid middle-of-the-week session.',
    icon: 'Timer',
    enabled: true,
  },
  sets_20: {
    family: 'lifting',
    difficulty: 'medium',
    target: 20,
    actionType: ACTION_TYPES.SETS_COMPLETED,
    label: 'Finish 20 working sets',
    description: 'Volume, counted honestly.',
    icon: 'Layers',
    enabled: true,
  },
  steps_10k: {
    family: 'steps',
    difficulty: 'medium',
    target: 10000,
    actionType: ACTION_TYPES.STEPS_LOGGED,
    label: 'Walk 10,000 steps',
    description: 'The classic. Still works.',
    icon: 'Footprints',
    enabled: true,
  },
  hub_comment_2: {
    family: 'social',
    difficulty: 'medium',
    target: 2,
    actionType: ACTION_TYPES.HUB_COMMENT,
    label: 'Leave 2 comments on Hub',
    description: 'Say something worth reading.',
    icon: 'MessageCircle',
    enabled: true,
  },
  cardio_double: {
    family: 'cardio',
    difficulty: 'medium',
    target: 2,
    actionType: ACTION_TYPES.CARDIO_COMPLETED,
    label: 'Log 2 cardio sessions',
    description: 'Morning and evening, or two of anything.',
    icon: 'HeartPulse',
    enabled: true,
  },
  volume_10k: {
    family: 'lifting',
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
    family: 'lifting',
    difficulty: 'hard',
    target: 45,
    actionType: ACTION_TYPES.WORKOUT_MINUTES,
    label: 'Train for 45 minutes',
    description: 'A full quality session.',
    icon: 'Flame',
    enabled: true,
  },
  workout_60min: {
    family: 'lifting',
    difficulty: 'hard',
    target: 60,
    actionType: ACTION_TYPES.WORKOUT_MINUTES,
    label: 'Train for a full hour',
    description: 'No shortcuts today.',
    icon: 'Timer',
    enabled: true,
  },
  cardio_45min: {
    family: 'cardio',
    difficulty: 'hard',
    target: 2700, // seconds
    actionType: ACTION_TYPES.CARDIO_SECONDS,
    label: 'Get 45 min of cardio',
    description: 'Endurance work.',
    icon: 'Trophy',
    enabled: true,
  },
  sets_40: {
    family: 'lifting',
    difficulty: 'hard',
    target: 40,
    actionType: ACTION_TYPES.SETS_COMPLETED,
    label: 'Finish 40 working sets',
    description: 'A long session, or two short ones.',
    icon: 'Layers',
    enabled: true,
  },
  volume_25k: {
    family: 'lifting',
    difficulty: 'hard',
    target: 25000,
    actionType: ACTION_TYPES.WORKOUT_VOLUME,
    label: 'Move 25,000 lb of volume',
    description: 'A heavy day, honestly logged.',
    icon: 'Weight',
    enabled: true,
  },
  steps_15k: {
    family: 'steps',
    difficulty: 'hard',
    target: 15000,
    actionType: ACTION_TYPES.STEPS_LOGGED,
    label: 'Walk 15,000 steps',
    description: 'On your feet all day.',
    icon: 'Footprints',
    enabled: true,
  },
  hit_pr: {
    family: 'pr',
    difficulty: 'hard',
    target: 1,
    actionType: ACTION_TYPES.PR_ACHIEVED,
    label: 'Set a personal record',
    description: 'Beat your previous best.',
    icon: 'Zap',
    enabled: true,
  },
  goal_complete: {
    family: 'goals',
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
    family: 'lifting',
    difficulty: 'crew',
    target: 1,
    actionType: ACTION_TYPES.WORKOUT_COMPLETED,
    label: 'Bank a session for your crew',
    description: 'Complete a workout. The XP goes to the crew too.',
    icon: 'Users',
    enabled: true,
  },
  crew_cardio: {
    family: 'cardio',
    difficulty: 'crew',
    target: 1,
    actionType: ACTION_TYPES.CARDIO_COMPLETED,
    label: 'Run one for the crew',
    description: 'Log a cardio session. The XP goes to the crew too.',
    icon: 'Users',
    enabled: true,
  },
  // The sixth, and the only crew quest that asks for something you would not
  // otherwise be doing — the other five ride a workout, a run, a walk or a
  // conversation you were having anyway. Fuel is a pure gift: you spend a tap,
  // somebody else banks the XP, and mig 298 makes it impossible to claim your
  // own. That is the tier's whole idea in one action.
  crew_fuel_2: {
    family: 'fuel',
    difficulty: 'crew',
    target: 2,
    actionType: ACTION_TYPES.CREW_FUEL_SENT,
    label: 'Drop 2 XP fuel for your crew',
    description: 'Leave XP in chat for someone else to claim.',
    icon: 'Flame',
    enabled: true,
  },
  crew_chat_3: {
    family: 'social',
    difficulty: 'crew',
    target: 3,
    actionType: ACTION_TYPES.CREW_MESSAGE,
    label: 'Post 3 messages in crew chat',
    description: 'A crew that talks is a crew that trains.',
    icon: 'MessageCircle',
    enabled: true,
  },
  crew_steps_8k: {
    family: 'steps',
    difficulty: 'crew',
    target: 8000,
    actionType: ACTION_TYPES.STEPS_LOGGED,
    label: 'Walk 8,000 steps for the crew',
    description: 'Steps count for the crew as much as the bar does.',
    icon: 'Footprints',
    enabled: true,
  },
  // The fifth. A four-quest pool put the crew tier on a four-day loop — the
  // shortest cycle of any tier and the only one a user would notice as a
  // pattern. Five is a 25% longer gap for one entry.
  //
  // It uses WORKOUT_VOLUME rather than a new action type on purpose: volume is
  // already emitted by the workout save, so this is reachable the day it
  // ships. The two crew quests that were designed and cut — send XP fuel, gym
  // check-in — both failed exactly that test, and a quest nobody can complete
  // makes the loop worse, not longer.
  crew_volume_15k: {
    family: 'lifting',
    difficulty: 'crew',
    target: 15000,
    actionType: ACTION_TYPES.WORKOUT_VOLUME,
    label: 'Move 15,000 lb for the crew',
    description: 'Every pound you lift today counts toward the crew.',
    icon: 'Weight',
    enabled: true,
  },
};

// ── The picker ───────────────────────────────────────────────────────────────
//
// This was `pool[hash(userId, date, difficulty) % pool.length]`, and it was
// measurably worse than tossing a coin. Simulated over 200 users × 365 days:
//
//     repeat on the NEXT day    23.9%   (uniform random over 11 would be ~9%)
//     repeat within 3 days      48.0%
//     days with a same-day dup  25.1%
//
// Two independent defects, and the pool expansion fixed neither.
//
// 1. A hash mod a pool size is not a uniform shuffle. djb2 over strings that
//    differ in one or two characters lands in the same buckets far more often
//    than chance, so consecutive days collided constantly. Bigger pools did
//    not help because the collisions come from the hash, not the modulus.
//
// 2. Nothing stopped two of the day's quests being the same task at different
//    sizes. "Drink 4 glasses" (easy) alongside "Drink 8 glasses" (medium)
//    means finishing one finishes both; a 45-minute session cleared four
//    lifting quests at once. A quarter of all days had at least one such pair.
//
// The replacement is a CYCLE ROTATION. Each tier's pool is shuffled once per
// cycle of `pool.length` days, and the day's index inside that cycle selects
// the quest. So every quest in a tier appears exactly once before any of them
// appears twice — the strongest anti-repeat guarantee available without
// storing history, and it needs no state: cycle and position are both derived
// from the date.
//
// The one weak seam is the boundary between cycles: the last pick of cycle N
// sitting next to the first pick of cycle N+1. `rotationFor` closes it by
// forcing the head of each cycle to avoid the tail of the previous one.

const ROTATION_EPOCH_UTC = Date.UTC(2020, 0, 1);

/** Whole days since a fixed epoch. The rotation's clock. */
function dayIndex(dateStr) {
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 0;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.floor((t - ROTATION_EPOCH_UTC) / 86400000);
}

/** Cheap deterministic string hash (djb2). */
function hashString(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return h >>> 0;
}

/**
 * mulberry32 — a small, well-distributed PRNG. The point of using a real one
 * rather than more djb2 arithmetic is that a Fisher-Yates shuffle is only as
 * uniform as its random source, and the old picker's whole problem was a
 * source that clustered.
 */
function mulberry32(a) {
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, seed) {
  const rnd = mulberry32(seed);
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/**
 * The shuffled order for one tier in one cycle, with the cycle boundary
 * repaired.
 *
 * Without the repair, a quest can land at the end of cycle N and the start of
 * cycle N+1 — a next-day repeat, which is the exact thing this rotation
 * exists to prevent, and it would happen roughly 1/L of the time per tier.
 *
 * `gap` is the minimum separation we insist on across the seam. Elements in
 * the previous cycle's last `gap - 1` slots are pushed out of this cycle's
 * first `gap - 1` slots, which is sufficient: an element at previous index j
 * and current index i is `L + i - j` days apart, so forcing i >= gap-1 for
 * every j > L-gap gives at least `gap` days. It is capped at half the pool so
 * there are always enough non-tail entries to fill the head with.
 */
// REMOVED: a `STABLE_ROTATION_BELOW` fixed-loop path for short pools. It is
// worth recording why, because the measurement that justified it was real and
// still pointed the wrong way.
//
// Short pools cross a cycle seam often, and each seam is where a quest can
// land near its own previous outing. Giving a short pool ONE permutation per
// user, cycled forever, removes every seam: the gap becomes exactly the pool
// length, and crew measured a flawless 0.00% next-day and 0.00% within-three.
//
// That number was the wrong thing to optimise. Over a year and 40 users the
// same configuration produced **39 distinct orderings out of 2400 cycles** —
// one fixed sequence per user, repeated until they quit. A user cannot see a
// repeat rate, but they can absolutely see that Tuesday is always the crew
// walk. The metric was perfect and the experience was a loop.
//
// So every pool reshuffles every cycle now, and the seam is handled by the
// boundary repair below rather than avoided. Crew went 0.00% -> 2.79%
// next-day (a repeat about every five weeks) and 39 -> 2174 distinct
// orderings. Repeating occasionally is fine; being predictable is not.
//
// If a pool ever gets short enough for this to hurt, the fix is more quests in
// that tier, not a fixed order.

function rotationFor(pool, userId, difficulty, cycle) {
  const L = pool.length;
  const perm = shuffled(pool, hashString(`${userId}:${difficulty}:c${cycle}`));
  if (cycle <= 0 || L < 3) return perm;

  const gap = Math.max(2, Math.min(4, Math.floor(L / 2) + 1));
  const prev = shuffled(pool, hashString(`${userId}:${difficulty}:c${cycle - 1}`));
  const tail = new Set(prev.slice(L - (gap - 1)).map(q => q.id));

  for (let p = 0; p <= gap - 2; p++) {
    if (!tail.has(perm[p].id)) continue;
    const swapAt = perm.findIndex((q, k) => k >= gap - 1 && !tail.has(q.id));
    if (swapAt === -1) break; // pool too small to satisfy — keep what we have
    const t = perm[p]; perm[p] = perm[swapAt]; perm[swapAt] = t;
  }
  return perm;
}

/**
 * The day this tier last served each quest, by index into `perm`.
 *
 * The rotation makes this answerable without storing anything. A quest sitting
 * at index i of the current cycle was served on day `cycle*L + i` if that day
 * has already passed; otherwise its most recent outing was wherever it sat in
 * the PREVIOUS cycle's permutation, on day `(cycle-1)*L + prevIndex`.
 *
 * This is what makes a displaced pick safe. When a family collision forces a
 * tier off its scheduled quest, choosing the least-recently-served alternative
 * keeps the spacing; choosing the next one in the rotation — which is what
 * this used to do — serves that quest twice in one cycle and was single-
 * handedly responsible for ~21% next-day repeats in the easy and medium
 * tiers while `hard`, which never gets displaced, measured 0.00%.
 */
function lastServedDays(perm, prevPerm, at, cycle, L) {
  const prevIndex = new Map();
  if (prevPerm) prevPerm.forEach((q, i) => prevIndex.set(q.id, i));
  return perm.map((q, i) => {
    if (i < at) return cycle * L + i;               // already served this cycle
    if (!prevPerm) return -Infinity;                // first cycle — never served
    return (cycle - 1) * L + prevIndex.get(q.id);   // last seen in the previous
  });
}

/** Enabled quests of one difficulty, in stable catalog order. */
function eligible(difficulty) {
  return Object.entries(QUEST_CATALOG)
    .filter(([, q]) => q.enabled && q.difficulty === difficulty)
    .map(([id, q]) => ({ id, ...q }));
}

// Tiers are resolved most-constrained first so the tier with the fewest escape
// routes keeps its rotation intact and the roomy ones absorb the compromise.
// `hard` is 4 of 8 lifting, so it goes before `medium` and `easy`, which carry
// seven families each.
const RESOLVE_ORDER = ['hard', 'medium', 'easy', 'crew'];

// The crew quest is deliberately EXEMPT from the family rule, and it is the
// one place overlap is a feature rather than a defect.
//
// The rule exists to stop a day paying twice for one act — "drink 4 glasses"
// beside "drink 8 glasses" is a free quest, not a second quest. But a crew
// quest overlapping your lifting quest is the entire pitch of the tier: the
// session you were going to do anyway now also moves your crew's level. You
// are not being asked for extra work, so nothing is being given away.
//
// Including crew in the constraint measured badly and for a structural
// reason: it was displaced off its rotation on a quarter to a half of all
// days, which on a pool this short is thrash — 16.8% next-day repeats against
// `hard`'s 0.00%. Exempting it lets crew follow a clean once-per-pool-length
// cycle AND stops it consuming a family that `easy` and `medium` then have to
// work around.
const FAMILY_EXEMPT = new Set(['crew']);

/**
 * Pick the day's quests for a given user/date pair: 1 easy, 1 medium, 1 hard,
 * plus 1 crew quest when `hasCrew` is true.
 * Deterministic — same (userId, date, hasCrew) always returns the same set.
 *
 * Why deterministic? So the user can't reroll by reloading, and so the same
 * set shows on every device without being stored anywhere.
 *
 * The goal is NOT the lowest possible repeat rate — it is that the set never
 * feels predictable. Those are different targets and they pull apart at the
 * short end of the pool range; see the note above rotationFor for the version
 * of this that scored 0.00% by handing every user the same fixed sequence.
 *
 * Measured over 200 users × 365 days (see questCatalog.test.js, which runs a
 * smaller version of the same simulation so a regression fails the suite
 * rather than being argued about):
 *
 *                        before    after
 *   repeat next day      23.85%    1.55%
 *   repeat within 3      48.00%    6.27%
 *   same-family day      25.11%    0.00%
 *
 * And the figure that matters as much as either: over a year, essentially
 * every cycle of every tier comes out in a different order — 1320/1320 for
 * easy and medium, 1756/1800 for hard, 2174/2400 for crew.
 *
 * The 'same-family day' figure counts easy/medium/hard only — the crew quest
 * is exempt by design, see FAMILY_EXEMPT.
 */
export function pickDailyQuests(userId, dateStr, hasCrew = false) {
  const day = dayIndex(dateStr);
  const tiers = hasCrew ? RESOLVE_ORDER : RESOLVE_ORDER.filter(t => t !== 'crew');

  const usedFamilies = new Set();
  const chosen = {};

  for (const difficulty of tiers) {
    const pool = eligible(difficulty);
    if (pool.length === 0) continue;
    const L = pool.length;
    const cycle = Math.floor(day / L);
    const perm = rotationFor(pool, userId, difficulty, cycle);
    const at = ((day % L) + L) % L;

    const exempt = FAMILY_EXEMPT.has(difficulty);
    let quest = perm[at];
    if (!exempt && usedFamilies.has(quest.family)) {
      // Displaced. Take the eligible quest this tier has gone longest without
      // serving, not simply the next one along — see lastServedDays. Ties
      // break on rotation index so the result stays deterministic.
      const ages = lastServedDays(
        perm,
        cycle > 0 ? shuffled(pool, hashString(`${userId}:${difficulty}:c${cycle - 1}`)) : null,
        at, cycle, L,
      );
      // Slots coming up in the next few days. Displacing ONTO one of these
      // serves that quest twice in quick succession — it runs today as the
      // substitute and again on its own scheduled day. That was the last
      // remaining source of next-day repeats once least-recently-served was
      // in place, and it is why `soon` is excluded before `ages` is consulted
      // rather than left for the age comparison to sort out: a quest that is
      // due tomorrow can still be the oldest thing in the pool.
      const lookahead = Math.max(1, Math.min(3, Math.floor(L / 3)));
      const soon = new Set();
      for (let k = 1; k <= lookahead; k++) soon.add((at + k) % L);

      const choose = (avoidSoon) => {
        let b = -1;
        for (let i = 0; i < L; i++) {
          if (i === at || usedFamilies.has(perm[i].family)) continue;
          if (avoidSoon && soon.has(i)) continue;
          if (b === -1 || ages[i] < ages[b]) b = i;
        }
        return b;
      };
      // Prefer a candidate that isn't due imminently; fall back to allowing
      // one rather than leaving the day a quest short.
      let best = choose(true);
      if (best === -1) best = choose(false);
      // If every other quest in this tier collides too, keep the rotation's
      // pick. A day with a duplicate beats a day with a missing quest.
      if (best !== -1) quest = perm[best];
    }
    if (!exempt) usedFamilies.add(quest.family);
    chosen[difficulty] = quest;
  }

  // Return in display order (easy → medium → hard → crew), not resolve order.
  return DIFFICULTY_ORDER.map(d => chosen[d]).filter(Boolean);
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
  // Dashboard, NOT '/progress?tab=body'. This pointed at the Body tab on
  // the reasoning that the measurement form lived there. It does not, and
  // has not since body-measurement logging was removed from that tab per
  // product direction — BodyMetricsTab.jsx is 47 lines of heat map plus the
  // opt-in cycle tracker, with no input of any kind. So the one quest whose
  // whole job is "go and log a body metric" landed the user on a page where
  // that is impossible, and the quest stayed at 0/1.
  // LogWeightModal is the only writer of a body_metrics row in the app, and
  // Dashboard.jsx:1056 consumes ?logWeight=1 to open it.
  // InsightsTab's empty-state CTA had the identical defect and was fixed
  // there (see the comment at its `weighIns.length < 2` branch); this is the
  // same wrong destination, in the other file that names one.
  [ACTION_TYPES.BODY_METRIC_LOGGED]: '/dashboard?logWeight=1',
  [ACTION_TYPES.CREW_MESSAGE]:       '/hub?tab=crews',
  [ACTION_TYPES.CREW_FUEL_SENT]:     '/hub?tab=crews',
};

/** Where should tapping this quest take the user? Returns a route string or null. */
export function questDestinationRoute(questId) {
  const def = QUEST_CATALOG[questId];
  if (!def) return null;
  return ROUTE_BY_ACTION[def.actionType] || '/dashboard';
}
