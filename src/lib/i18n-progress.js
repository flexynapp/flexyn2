// Progress page i18n — the main view of src/pages/Progress.jsx: the hero
// carousel, the timeframe stats card, the last-workout callout, the Top PRs
// rail, the tab bar, and the Weekly Review summary. Also the two surfaces
// that file renders into modals (Personal Bests, the analytics charts).
//
// TODO(i18n): English only. Per CLAUDE.md we don't ship machine-translated
// copy. Every call site uses tFallback('key', 'English'), so an untranslated
// language renders correct English rather than a key code.
//
// Three sets of strings are deliberately NOT here:
//
//   • Muscle-group names. They already ship in all 15 languages under
//     `muscleGroups.<muscleKey>` and the pills, the charts and the filter
//     dropdown all look them up there. A second vocabulary would be two
//     answers to one question.
//
//   • 'Today' / 'Yesterday' / 'All'. `progress.today`, `progress.yesterday`
//     and `progress.all` already exist in all 15 languages — they had simply
//     stopped being used, while this file hardcoded the same three words in
//     English. The call sites now point back at them.
//
//   • Anything under `progress.*` that was already wired (`progress.title`,
//     `progress.personalBests`, the chart headings, the filter labels). This
//     file adds what was missing, it does not restate what worked.
//
// Notes for whoever translates this:
//
//   • progress.frame.* — these name a ROLLING window, not a calendar period.
//     "Last 7 Days" is seven days back from right now; it is deliberately not
//     "This Week", which is what it used to say and which disagreed with the
//     Weekly Review card directly below it on the same screen (that one is a
//     real ISO week and says so — "Week 32, 2026"). Keep the rolling sense.
//
//   • progress.frameShort.* — the four toggle buttons under the muscle pills.
//     They sit in a segmented control roughly 40px wide each, so they are
//     abbreviations on purpose. If your language has no natural two-letter
//     form, prefer a short word over a cramped one; the control grows.
//
//   • progress.slide.*.tip — the carousel's coaching lines. These are the
//     only place on the page that talks TO the user rather than reporting a
//     number, and they change with their state (a streak of 0 gets different
//     copy from a streak of 12). Keep them short enough for two lines at
//     36 characters and keep the second person.
//
//   • progress.slide.streak.tipActive says skipping resets the streak to 0.
//     That is the real rule, not a scare tactic. Do not soften it.
//
//   • progress.lastWorkout.freestyle — the fallback name for a session that
//     was logged without picking a regimen. It is a label for a KIND of
//     workout, not a product name; translate it.
//
//   • progress.stat.volumeUnit / progress.frame.volumeLifted take {unit},
//     which is already localised elsewhere (lbs / kg / stone). Keep the
//     placeholder and put it where your language wants the unit.
//
//   • The *_one / *_other pairs are English's two plural forms. If your
//     language needs more (or fewer) categories, add the keys your language
//     uses and leave the unused ones out rather than duplicating a form.

