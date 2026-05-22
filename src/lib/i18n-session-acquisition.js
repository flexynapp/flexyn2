/* eslint-disable */
//
// src/lib/i18n-session-acquisition.js
//
// English-only translations for the acquisition + activation
// surfaces shipped in the May 2026 session. The keys are still
// referenced via `tFallback('key', 'English fallback')` at the
// call sites, so this file isn't strictly required for English
// rendering — it exists to provide a SINGLE PLACE for native
// translators to fill in the other 14 languages without having
// to chase tFallback calls across 15+ component files.
//
// TODO(i18n): translate the keys below into:
//   es fr de pt it ja ko zh ar hi ru tr pl nl
//
// Don't machine-translate per the CLAUDE.md policy:
//   "Don't ship machine-translated copy on prominent surfaces."
//
// PRIORITIES FOR THE TRANSLATION BATCH
// ────────────────────────────────────
// All surfaces here are USER-VISIBLE on the Dashboard, Hub, and
// Progress pages — they hit the highest-traffic real estate.
// The first 3 categories below see the most impressions:
//
//   1. pushOptIn.*        — Dashboard banner, shown to every user not
//                           subscribed to push (≥50% of MAU today)
//   2. onboarding.*       — Dashboard nudge sequence shown for 5–7
//                           days post-signup
//   3. followSuggest.*    — Hub feed rail shown to every user with
//                           <3 followees (the empty-feed trap cohort)
//
// Lower-priority categories appear less often:
//
//   4. crewSuggestion.*   — Hub Crews tab only
//   5. friendLeaderboard.* — Hub feed, requires mutual follows to populate
//   6. calendar.*         — Progress page only
//   7. memory.*           — Dashboard, requires past-year workout match
//   8. pr.share.* / recap.share.* — modal-only, requires share intent
//   9. iosInstall.*       — iOS Safari only, ~15% of installs
//   10. liveActivity.*    — Hub feed only, requires followees to be active
//   11. profileBadges.*   — Hub profile only
//   12. referral.*        — Hub profile only (own profile)

