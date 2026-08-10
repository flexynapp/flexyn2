// Injuries / Recovery Mode i18n — the InjuryForm overlay and the Workout
// tab's InjuryBanner.
//
// TODO(i18n): English only. Per CLAUDE.md we don't ship machine-translated
// copy, and this surface is a bad candidate for it: several strings are the
// app explaining that it has REMOVED training from someone's plan, which is
// the kind of message that has to land right or it reads as a bug. Every call
// site uses tFallback('key', 'English'), so an untranslated language renders
// correct English rather than a key code.
//
// Muscle-group names are NOT here. They already ship in all 15 languages in
// `i18n-muscle-groups.js`, under bare keys (`chest`, `glutes`, …), and both
// components look them up with tFallback(name.toLowerCase(), name) — the same
// call the onboarding injury step uses. Adding a second set here would be two
// vocabularies for one list.
//
// Notes for whoever translates this:
//
//   • injuries.severity.*.desc — these describe the CONSEQUENCE, not the
//     sensation, and that is deliberate. The old copy said "Mild: some
//     soreness, can train around it" while the app removed the muscle group
//     from every session. Keep the consequence; the feeling is the lead-in.
//     All three severities remove the area — mild included — and `serious`
//     additionally removes what that area helps move (a serious shoulder
//     also drops chest and triceps).
//
//   • injuries.checkIn.* — this prompt is the ONLY thing in the app that
//     offers a restricted muscle group back. It should read as a question a
//     coach asks, not as a form. "Still bothering you?" is deliberately
//     softer than "Are you cleared?"; if your language has a natural way of
//     asking after someone, prefer it over the clinical register.
//
//   • injuries.delete.activeWarning — this fires when deleting an injury that
//     is currently restricting training. It has to be clear that deleting is
//     NOT the same as clearing: both stop the restriction, but only one keeps
//     the history. Do not soften it into "are you sure?".
//
//   • injuries.banner.recoveryMode — "Recovery Mode" is a product name that
//     appears on the Workout tab. Translate it if your language has a natural
//     equivalent; keep it short, it sits in a one-line pill next to a count.
//
//   • injuries.toast.cleared — the "50% for 2 weeks" is a real
//     volume-reintroduction guideline, not a slogan. Keep the numbers.

