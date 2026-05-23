// src/lib/i18n-session-strings.js
//
// English translations for strings introduced during the May 2026
// feature waves (M, N, O, P). All copy is English-only at this
// point — a native-translator pass should fill in the 14 other
// locales per the CLAUDE.md "no machine translation" rule. The
// tFallback('key', 'English') call sites embed English fallbacks
// inline, so missing translations gracefully degrade to English
// rather than rendering the key code.
//
// Surfaces covered:
//   • StarterPlanHeroCard (onboarding → workout handoff)
//   • FirstWorkoutTutorial (first-session coach marks)
//   • GiftCoinsModal (peer-to-peer coin gifting)

export const sessionStringsI18n = {
  en: {
    // ── StarterPlanHeroCard ──────────────────────────────────────
    'workout.starter.kicker':       'Built by your AI Coach',
    'workout.starter.title':        'Your starter plan is ready',
    'workout.starter.startCta':     'Start your first workout',
    'workout.starter.customize':    'Customize',
    'workout.starter.customizeAria':'Customize starter plan',
    'workout.starter.moreCount':    '+{n} more',
    'workout.starter.daysPerWeek':  '{n}×/week',
    // Goal labels
    'workout.starter.goal.strength':  'Strength',
    'workout.starter.goal.muscle':    'Muscle',
    'workout.starter.goal.lose':      'Fat loss',
    'workout.starter.goal.endurance': 'Endurance',
    'workout.starter.goal.mobility':  'Mobility',
    // Level labels
    'workout.starter.level.newbie':     'Beginner',
    'workout.starter.level.returning':  'Returning',
    'workout.starter.level.consistent': 'Consistent',
    'workout.starter.level.advanced':   'Advanced',

    // ── FirstWorkoutTutorial ─────────────────────────────────────
    'workout.tutorial.step':                 'Tip {n} / {total}',
    'workout.tutorial.skip':                 'Skip',
    'workout.tutorial.next':                 'Next',
    'workout.tutorial.gotIt':                'Got it',
    'workout.tutorial.dismiss':              'Dismiss tutorial',
    'workout.tutorial.step1.title':          'Welcome to your first workout',
    'workout.tutorial.step1.body':           'Your AI Coach pre-loaded the exercises. Tap a set row to start logging.',
    'workout.tutorial.step2.title':          'Enter weight + reps per set',
    'workout.tutorial.step2.body':           'Each row has a weight field and a reps field. The last set from prior sessions seeds future workouts automatically.',
    'workout.tutorial.step3.title':          'Tap "Save workout" when finished',
    'workout.tutorial.step3.body':           'The big button at the bottom of the page saves the session, awards XP, and updates your streak.',

    // ── GiftCoinsModal ───────────────────────────────────────────
    'gift.title':            'Send a gift',
    'gift.sendingTo':        'Sending coins to {recipient}',
    'gift.thisUser':         'this user',
    'gift.customAmount':     'Custom amount',
    'gift.balance':          'Balance: {n} coins · max 10,000 per gift',
    'gift.notEnough':        "You don't have enough coins.",
    'gift.maxPerGift':       'Max 10,000 per gift.',
    'gift.message':          'Message (optional)',
    'gift.messagePlaceholder': 'Crushed that PR!',
    'gift.send':             'Send {n} coins',
    'gift.sending':          'Sending…',
    'gift.successToast':     'Sent {amount} coins to {recipient}.',
    'gift.error.insufficient':   "You don't have enough coins.",
    'gift.error.pipeline':       'Gifting not yet available on this server.',
    'gift.error.self':           "You can't gift yourself coins.",
    'gift.error.notFound':       'Recipient could not be found.',
    'gift.error.generic':        'Could not send gift. Try again.',
  },
};