export default {
  en: {
    // ── Dashboard: push opt-in banner ──────────────────────────────
    'pushOptIn.title':         'Stay in the loop',
    'pushOptIn.subtitle':      "Get a ping when your nemesis logs a workout, your streak's at risk, or your crew needs you.",
    'pushOptIn.enable':        'Enable',
    'pushOptIn.enabling':      'Enabling…',
    'pushOptIn.notNow':        'Not now',
    'pushOptIn.close':         'Dismiss',
    'pushOptIn.aria':          'Enable notifications',
    'pushOptIn.success':       'Notifications enabled — see you out there.',
    'pushOptIn.denied':        'Permission denied — enable notifications in your browser settings to re-try.',
    'pushOptIn.unsupported':   "Push notifications aren't supported on this device.",
    'pushOptIn.serverError':   'Could not save your subscription. Try again later.',

    // ── Dashboard: iOS install banner ──────────────────────────────
    'iosInstall.title':        'Install Flexyn',
    'iosInstall.subtitle':     'For instant launches, full-screen mode, and reliable push notifications.',
    'iosInstall.step1':        'Tap',
    'iosInstall.step2':        'then',
    'iosInstall.step3':        'Add to Home Screen',
    'iosInstall.close':        'Dismiss',
    'iosInstall.aria':         'Install Flexyn on your home screen',

    // ── Dashboard: 7-day onboarding nudge ──────────────────────────
    'onboarding.first_workout.title': 'Log your first workout',
    'onboarding.first_workout.body':  'Two minutes. Just one set. The streak starts today.',
    'onboarding.first_workout.cta':   'Start',
    'onboarding.enable_push.title':   'Turn on notifications',
    'onboarding.enable_push.body':    'Stay looped in on your nemesis, your crew, and at-risk streaks.',
    'onboarding.enable_push.cta':     'Enable',
    'onboarding.enable_push.success': 'Notifications on — see you out there.',
    'onboarding.follow_friend.title': 'Follow your first friend',
    'onboarding.follow_friend.body':  'Their workouts show up in your feed. Yours show up in theirs.',
    'onboarding.follow_friend.cta':   'Find people',
    'onboarding.try_regimen.title':   'Try a regimen',
    'onboarding.try_regimen.body':    'Pre-built routines for legs, push, pull. No more guessing what to lift.',
    'onboarding.try_regimen.cta':     'Browse',
    'onboarding.share_week.title':    'Share your week',
    'onboarding.share_week.body':     'A polished card of your stats. Post to Stories — it counts.',
    'onboarding.share_week.cta':      'See it',
    'onboarding.invite_friend.title': 'Invite a friend',
    'onboarding.invite_friend.body':  'You both get 200 coins + an Elite capsule. Use your code.',
    'onboarding.invite_friend.cta':   'Open',
    'onboarding.dismiss':             'Dismiss',

    // ── Dashboard: workout suggestion ──────────────────────────────
    'suggestion.kicker': 'Tomorrow',

    // ── Dashboard: workout memory ─────────────────────────────────
    'memory.youTrained':  'You trained on this day',
    'memory.replayHint':  'Hit the gym today to top it.',
    'memory.dismiss':     'Dismiss for today',

    // ── Hub: follow suggestions rail ──────────────────────────────
    'followSuggest.kicker':       'Suggested for you',
    'followSuggest.kickerEmpty':  'Build your feed',
    'followSuggest.dismiss':      'Hide suggestions for now',
    'followSuggest.aria':         'Suggested accounts to follow',
    'followSuggest.failed':       'Could not follow — try again.',

    // ── Hub: crew suggestions rail ────────────────────────────────
    'crewSuggestion.title':       'Suggested crews',
    'crewSuggestion.dismiss':     'Hide suggestions',
    'crewSuggestion.aria':        'Suggested crews to join',
    'crewSuggestion.joined':      "Joined! You're in — head to the crew chat to say hi.",
    'crewSuggestion.joinFailed':  'Could not join — that crew may now be full.',

    // ── Hub: friend leaderboard ───────────────────────────────────
    'friendLeaderboard.title':           'Friends this week',
    'friendLeaderboard.loading':         'Loading…',
    'friendLeaderboard.empty':           'Follow people back to start a leaderboard.',
    'friendLeaderboard.you':             'You',
    'friendLeaderboard.mode.weekly_xp':       'XP',
    'friendLeaderboard.mode.weekly_volume':   'Volume',
    'friendLeaderboard.mode.weekly_sessions': 'Sessions',

    // ── Hub: live activity rail ───────────────────────────────────
    'liveActivity.title':     'Live now',
    'liveActivity.oneActive': '1 friend training',
    'liveActivity.nActive':   '{count} friends training',
    'liveActivity.aria':      'Friends working out right now',

    // ── Hub: profile badge showcase ───────────────────────────────
    'profileBadges.title':   'Recent badges',
    'profileBadges.viewAll': 'See all',

    // ── Hub: referral card ────────────────────────────────────────
    'referral.kicker':          'Invite friends',
    'referral.pitch':           'Share your code. When a friend signs up, you both get 200 coins + an Elite capsule.',
    'referral.copy':            'Copy invite link',
    'referral.copied':          'Link copied',
    'referral.copyFailed':      'Could not copy — try the share button.',
    'referral.share':           'Share',
    'referral.shareTitle':      'Join me on Flexyn',
    'referral.shareText':       'Sign up with my code and we both get 200 coins + an Elite capsule.',
    'referral.invited.one':     '1 friend joined',
    'referral.invited.many':    '{count} friends joined',
    'referral.lifetime':        'Lifetime',
    'referral.coins':           'coins',
    'referral.capsule':         'capsule',
    'referral.capsules':        'capsules',

    // ── Progress: workout calendar grid ───────────────────────────
    'calendar.title':        'Activity',
    'calendar.daysTrained':  '{count} days in last 6 months',
    'calendar.noWorkout':    'no workout',
    'calendar.less':         'Less',
    'calendar.more':         'More',

    // ── Share card modals ─────────────────────────────────────────
    'recap.share.title':    'Share your week',
    'recap.share.download': 'Save image',
    'recap.share.share':    'Share',
    'recap.share.hint':     'Posts to Instagram, TikTok, or download for anywhere else.',
    'recap.share.cta':      'Share',
    'pr.share.title':       'Share your PR',
    'pr.share.download':    'Save image',
    'pr.share.share':       'Share',

    // ── Streak rescue (dashboard banner + toasts) ─────────────────
    'streakRescue.title':         'Save your {streak}-day streak',
    'streakRescue.subtitle':      'You missed yesterday. Use your monthly rescue to keep it alive.',
    'streakRescue.cta':           'Save streak',
    'streakRescue.saving':        'Saving…',
    'streakRescue.saved':         'Streak saved! Work out today to keep it going.',
    'streakRescue.alreadyUsed':   'Rescue already used this month — try again next month.',
    'streakRescue.failed':        'Could not save streak — try again.',
    'streakRescue.unavailable':   'Streak rescue not available yet.',
  },
};
