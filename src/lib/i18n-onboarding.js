// Onboarding flow — every user-visible string in src/pages/Onboarding.jsx.
//
// TODO(i18n): ENGLISH ONLY. 14 of the 15 supported languages are missing and
// need a native-speaker pass. Do NOT machine-translate this file — it is the
// first thing a new user ever reads, and CLAUDE.md's i18n rule ("don't ship
// machine-translated copy on prominent surfaces") exists for exactly this
// surface. Until a translator fills them in, `getTranslation` resolves
// language → en → key, so every locale renders these English strings, which is
// what the flow did anyway before it was made translatable at all.
//
// Not in here on purpose:
//   • Muscle group names — `i18n-muscle-groups.js` already carries all 15
//     languages for the eight the injury step offers. The step looks them up
//     by lowercased id (`t('chest')`).
//   • Weekday abbreviations — generated from Intl.DateTimeFormat, so they are
//     correct in every locale for free rather than being 105 hand-written
//     strings.
//   • Exercise names (FOCUS_LIFTS) — these are persisted and matched by name
//     downstream in buildStarterRegimen, so they stay English everywhere until
//     the exercise catalog itself is translated.
//
// The values a user PICKS are ids, never these labels. Onboarding used to
// persist the English display string for the preferred training time, which
// meant a French user's profile stored "Evening"; ids keep the database
// language-independent and let the label move freely.

