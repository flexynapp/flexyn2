// src/lib/i18n-discovery.js
//
// Translations for the Dashboard DiscoveryCards onboarding affordances.
// English ships first; other languages inherit English via the fallback
// pattern (`t(key) || 'English'`) consumers already use. A follow-up i18n
// pass will localize these — pulled out into its own part file so that
// pass can grep cleanly for `discovery.*` keys.

const enKeys = {
  'discovery.dismiss':            'Dismiss',

  'discovery.starter.kicker':     'YOUR PLAN',
  'discovery.starter.title':      'Your starter plan is ready',
  'discovery.starter.body':       "We built a regimen from your onboarding answers. Open it in Workout to start your first session.",
  'discovery.starter.cta':        'Start your first workout',

  'discovery.formCoach.kicker':   'BETA',
  'discovery.formCoach.title':    'Try Form Coach',
  'discovery.formCoach.body':     'On-device AI checks your lift form from a quick photo. No video, no upload — runs right on your phone.',
  'discovery.formCoach.cta':      'Try Form Coach',

  'discovery.coach.kicker':       'YOUR COACH',
  'discovery.coach.title':        'Meet your AI Coach',
  'discovery.coach.body':         'Personal advice tuned to your actual workouts, weight, and goals. Ask anything — programming, plateaus, recovery.',
  'discovery.coach.cta':          'Open Coach',
};

// Other languages inherit English for now. The fallback pattern in the
// consuming components (`t(key) || 'English literal'`) means a missing
// translation surfaces a sensible string, not a key code. A dedicated
// translation pass can replace these with real translations.
export const discoveryI18n = {
  en: enKeys,
  es: enKeys, fr: enKeys, de: enKeys, pt: enKeys, it: enKeys,
  ja: enKeys, ko: enKeys, zh: enKeys, ar: enKeys, hi: enKeys,
  ru: enKeys, tr: enKeys, pl: enKeys, nl: enKeys,
};