export const injuriesTranslations = {
  en: {
    // ── The overlay ──────────────────────────────────────────────────────
    'injuries.title.list':          'Injury Log',
    'injuries.title.new':           'Log Injury',
    'injuries.action.close':        'Close',
    'injuries.action.back':         'Back',
    'injuries.action.log':          'Log',
    'injuries.section.active':      'Active',
    'injuries.section.cleared':     'Cleared',

    // ── Empty state ──────────────────────────────────────────────────────
    'injuries.empty.title':         'No injuries logged',
    'injuries.empty.body':          'Tap Log to record an injury.',
    'injuries.empty.cta':           'Log Injury',

    'injuries.title.changed':       'Injury logged',

    // ── A card ───────────────────────────────────────────────────────────
    'injuries.card.cost':           '{count} exercises are out of your sessions',
    'injuries.card.costOne':        '1 exercise is out of your sessions',
    'injuries.card.logged':         'Logged {date}',
    'injuries.card.dateReached':    'Recovery date reached',
    'injuries.card.daysLeft':       '{days}d until recovery',
    'injuries.card.clearedOn':      'Cleared {date}',
    'injuries.card.clear':          'Clear injury',
    'injuries.card.extend':         'Extend date',
    'injuries.card.save':           'Save',

    // ── Deleting ─────────────────────────────────────────────────────────
    'injuries.delete.aria':         'Delete {area} injury',
    'injuries.delete.question':     'Delete this {area} entry?',
    'injuries.delete.activeWarning': 'Those exercises come back into your sessions straight away.',
    'injuries.delete.clearedWarning': 'It leaves your history for good.',
    'injuries.delete.cancel':       'Cancel',
    'injuries.delete.confirm':      'Delete',

    // ── The form ─────────────────────────────────────────────────────────
    'injuries.form.area':           'Affected area',
    'injuries.form.severity':       'Severity',
    'injuries.form.injuredOn':      'Injured on',
    'injuries.form.estRecovery':    'Est. recovery',
    'injuries.form.notes':          'Notes (optional)',
    'injuries.form.notesPlaceholder': 'What happened? Any context for your coach…',
    'injuries.form.submit':         'Log Injury',
    'injuries.form.submitting':     'Logging…',

    'injuries.severity.mild':            'Mild',
    'injuries.severity.mild.desc':       'Sore. That area comes out until you clear it',
    'injuries.severity.moderate':        'Moderate',
    'injuries.severity.moderate.desc':   'Hurts to move. That area comes out',
    'injuries.severity.serious':         'Serious',
    'injuries.severity.serious.desc':    'Sharp pain — that area and what it helps move go',

    // ── The banner ───────────────────────────────────────────────────────
    'injuries.banner.recoveryMode':  'Recovery Mode — {area}',
    'injuries.banner.recoveryCount': 'Recovery Mode — {count} active injuries',
    'injuries.banner.manage':        'Manage →',

    // ── The check-in ─────────────────────────────────────────────────────
    'injuries.checkIn.title':        'Still bothering you? — {area}',
    'injuries.checkIn.dateArrived':  'The date you set has arrived. Are you cleared to train?',
    'injuries.checkIn.ageDays':      "You logged this {days} days ago, and it's still coming out of your sessions.",
    'injuries.checkIn.ageYesterday': "You logged this yesterday, and it's still coming out of your sessions.",
    'injuries.checkIn.cleared':      "I'm cleared",
    'injuries.checkIn.stillHurts':   'Still hurts',

    // ── Cleared, collapsed ───────────────────────────────────────────────
    'injuries.cleared.count':       '{count} cleared',
    'injuries.cleared.countOne':    '1 cleared',
    'injuries.cleared.show':        'Show',
    'injuries.cleared.hide':        'Hide',

    // ── The Coach footer ─────────────────────────────────────────────────
    'injuries.coach.knows':         'Coach knows about all of these.',
    'injuries.coach.knowsOne':      'Coach knows about this.',
    'injuries.coach.ask':           'Ask it what to train instead',

    // ── What it changed ──────────────────────────────────────────────────
    'injuries.changed.title':       'Your sessions just changed.',
    'injuries.changed.synergists':  'A serious {area} injury also takes out what it helps move — that is why more than one group is on this list.',
    'injuries.changed.out':         "Out, until you're cleared",
    'injuries.changed.still':       'Still yours',
    'injuries.changed.cta':         'Build me a session around it',
    'injuries.changed.notNow':      'Not now',

    // ── Toasts ───────────────────────────────────────────────────────────
    'injuries.toast.logged':        '{area} injury logged. Recovery Mode active.',
    'injuries.toast.logFailed':     'Could not log injury. Try again.',
    'injuries.toast.selectArea':    'Select an affected area',
    'injuries.toast.cleared':       'Injury cleared.',
    'injuries.toast.clearedVolume': 'Injury cleared. Volume reintroduction starts at 50% for 2 weeks.',
    'injuries.toast.clearFailed':   'Could not clear injury. Try again.',
    'injuries.toast.dateUpdated':   'Recovery date updated.',
    'injuries.toast.dateFailed':    'Could not update recovery date. Try again.',
    'injuries.toast.snoozed':       "Keeping it out of your sessions. We'll ask again in {days} days.",
    'injuries.toast.snoozeFailed':  'Could not update. Try again.',
    'injuries.toast.deleteFailed':  'Could not delete injury. Try again.',
    'injuries.toast.warnThreeDays': '{area} recovery date in 3 days. How are you feeling?',
  },
};

export default injuriesTranslations;