export const onboardingI18n = {
  en: {
    /* ── Welcome ─────────────────────────────────────────────────── */
    'onboarding.welcome.headline1': 'Train like you',
    'onboarding.welcome.headline2': 'actually mean it.',
    // The word in headline2 that takes the accent colour. Translators: pick the
    // word carrying the emphasis in YOUR sentence, and make sure it appears in
    // headline2 exactly (punctuation is ignored). Leave it out and the headline
    // simply renders unaccented.
    'onboarding.welcome.accentWord': 'mean',
    'onboarding.welcome.cta': 'Get started',
    'onboarding.welcome.trustLine': 'Free to start · no card needed',
    'onboarding.welcome.haveAccount': 'I already have an account',

    /* ── Feature carousel ────────────────────────────────────────── */
    'onboarding.feature.coach.eyebrow': 'AI Coach',
    'onboarding.feature.coach.title': 'A coach that adapts in real time',
    'onboarding.feature.coach.sub': 'Reads your sets. Adjusts tomorrow. No guesswork.',
    'onboarding.feature.log.eyebrow': 'Smart Log',
    'onboarding.feature.log.title': 'Logging that finishes your sentence',
    'onboarding.feature.log.sub': 'Auto-detects sets, plates, RPE. Hands stay on the bar.',
    'onboarding.feature.progress.eyebrow': 'Progress',
    'onboarding.feature.progress.title': 'Watch your numbers climb',
    'onboarding.feature.progress.sub': 'PR tracking, volume curves, e1RM that actually mean something.',
    'onboarding.feature.recovery.eyebrow': 'Recovery',
    'onboarding.feature.recovery.title': 'Train hard. Recover smarter.',
    'onboarding.feature.recovery.sub': 'Readiness score syncs with sleep, soreness, last session.',
    'onboarding.feature.streaks.eyebrow': 'Streaks',
    'onboarding.feature.streaks.title': 'Show up. Stack the days.',
    'onboarding.feature.streaks.sub': 'Streak shields, weekly missions, and the only leaderboard that matters: yours.',
    'onboarding.feature.showAria': 'Show {name}',

    /* ── Goal step ───────────────────────────────────────────────── */
    'onboarding.goal.kicker': 'Goal',
    'onboarding.goal.heading': 'What are you here for?',
    'onboarding.goal.strength.title': 'Build strength',
    'onboarding.goal.strength.sub': 'Compound lifts. Heavy. Honest.',
    'onboarding.goal.muscle.title': 'Add muscle',
    'onboarding.goal.muscle.sub': 'Hypertrophy program, smart volume.',
    'onboarding.goal.lose.title': 'Lose fat',
    'onboarding.goal.lose.sub': 'Recomp without losing the gains.',
    'onboarding.goal.speed.title': 'Run faster',
    'onboarding.goal.speed.sub': 'Sharpen your pace — intervals & tempo.',
    'onboarding.goal.endurance.title': 'Run further',
    'onboarding.goal.endurance.sub': 'Build distance without burning out.',
    'onboarding.goal.mobility.title': 'Move better',
    'onboarding.goal.mobility.sub': 'Mobility, flexibility, longevity.',
    'onboarding.goal.helper.none': 'Pick one or many — we tailor your plan to the combination.',
    'onboarding.goal.helper.one': "Nice. Add another if you're after a few outcomes.",
    'onboarding.goal.helper.few': "Stacking {count} goals — we'll balance your plan.",
    'onboarding.goal.helper.many': 'Heads up: 4+ goals slows visible progress on each.',
    'onboarding.goal.selectPrompt': 'Select goals',
    'onboarding.goal.selectedCount': '{count} selected',
    'onboarding.goal.clear': 'Clear',
    'onboarding.goal.ctaEmpty': 'Pick at least one',
    'onboarding.goal.ctaMulti': 'Continue with {count}',

    /* ── Sharpen step ────────────────────────────────────────────── */
    'onboarding.sharpen.kicker': 'Sharpen',
    'onboarding.sharpen.heading': "Let's sharpen your plan.",
    'onboarding.sharpen.sub': 'A few quick details make your starter plan spot-on — all optional.',
    'onboarding.sharpen.cardioPrompt': 'What are you training for?',
    'onboarding.sharpen.event.5k': '5K',
    'onboarding.sharpen.event.10k': '10K',
    'onboarding.sharpen.event.half': 'Half',
    'onboarding.sharpen.event.marathon': 'Marathon',
    'onboarding.sharpen.event.general': 'General',
    'onboarding.sharpen.recentTime': 'Know a recent time?',
    'onboarding.sharpen.recentTimeFor': 'Recent {distance} time?',
    'onboarding.sharpen.distance.1mi': '1 mi',
    'onboarding.sharpen.distance.5k': '5K',
    'onboarding.sharpen.distance.10k': '10K',
    'onboarding.sharpen.minPlaceholder': 'min',
    'onboarding.sharpen.secPlaceholder': 'sec',
    'onboarding.sharpen.noTimeHint': "Don't know it? Log a run in Cardio anytime and we'll dial it in.",
    'onboarding.sharpen.liftsPrompt': 'Which lifts matter most?',
    'onboarding.sharpen.liftsHint': "We'll lead your plan with the lifts you pick.",
    'onboarding.sharpen.allSet': "You're all set",
    'onboarding.sharpen.allSetSub': "We've got what we need — your plan's ready to build.",

    /* ── Experience step ─────────────────────────────────────────── */
    'onboarding.experience.kicker': 'Experience',
    'onboarding.experience.heading': 'How long have you been training?',
    'onboarding.experience.sub': 'Honest answers get you a better program.',
    'onboarding.level.newbie.label': 'New',
    'onboarding.level.newbie.sub': 'Less than 6 months lifting',
    'onboarding.level.newbie.desc': "We'll start light, build form first.",
    'onboarding.level.returning.label': 'Returning',
    'onboarding.level.returning.sub': 'Coming back after a break',
    'onboarding.level.returning.desc': 'Ramp gently. Avoid the soreness wall.',
    'onboarding.level.consistent.label': 'Consistent',
    'onboarding.level.consistent.sub': '6–24 months under the bar',
    'onboarding.level.consistent.desc': 'Progressive overload, real periodization.',
    'onboarding.level.advanced.label': 'Advanced',
    'onboarding.level.advanced.sub': '2+ years, lifts close to plateau',
    'onboarding.level.advanced.desc': 'Specificity, blocks, and earned PRs.',
    'onboarding.experience.ctaEmpty': 'Pick your experience level',

    /* ── Assessment step ─────────────────────────────────────────── */
    'onboarding.assessment.kicker': 'Assessment',
    'onboarding.assessment.heading': 'Quick lift check',
    'onboarding.assessment.sub': 'Optional — the more honest you are, the better the plan. Your AI Coach uses these to set starting volume.',
    'onboarding.assessment.q.pushups_20': '20 push-ups in a row',
    'onboarding.assessment.q.plank_60s': 'A 60-second plank',
    'onboarding.assessment.q.squat_bw15': 'Squat 1.5× your bodyweight',
    'onboarding.assessment.q.pullups_10': '10 strict pull-ups in a row',
    'onboarding.assessment.q.mile_under10': 'A mile under 10 minutes',
    'onboarding.assessment.answer.yes': 'Yes',
    'onboarding.assessment.answer.not_yet': 'Not yet',
    'onboarding.assessment.skip': 'Skip — generate a generic plan',

    /* ── About you (username, age, sex) ──────────────────────────── */
    'onboarding.about.kicker': 'About You',
    'onboarding.about.heading': 'Tell us about yourself.',
    'onboarding.about.sub': 'We use this to calibrate your plan. Encrypted, never sold.',
    'onboarding.about.sexPrompt': 'What sex were you assigned at birth?',
    'onboarding.about.sexFemale': 'Female',
    'onboarding.about.sexMale': 'Male',
    'onboarding.about.sexOther': 'Other',
    // Distinct from sexOther on purpose: "Other" states something about the
    // user's sex, "Prefer not to say" declines to. They compute the same
    // conservative middle downstream; the difference is kept in the data.
    'onboarding.about.sexSkip': 'Prefer not to say',
    'onboarding.about.usernamePrompt': 'What should we call you?',
    'onboarding.about.usernamePlaceholder': 'e.g. jordan_lifts',
    'onboarding.about.usernameStripped': 'Letters, numbers and underscores only — capitals are auto-lowered.',
    'onboarding.about.agePrompt': 'How old are you?',
    'onboarding.about.ageAria': 'Your age',
    'onboarding.about.ageTapAria': 'Tap to type your age',
    'onboarding.about.ageHint': 'TAP TO TYPE OR DRAG',
    // The `onboarding.about.sex.*` trio that used to sit here is gone. The step
    // looked those up with sexFemale/sexMale/sexSkip as the FALLBACK, so
    // `sex.other` ('Other') shadowed the "Prefer not to say" the code
    // specified and the button had been rendering the wrong word. A fallback
    // only fires when the key is missing, and these weren't.
    'onboarding.about.ctaNoUsername': 'Choose a username to continue',
    'onboarding.about.ctaBadUsername': 'Pick a different username',
    // Sex is required — see canLeaveAboutStep. The blocker names itself
    // because a dead Continue with no reason is what the username states
    // already learned not to do.
    'onboarding.about.ctaNoSex': 'Answer the sex question to continue',

    /* Life-stage chip */

    /* ── Height step ─────────────────────────────────────────────── */
    'onboarding.height.kicker': 'Height',
    'onboarding.height.heading': 'How tall are you?',
    'onboarding.height.unitImperial': 'ft·in',
    'onboarding.height.unitMetric': 'cm',
    'onboarding.height.tapHintMetric': 'CM · TAP TO TYPE',
    'onboarding.height.tapHintImperial': 'FT · IN · TAP TO TYPE',
    'onboarding.height.tapAria': 'Tap to type your height',
    'onboarding.height.hintImperial': "Enter feet and inches — e.g. 5'10 or 511. Switch to cm above if that's what you meant.",
    'onboarding.height.hintMetric': "Enter centimetres — e.g. 178. Switch to ft·in above if that's what you meant.",
    'onboarding.height.ariaMetric': 'Your height in centimeters',
    'onboarding.height.ariaImperial': 'Your height in feet and inches',

    /* ── Weight step ─────────────────────────────────────────────── */
    'onboarding.weight.kicker': 'Weight',
    'onboarding.weight.heading': 'How much do you weigh?',
    'onboarding.weight.dialHint': 'Tap to type · drag to set',
    'onboarding.weight.ariaKg': 'Weight in kilograms',
    'onboarding.weight.ariaLb': 'Weight in pounds',


    /* ── Schedule step ───────────────────────────────────────────── */
    'onboarding.schedule.kicker': 'Schedule',
    'onboarding.schedule.heading': 'Which days can you train?',
    'onboarding.schedule.sub': "Plan around real life — we'll keep recovery in check.",
    'onboarding.schedule.daysPerWeek': 'days · week',
    'onboarding.schedule.intensity.none': '—',
    'onboarding.schedule.intensity.light': 'Light cadence',
    'onboarding.schedule.intensity.balanced': 'Balanced',
    'onboarding.schedule.intensity.serious': 'Serious',
    'onboarding.schedule.intensity.hardcore': 'Hardcore',
    'onboarding.schedule.preferredTime': 'Preferred time',
    'onboarding.schedule.pickAll': 'Pick all that apply',
    'onboarding.schedule.time.morning': 'Morning',
    'onboarding.schedule.time.midday': 'Midday',
    'onboarding.schedule.time.evening': 'Evening',
    'onboarding.schedule.time.late_night': 'Late night',
    'onboarding.schedule.ctaEmpty': 'Pick at least one day',

    /* ── Injury step ─────────────────────────────────────────────── */
    'onboarding.injury.kicker': 'Any injuries? · optional',
    'onboarding.injury.heading': "We'll work around them from day one.",
    'onboarding.injury.sub': "Moderate and serious injuries are excluded from your starter plan; mild ones stay in with an ease-in note. Skip if you're all good.",
    'onboarding.injury.capReached': "You've logged the max of 5. Add more later in Progress → Recovery.",
    'onboarding.injury.muscleGroup': 'Muscle group',
    'onboarding.injury.severity': 'Severity',
    'onboarding.injury.severity.mild': 'Mild',
    'onboarding.injury.severity.moderate': 'Moderate',
    'onboarding.injury.severity.serious': 'Serious',
    'onboarding.injury.add': '+ Add injury',
    'onboarding.injury.removeAria': 'Remove',
    'onboarding.injury.ctaLogged': 'Continue · {count} logged',
    'onboarding.injury.skip': 'Skip — no injuries',

    /* ── Home gym step ───────────────────────────────────────────── */
    'onboarding.homeGym.kicker': 'Where do you train? · optional',
    'onboarding.homeGym.heading': 'Pick your gym and meet your floor.',
    'onboarding.homeGym.sub': "Your gym gets a bubble on the Flexyn map, and you'll get a leaderboard with everyone else who trains there. You can change this any time.",
    // No radius claim — the picker states the distance it actually searched
    // directly above this. See the note on myGym.pickEmptyHint.
    'onboarding.homeGym.emptyHint': "Add it yourself below, or skip for now — you can pick your gym from the map later.",
    'onboarding.homeGym.ctaPicked': 'Continue · {name}',
    'onboarding.homeGym.skip': "Skip — I'll pick later",
    'onboarding.homeGym.laterHint': 'You can set your gym any time from Profile → My Gym.',

    /* ── Loading step ────────────────────────────────────────────── */
    'onboarding.loading.heading': 'Building your plan',
    'onboarding.loading.sub': 'Tuned to your goal · experience · schedule',
    'onboarding.loading.task.1': 'Reading your goals',
    'onboarding.loading.task.2': 'Mapping training volume',
    'onboarding.loading.task.3': 'Calibrating progression',
    'onboarding.loading.task.4': 'Pairing exercises to equipment',
    'onboarding.loading.task.5': 'Stress-testing recovery',
    'onboarding.loading.task.6': 'Locking in week one',

    /* ── Reveal step ─────────────────────────────────────────────── */
    // The summary IS the step — it is the only line built entirely from the
    // user's own answers, so it opens the page with nothing above it and
    // nothing restating it below. Five strings that used to crowd it are
    // gone: two "ready" badges asserting a completeness nothing measured, a
    // "Welcome in, {name}." greeting that told the user their own name, a
    // "Your starter plan" eyebrow, and the regimen's title under it — the
    // last three all naming the plan the heading had just described.
    'onboarding.reveal.summary': 'A {weeks}-week {goal}{extra} block, dialled in for a {level} lifter on {days} days.',
    'onboarding.reveal.summaryExtra': ' + {count} more',
    'onboarding.reveal.planMeta': 'Saved to Workout → Regimens',
    'onboarding.reveal.cta': 'Enter Flexyn',
    'onboarding.reveal.saving': 'Saving…',

    /* ── Shared controls ─────────────────────────────────────────── */
    'onboarding.common.continue': 'Continue',
    'onboarding.common.back': 'Back',

    /* ── Errors and toasts ───────────────────────────────────────── */
    'onboarding.error.usernameProfane': 'Username contains inappropriate language.',
    'onboarding.error.usernameTooLong': 'Username must be 20 characters or less.',
    'onboarding.error.usernameTaken': 'That username is already taken.',
    'onboarding.error.usernameTakenRetry': 'That username is already taken. Try another.',
    'onboarding.error.usernameProhibited': 'That username contains prohibited content. Pick another.',
    'onboarding.toast.usernameTaken': 'That username is already taken — try another.',
    'onboarding.toast.usernameProhibited': 'Username contains prohibited content — pick another.',
    'onboarding.toast.partialSave': 'Some profile details could not be saved — finish setup from Settings later.',
    'onboarding.toast.offline': "You're offline — reconnect and tap Save again.",
    'onboarding.toast.saveFailed': 'Could not save your profile{code}. Tap Save to retry{detail}',
    'onboarding.toast.injuriesFailed': "We couldn't save your injury history — add it from Progress → Recovery so your plan works around it.",
  },
};
