// src/lib/i18n-batch2.js
//
// New keys added by the round-2 bug-fix pass: hardcoded English strings
// that were leaking to non-English users in Bounties, Duels, Gauntlet,
// ProfileMenu (Journal overlay), HubChat, HubMessages, MarketplaceFeed,
// and CrewMessageItem.
//
// English-only for now per CLAUDE.md i18n discipline: shipping
// machine-translated copy to prominent surfaces is worse than the
// existing call-site `t(key) || 'English'` fallback, which already
// returns the English string for unmapped languages. Native-translator
// passes for these surfaces are tracked as a follow-up.
//
// Pattern: every consumer uses `t('key') || 'English fallback'` so
// missing keys never surface as raw key codes.

const enKeys = {
  // ── Bounties page header ────────────────────────────────────────────
  'bounties.title':        'Bounties',
  'bounties.subtitle':     'Daily social challenges · Pay to claim · Earn on completion',

  // ── Duels page status + challenger labels ───────────────────────────
  'duels.status.pending':   'Pending',
  'duels.status.active':    'Active',
  'duels.status.completed': 'Complete',
  'duels.status.declined':  'Declined',
  'duels.status.expired':   'Expired',
  'duels.youChallenged':    'You challenged',
  'duels.challengedBy':     'Challenged by',
  'duels.resultWin':        'W',
  'duels.resultLoss':       'L',
  'duels.resultTie':        'TIE',

  // ── Gauntlet challenge-type labels ──────────────────────────────────
  'gauntlet.type.singleSession': 'Single Session',
  'gauntlet.type.weeklyVolume':  'Weekly Volume',
  'gauntlet.type.streak':        'Streak',
  'gauntlet.type.nutrition':     'Nutrition',
  'gauntlet.type.pr':            'Personal Record',
  'gauntlet.type.finalBoss':     'Final Boss',

  // ── Gauntlet metric-hint templates (use {n} placeholder for value) ──
  'gauntlet.hint.sessionVolume':      '{n} lbs in one session',
  'gauntlet.hint.weeklyLbs':          '{n} lbs in one week',
  'gauntlet.hint.sessionsIn7Days':    '{n} sessions within any 7-day window',
  'gauntlet.hint.sessionsIn5Days':    '{n} sessions within any 5-day window',
  'gauntlet.hint.consecutiveDays':    '{n}-day consecutive streak',
  'gauntlet.hint.minExercisesNoSkip': '{n}+ exercises, zero skipped sets',
  'gauntlet.hint.anyCompoundPr':      'New PR on any compound lift',

  // ── ProfileMenu Journal overlay ─────────────────────────────────────
  'profile.journal.back':              'Back',
  'profile.journal.title':             'My Journal',
  'profile.journal.today':             'Today',
  'profile.journal.placeholderToday':  'How was your session today? Log your lifts, notes, or how you felt…',
  'profile.journal.placeholderPast':   'No entry for this day.',
  'profile.journal.footerToday':       'Auto-saved · Use ← to browse past entries',
  'profile.journal.footerPast':        'Read-only · Navigate to today to write',

  // ── HubChat error toasts ────────────────────────────────────────────
  'hub.chat.attachmentTooLarge': 'Image must be 50 MB or smaller',
  'hub.chat.pinError':           'Could not pin message. Try again.',

  // ── HubMessages tabs, pin/mute, empty states ────────────────────────
  'hub.messages.tab.dms':       'Messages',
  'hub.messages.tab.crews':     'Crews',
  'hub.messages.pinChat':       'Pin Chat',
  'hub.messages.unpinChat':     'Unpin Chat',
  'hub.messages.muteChat':      'Mute Chat',
  'hub.messages.unmuteChat':    'Unmute Chat',
  'hub.messages.noCrews.title': 'No Crews yet',
  'hub.messages.noCrews.desc':  'Join or create a Crew from the Hub tab.',

  // ── MarketplaceFeed headers, empty states, toasts ───────────────────
  'marketplace.listed':                 'Item listed!',
  'marketplace.listFailed':             'Failed to list item: ',
  'marketplace.choose':                 'Choose Item to List',
  'marketplace.configure':              'Configure Listing',
  'marketplace.noStickers':             'No stickers available to list. Open capsules to get more!',
  'marketplace.dailyChest.title':       'Daily Chest',
  'marketplace.dailyChest.comeback':    'Come back tomorrow for another reward!',
  'marketplace.dailyChest.cta':         'Claim your free daily capsule + coins',
  'marketplace.dailyChest.claimed':     'Claimed',
  'marketplace.dailyChest.claim':       'Claim',
  'marketplace.dailyChest.claimSuccess': '🎁 Daily chest claimed! Check your capsules.',

  // ── CrewMessageItem pin label + error ───────────────────────────────
  'crew.messages.pinned':   'Pinned',
  'crew.messages.pinError': 'Could not pin message.',

  // ── NotificationPanel markAllRead error ─────────────────────────────
  'notifications.markAllReadError': 'Could not mark notifications as read.',
};

export const batch2I18n = {
  en: enKeys,
  // All other languages inherit English until a native translator pass
  // (CLAUDE.md i18n discipline: don't ship machine-translated copy to
  // prominent surfaces). Consumers use `t(key) || 'English'` fallback.
  es: enKeys, fr: enKeys, de: enKeys, pt: enKeys, it: enKeys,
  ja: enKeys, ko: enKeys, zh: enKeys, ar: enKeys, hi: enKeys,
  ru: enKeys, tr: enKeys, pl: enKeys, nl: enKeys,
};