export const progressTranslations = {
  en: {
    // ── Tab bar ──────────────────────────────────────────────────────────
    // Deliberately shorter than the existing `progress.tabs.*` keys
    // ("Exercise Trends", "Body Metrics", "Progress Photos"), which are
    // written for a list with room. These four sit in a 2×2 grid of pills.
    'progress.tab.trends':            'Trends',
    'progress.tab.body':              'Body',
    'progress.tab.photos':            'Photos',
    'progress.tab.insights':          'Insights',

    // ── Timeframe frames ─────────────────────────────────────────────────
    'progress.frame.week':            'Last 7 Days',
    'progress.frame.month':           'Last 30 Days',
    'progress.frame.year':            'Last 365 Days',
    'progress.frame.all':             'All Time',
    'progress.frameShort.week':       'Wk',
    'progress.frameShort.month':      'Mo',
    'progress.frameShort.year':       'Yr',
    'progress.frameShort.all':        'All',

    // ── Timeframe stats card ─────────────────────────────────────────────
    'progress.frame.workouts':        'Workouts',
    'progress.frame.volumeLifted':    '{unit} lifted',
    'progress.frame.cardio':          'Cardio',
    'progress.frame.deltaUp':         '↑ {pct}% vs prev',
    'progress.frame.deltaDown':       '↓ {pct}% vs prev',
    'progress.frame.noWorkouts':      'No workouts logged in this period.',
    // Per-stat comparisons. A figure with no comparison attached is
    // decoration, not a stat — so each of the three carries its own.
    // Counts move by a whole number, volume by a percentage; "vs prev"
    // is stated once, on the first, rather than three times in a row.
    'progress.frame.deltaCountUp':    '+{n} vs prev',
    'progress.frame.deltaCountDown':  '−{n} vs prev',
    'progress.frame.deltaCountSame':  'same as prev',
    'progress.frame.deltaPctUp':      '+{pct}%',
    'progress.frame.deltaPctDown':    '−{pct}%',

    // ── Hero stat tiles (rendered inside Advanced Analytics) ─────────────
    'progress.stat.streak':           'Streak',
    'progress.stat.workouts':         'Workouts',
    'progress.stat.volumeUnit':       'Volume ({unit})',
    'progress.stat.level':            'Level',
    'progress.stat.levelValue':       'Lv {level}',

    // ── Carousel ─────────────────────────────────────────────────────────
    'progress.carousel.nextSlide':    'Next slide',
    'progress.carousel.slideN':       'Slide {n}',

    'progress.slide.streak.kicker':   'Streak',
    'progress.slide.streak.none':     'Start today',
    'progress.slide.streak.days_one':   '{n} day',
    'progress.slide.streak.days_other': '{n} days',
    'progress.slide.streak.tipActive':
      'Log a workout today to push your streak to {next} days. Skipping resets it to 0.',
    'progress.slide.streak.tipNone':
      'A single set counts. Log a workout today and the streak starts at 1.',

    'progress.slide.workouts.kicker': 'Workouts',
    'progress.slide.workouts.tipNone':
      'Your first workout unlocks history, trends, and your first PR.',
    'progress.slide.workouts.tipSome_one':
      '{n} workout logged. Three a week beats five-then-zero every time.',
    'progress.slide.workouts.tipSome_other':
      '{n} workouts logged. Three a week beats five-then-zero every time.',

    'progress.slide.volume.kicker':   'Volume',
    'progress.slide.volume.tipCompare':
      'This week: {thisWeek} {unit}. Last week: {lastWeek}. A 10% bump = new gains.',
    'progress.slide.volume.tipNone':
      'Total weight × reps lifted. Track it weekly — small bumps compound into PRs.',

    'progress.slide.level.kicker':    'Level',
    'progress.slide.level.tip':
      'Every workout earns XP. Hit personal bests for bonus XP and watch the bar fill.',

    // ── Last-workout callout ─────────────────────────────────────────────
    'progress.lastWorkout.label':     'Last workout',
    'progress.lastWorkout.freestyle': 'Freestyle Session',
    'progress.lastWorkout.daysAgo':   '{n} days ago',
    'progress.lastWorkout.exercises_one':   '{n} exercise',
    'progress.lastWorkout.exercises_other': '{n} exercises',

    // ── Recent list ──────────────────────────────────────────────────────
    // One section replacing the last-workout card and the Top PRs rail.
    // Both are read-only, so they are rows on hairlines rather than
    // surfaces — see the ledger on the "Progress — proposed layout" page.
    'progress.recent.title':          'RECENT',
    'progress.recent.personalBest':   'personal best',

    // ── Top PRs rail ─────────────────────────────────────────────────────
    'progress.topPRs.title':          'Top PRs',
    'progress.topPRs.repsBest_one':   '{n} rep best',
    'progress.topPRs.repsBest_other': '{n} reps best',

    // ── Personal Bests sheet ─────────────────────────────────────────────
    'progress.pb.history':            'History',
    'progress.pb.reps_one':           '{n} rep',
    'progress.pb.reps_other':         '{n} reps',
    'progress.pb.logged_one':         'Logged {n} time',
    'progress.pb.logged_other':       'Logged {n} times',

    // ── Analytics charts ─────────────────────────────────────────────────
    'progress.analytics.trained':     'Trained ✓',
    'progress.analytics.restDay':     'Rest day',

    // ── Weekly Review summary ────────────────────────────────────────────
    'progress.review.title':          'Weekly Review',
    'progress.review.refresh':        'Refresh summary',
    'progress.review.volume':         'Volume',
    'progress.review.sessions':       'Sessions',
    'progress.review.streak':         'Streak',
    'progress.review.pr':             'PR',
  },
};

export default progressTranslations;
