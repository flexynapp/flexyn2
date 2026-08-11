// Insights tab i18n — src/components/progress/InsightsTab.jsx: training
// age, the TDEE estimate, the projected goal date, the push/pull/legs
// balance read, and the three CSV export buttons.
//
// TODO(i18n): English only. Per CLAUDE.md we don't ship machine-translated
// copy. Every call site uses tFallback('key', 'English'), so an untranslated
// language renders correct English rather than a key code.
//
// The whole file had ZERO translation calls before this — every string was
// a hardcoded English literal across 15 supported languages. These keys are
// what it should have shipped with.
//
// Two conventions worth matching if you add keys here:
//
//   • **Counts get a `.one` / `.other` pair**, never a bare `{n} days`.
//     The old code interpolated straight into a plural literal and rendered
//     "1 days", "1 months" and "1 active weeks" — the last two were visible
//     on screen for anyone in their first week.
//
//   • **Anything with a `{placeholder}` must be tested with a stub that
//     ignores the fallback**, per the i18n section of CLAUDE.md. The
//     standard `(key, english) => english` test stub returns the already-
//     interpolated English and passes even when vars are dropped.

export const insightsTranslations = {
  en: {
    // ── Training age ────────────────────────────────────────────────────
    'insights.trainingAge.title':        'Training Age',
    'insights.trainingAge.empty':        'Log your first workout to see your training age.',
    'insights.trainingAge.since':        'Training since {date}',
    'insights.trainingAge.days.one':     '{n} day',
    'insights.trainingAge.days.other':   '{n} days',
    'insights.trainingAge.months.one':   '{n} month',
    'insights.trainingAge.months.other': '{n} months',
    'insights.trainingAge.years.one':    '{n} year',
    'insights.trainingAge.years.other':  '{n} years',
    'insights.trainingAge.consistent':   'consistent',
    'insights.trainingAge.activeWeeks.one':   '{n} active week',
    'insights.trainingAge.activeWeeks.other': '{n} active weeks',
    'insights.trainingAge.totalWeeks.one':    '{n} total week',
    'insights.trainingAge.totalWeeks.other':  '{n} total weeks',
    'insights.trainingAge.tooEarly':     'Consistency unlocks after two weeks of training.',
    'insights.trainingAge.beginner':     '🌱 Beginner — building the habit',
    'insights.trainingAge.intermediate': '💪 Intermediate — forming real strength',
    'insights.trainingAge.advanced':     '🔥 Advanced — 1+ year dedicated athlete',
    'insights.trainingAge.elite':        '⚡ Elite — 2+ years of consistent training',

    // ── TDEE ────────────────────────────────────────────────────────────
    'insights.tdee.title':          'TDEE Estimate',
    'insights.tdee.incomplete':     'Add your {fields} in Settings to get a TDEE estimate.',
    'insights.tdee.field.weight':   'body weight',
    'insights.tdee.field.height':   'height',
    'insights.tdee.field.age':      'age',
    'insights.tdee.openSettings':   'Open Settings',
    'insights.tdee.perDay':         'cal / day estimated',
    'insights.tdee.bmr':            'BMR',
    'insights.tdee.bmrNote':        'at rest',
    'insights.tdee.sessions':       'Sessions/wk',
    'insights.tdee.sessionsNote':   'last {n} days',
    'insights.tdee.multiplier':     'Activity',
    'insights.tdee.multiplierNote': 'multiplier',
    'insights.tdee.cut':            'Cut (−15%)',
    'insights.tdee.bulk':           'Bulk (+10%)',
    'insights.tdee.cal':            '{n} cal',
    'insights.tdee.earlyEstimate':  'Early estimate — based on {n} days of training. It will sharpen as you log more.',
    // Shown when `gender` is unset — 44 of 53 production profiles. Keep it
    // a statement about the ESTIMATE, not about the person: the app does
    // not know, and the copy should read as the app admitting that rather
    // than as a prompt about their identity.
    'insights.tdee.sexAssumed':
      'Estimated between the male and female formulas. Add your gender in Settings to sharpen it.',

    // ── Projected goal ──────────────────────────────────────────────────
    'insights.goal.title':        'Projected Goal Date',
    'insights.goal.empty':        'Log at least 2 body weight entries to see a projection.',
    'insights.goal.emptyCta':     'Log your weight',
    'insights.goal.yourGoal':     'Your goal weight',
    'insights.goal.placeholder':  'Goal in {unit}',
    'insights.goal.set':          'Set',
    'insights.goal.clear':        'Clear',
    'insights.goal.saved':        'Goal weight saved',
    'insights.goal.cleared':      'Goal weight cleared',
    'insights.goal.invalid':      'Enter a goal weight above 0 first.',
    'insights.goal.wrongWay':     'Trending wrong way',
    'insights.goal.wrongWayNote': 'Your weight is moving away from your goal at {rate}/week.',
    'insights.goal.reached':      'Already reached! 🎉',
    'insights.goal.daysAway.one':   '{n} day away · {rate}/week pace',
    'insights.goal.daysAway.other': '{n} days away · {rate}/week pace',
    'insights.goal.losing':       'losing weight',
    'insights.goal.gaining':      'gaining weight',
    'insights.goal.current':      'Current',
    'insights.goal.goal':         'Goal',
    'insights.goal.remaining':    'Remaining',
    'insights.goal.disclaimer':   'Based on your logged weight trend. Actual results vary with diet and training changes.',

    // ── Muscle balance ──────────────────────────────────────────────────
    'insights.balance.title':          'Muscle Imbalance',
    'insights.balance.empty':          'Log workouts with muscle groups assigned to see your push/pull balance.',
    'insights.balance.ratioLabel':     'Push / Pull ratio',
    'insights.balance.balanced':       '✓ Balanced',
    'insights.balance.pushDominant':   '↑ Push-dominant',
    'insights.balance.pullDominant':   '↑ Pull-dominant',
    'insights.balance.pushOnly':       'No pull volume',
    'insights.balance.pullOnly':       'No push volume',
    'insights.balance.pushOnlyNote':   'All your logged volume is push. Add rows or pulldowns to balance your shoulders out.',
    'insights.balance.pullOnlyNote':   'All your logged volume is pull. Add presses to balance it out.',
    'insights.balance.ideal':          'Ideal is ~1:1 · yours is {side}',
    'insights.balance.morePush':       'more push',
    'insights.balance.morePull':       'more pull',
    'insights.balance.push':           'Push (chest/shoulders/triceps)',
    'insights.balance.pull':           'Pull (back/biceps)',
    'insights.balance.legs':           'Legs (quads/hamstrings/glutes)',
    'insights.balance.shareNote':      'Share of volume with a muscle group assigned.',
    'insights.balance.uncategorized':  '{n}% of your volume has no muscle group assigned and is not counted here.',

    // ── Export ──────────────────────────────────────────────────────────
    'insights.export.title':        'Export My Data',
    'insights.export.desc':         'Download your data as CSV files, compatible with Excel, Google Sheets, and Apple Health apps.',
    'insights.export.workouts':     'Workout Logs',
    'insights.export.workoutsSub.one':   '{n} session · all exercises & sets',
    'insights.export.workoutsSub.other': '{n} sessions · all exercises & sets',
    'insights.export.body':         'Body Metrics',
    'insights.export.bodySub.one':   '{n} entry · weight, body fat, measurements',
    'insights.export.bodySub.other': '{n} entries · weight, body fat, measurements',
    'insights.export.cardio':       'Cardio Logs',
    'insights.export.cardioSub.one':   '{n} session · runs, cycling, etc.',
    'insights.export.cardioSub.other': '{n} sessions · runs, cycling, etc.',
    'insights.export.noWorkouts':   'No workout data to export.',
    'insights.export.noBody':       'No body metric entries to export.',
    'insights.export.noCardio':     'No cardio data to export.',
    'insights.export.failed':       'Could not export that file.',
    'insights.export.done.one':     'Exported {n} row',
    'insights.export.done.other':   'Exported {n} rows',

    // ── CSV column headers ──────────────────────────────────────────────
    // Deliberately NOT translated at the call site — a CSV is a data
    // interchange file, and a German user mailing one to a coach is better
    // served by stable English headers than by localized ones that break
    // every downstream script. Kept here so that decision is visible
    // rather than looking like an oversight.
  },
};

export default insightsTranslations;
