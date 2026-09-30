// src/lib/notificationCatalog.js
//
// The ONE place a notification type is classified.
//
// There used to be two, and they disagreed. `NotificationPanel.jsx` carried
// `FRIEND_TYPES` (24 types across 2 tabs) plus a separate inline
// `ALL_KNOWN_TYPES` used only to report drift to Sentry; `pages/Notifications.jsx`
// carried `TYPE_TO_TAB` (31 types across 5 tabs). Adding a server-side type
// meant remembering three lists in two files, so nobody did: `coin_gift` was
// in NONE of them, which meant six live rows reported "Unmapped notification
// types" to Sentry on every panel open AND fell into the page's catch-all
// "system" tab, where a gift from another human is exactly wrong.
//
// Rules for anything added here:
//
//   • A type gets exactly one category. If it belongs in two, the category
//     set is wrong, not the type.
//   • An UNKNOWN type is not an error for the user — it still renders, it
//     still counts under All, and it takes the neutral treatment. It is only
//     an error for us, which is what `isKnownType` is for.
//   • Categories are a filter over what already arrived. They are NOT the
//     per-category push preferences in Settings (mig 036/083), which are a
//     different, singular-keyed vocabulary — streak / quests / league /
//     social / achievements / engagement / competitive. Don't unify them:
//     "should this reach my phone" and "show me these now" are different
//     questions, and the prefs list is server-side and versioned.

export const CATEGORY = {
  SOCIAL:       'social',
  COMPETITIVE:  'competitive',
  ACHIEVEMENTS: 'achievements',
  REMINDERS:    'reminders',
};

// Category → the hue its row tile is tinted with. Four hues, unchanged:
// `muted` is the neutral, not a fifth colour.
export const CATEGORY_HUE = {
  [CATEGORY.SOCIAL]:       'info',
  [CATEGORY.COMPETITIVE]:  'primary',
  [CATEGORY.ACHIEVEMENTS]: 'success',
  [CATEGORY.REMINDERS]:    'muted',
};

// The filter row, in display order. Three tabs over what HAPPENED (Kegan,
// 2026-09-30, option C of the panel audit). `all` is the absence of a
// filter. `people` is everything another person did, the same set the bell
// puts a number on. `earned` is what you earned.
//
// There is no Reminders tab any more, on purpose. Reminders are about NOW
// and are wrong an hour later, so they do not belong in a list of things
// that happened: see LIVE_TYPES below, and the live card at the top of the
// panel (NotificationNowCard) that replaced them.
export const FILTERS = [
  { id: 'all',    labelKey: 'notifications.tab.all',    label: 'All' },
  { id: 'people', labelKey: 'notifications.tab.people', label: 'People' },
  { id: 'earned', labelKey: 'notifications.tab.earned', label: 'Earned' },
];

// Which categories each filter shows.
const FILTER_CATEGORIES = {
  people: [CATEGORY.SOCIAL, CATEGORY.COMPETITIVE],
  earned: [CATEGORY.ACHIEVEMENTS],
};

// ── Live reminders ───────────────────────────────────────────────────────
// Rows the server writes to deliver a PUSH about something happening now:
// quests left tonight, a streak ending at midnight, a session scheduled for
// this hour, "we miss you". In the panel they piled up as history that
// stopped being true: 54% of the average person's notifications were these
// (measured 2026-09-30), and "4 quests left today" from a week ago still
// said "today".
//
// The rows keep being inserted, because the insert is what fires the push.
// The panel and the bell just don't read them. What is live right now is
// read from the source instead (quests, streak, schedule) by
// NotificationNowCard, so it is always current and disappears on its own.
//
// `report_resolved` is deliberately NOT here: a moderator answering your
// report is something that happened, and it shows under All.
export const LIVE_TYPES = Object.freeze([
  'streak_break_warning',
  'welcome_back',
  'quest_expiry_warning',
  'memory_reengagement',
  'workout_reminder',
]);

/** Does this row belong in the feed, or is it a live reminder? */
export function isFeedType(type) {
  return !LIVE_TYPES.includes(type);
}

// Every type this app has ever inserted, including the ones only a cron or
// a SECURITY DEFINER RPC writes. Grouped by the migration that introduced
// them so a future reader can find the server side.
const TYPE_CATEGORY = {
  // ── social ── another human did this to you
  friend_post:              CATEGORY.SOCIAL,   // 017
  friend_follow:            CATEGORY.SOCIAL,   // 017
  comment_reply:            CATEGORY.SOCIAL,   // 041
  post_reaction:            CATEGORY.SOCIAL,   // 041
  sticker_reaction:         CATEGORY.SOCIAL,   // 041
  trade_offer:              CATEGORY.SOCIAL,   // 041
  post_like:                CATEGORY.SOCIAL,   // 063
  crew_everyone:            CATEGORY.SOCIAL,   // 063
  coin_gift:                CATEGORY.SOCIAL,   // live in prod, previously in NO list

  // ── competitive ── someone is racing you
  duel_invite:              CATEGORY.COMPETITIVE, // 065
  duel_result:              CATEGORY.COMPETITIVE, // 065
  bounty_claim:             CATEGORY.COMPETITIVE, // 069
  bounty_beaten:            CATEGORY.COMPETITIVE, // 069
  crew_war_started:         CATEGORY.COMPETITIVE, // 069
  crew_war_resolved:        CATEGORY.COMPETITIVE, // 069
  nemesis_assigned:         CATEGORY.COMPETITIVE, // 081
  nemesis_overthrown:       CATEGORY.COMPETITIVE, // 102
  crew_challenge_started:   CATEGORY.COMPETITIVE, // 103
  crew_challenge_completed: CATEGORY.COMPETITIVE, // 103
  weekly_gauntlet_started:  CATEGORY.COMPETITIVE, // 082 — a race, not a nudge

  // ── achievements ── you earned something
  quest_claimed:            CATEGORY.ACHIEVEMENTS,
  streak_milestone:         CATEGORY.ACHIEVEMENTS,
  league_promoted:          CATEGORY.ACHIEVEMENTS,
  league_demoted:           CATEGORY.ACHIEVEMENTS,
  league_held:              CATEGORY.ACHIEVEMENTS,
  pr_set:                   CATEGORY.ACHIEVEMENTS,
  capsule_earned:           CATEGORY.ACHIEVEMENTS,
  coin_milestone:           CATEGORY.ACHIEVEMENTS,
  referral_success:         CATEGORY.ACHIEVEMENTS,
  gauntlet_completed:       CATEGORY.ACHIEVEMENTS,
  gauntlet_path_completed:  CATEGORY.ACHIEVEMENTS,
  streak_rescue_available:  CATEGORY.ACHIEVEMENTS,
  weekly_review_ready:      CATEGORY.ACHIEVEMENTS, // 331/332

  // ── reminders ── we are asking you for something
  streak_break_warning:     CATEGORY.REMINDERS,  // 035
  welcome_back:             CATEGORY.REMINDERS,  // 037
  quest_expiry_warning:     CATEGORY.REMINDERS,  // 037
  memory_reengagement:      CATEGORY.REMINDERS,  // 089
  workout_reminder:         CATEGORY.REMINDERS,  // 276
  report_resolved:          CATEGORY.REMINDERS,  // admin → you
};

/** The category for a type, or null when we've never heard of it. */
export function categoryFor(type) {
  return (type && TYPE_CATEGORY[type]) || null;
}

/** False means the catalog has drifted behind the server. */
export function isKnownType(type) {
  return !!type && Object.prototype.hasOwnProperty.call(TYPE_CATEGORY, type);
}

/** The hue for a row's tile. Unknown types take the neutral. */
export function hueFor(type) {
  return CATEGORY_HUE[categoryFor(type)] || 'muted';
}

/** Does a row belong under the given filter id? `all` always matches. */
export function matchesFilter(type, filterId) {
  if (!filterId || filterId === 'all') return true;
  return (FILTER_CATEGORIES[filterId] || []).includes(categoryFor(type));
}

export const KNOWN_TYPES = Object.freeze(Object.keys(TYPE_CATEGORY));

// The categories another person is behind. The bell's badge puts a number
// only on these; everything else (achievements, reminders, unknown types)
// shows as a dot. Unknown types take the dot on purpose: a number is a claim
// that someone did something, and we can't make it about a type we've never
// heard of.
export const PEOPLE_CATEGORIES = Object.freeze([CATEGORY.SOCIAL, CATEGORY.COMPETITIVE]);

/** Did another person cause this notification? */
export function isFromPeople(type) {
  return PEOPLE_CATEGORIES.includes(categoryFor(type));
}
