// Body heat-map i18n — src/components/progress/MuscleGroupHeatmap.jsx, the
// whole of Progress → Body: the headline, the recovery/volume toggle, the
// 7/30/90-day windows, the two silhouettes and their legend, the ranked
// muscle list, and the per-muscle detail sheet.
//
// TODO(i18n): English only. Per CLAUDE.md we don't ship machine-translated
// copy. Every call site uses tFallback('key', 'English'), so an untranslated
// language renders correct English rather than a key code.
//
// The component had ZERO translation calls before this — every user-visible
// string was a hardcoded English literal on an app that ships 15 languages.
// These keys are what it should have shipped with.
//
// It lives in its own file rather than in `i18n-progress.js` for the reason
// `i18n-insights.js` does: that file's header scopes it to the Progress
// PAGE — the hero carousel, the timeframe card, the tab bar — and each tab
// underneath owns its own namespace. Two of the three tabs already worked
// that way.
//
// ── What is deliberately NOT here ──────────────────────────────────────
//
// **Thirteen of the fourteen muscle names.** `muscleGroups.*` already ships
// chest, shoulders, triceps, biceps, forearms, traps, lats, abs, obliques,
// glutes, quads, hamstrings and calves in all 15 languages, and eight other
// surfaces read them there. Restating them here would be a second answer to
// one question — and a worse one, since this file is English-only and that
// namespace is translated. The component maps fine-muscle id → key in
// `MUSCLE_KEY`, so only the gap lands here:
//
//   • `bodyMap.muscle.lowerBack` — the one fine muscle with no
//     `muscleGroups.*` key. Add `muscleGroups.lowerBack` to i18n-part6.js
//     when someone translates it and delete this one; the call site is a
//     single line in `MUSCLE_KEY`.
//
// **All four regions, too.** `Legs` and `Core` resolve to
// `muscleGroups.legs` / `muscleGroups.core`. Push and Pull — movement
// patterns rather than muscle groups, so absent from that namespace — come
// from **`regions.push` / `regions.pull`** in `i18n-regions.js`, which
// named them for the muscle-group colour encoding. Both files are
// English-only awaiting the same native pass, so sharing means one
// translation lands on both surfaces instead of one of them.
//
// `regions.other` is deliberately NOT used here. It reads "Core & other"
// because in that encoding it is the remainder bucket — core plus
// whole-body plus cardio. This tab's fourth region is Core exactly, so it
// keeps `muscleGroups.core`. Same word in English, different claim.
//
// ── Conventions to match if you add keys ───────────────────────────────
//
//   • **Counts get a `.one` / `.other` pair**, never a bare `{n} muscles`.
//     The headline is the one string on this screen that carries a number,
//     and it used to build its own plural by appending 's' to the English
//     word — which no other language does the same way, and several don't
//     do at all.
//
//   • **The headline keys carry a literal `\n`** at the line break the
//     design draws, and the `<h1>` renders with `white-space: pre-line`.
//     That break used to be a hardcoded `<br />` in the JSX, which is a
//     line-length decision made once, in English, for every language.
//     Translators: move the `\n` to wherever your text wants to break, or
//     drop it entirely and let the heading wrap on its own. Both are fine —
//     the heading has no fixed height.
//
//   • **The SHOUTING is in the string, not in CSS.** The mono labels here
//     (`FRONT`, `RECOV`, `MORE VOLUME`, the range chips, `CLOSE`) are
//     uppercase because that is how the design draws them and there is no
//     `text-transform` under them. Supply whatever case your language
//     actually wants — several of the 15 have no case at all, and Turkish
//     has a dotted/dotless İ/I split that a blind CSS uppercase gets
//     wrong. The one exception is anything passed to `<Kicker>`
//     (`bodyMap.kicker`, `bodyMap.list.*`, `bodyMap.detail.topExercises`),
//     which DOES uppercase in CSS — those are stored in natural case.
//
//   • **Anything with a `{placeholder}` must be tested with a stub that
//     ignores the fallback**, per the i18n section of CLAUDE.md. The
//     standard `(key, english) => english` test stub returns the already-
//     interpolated English and passes even when the vars are dropped.
//
// ── Notes for whoever translates this ──────────────────────────────────
//
//   • `bodyMap.data.live` / `.noData` are a status readout on a data feed,
//     not a broadcast. "LIVE" means "this is reading your real logs right
//     now"; "NO DATA" means nothing has been logged in the window yet. The
//     ● / ○ glyph in front of each is drawn in the JSX, so it is not yours
//     to place.
//
//   • `bodyMap.range.*` name a ROLLING window — seven days back from right
//     now, not a calendar week. `bodyMap.rangeShort.*` are the same three
//     windows abbreviated for a mono caption roughly 30px wide; if your
//     language has no natural short form, prefer a short word to a cramped
//     one.
//
//   • `bodyMap.detail.recov` sits inside a 76px progress ring at 7.5px, and
//     is an abbreviation of "recovery" for that reason. It has about six
//     characters of room.
//
//   • `bodyMap.status.*` are the three bands of the same recovery number
//     the ring shows: ≥75% ready, ≥50% mid-recovery, below that needs rest.
//     They read as advice, so keep them short and imperative rather than
//     clinical.
//
//   • `bodyMap.legend.less` / `.more` label the two ends of the volume
//     ramp — least work done → most work done. `.fresh` / `.fatigued` are
//     the recovery ramp's ends. Each pair sits at opposite ends of one
//     8px bar, so they are read against each other.

export const bodyMapTranslations = {
  en: {
    // ── Header ──────────────────────────────────────────────────────────
    'bodyMap.kicker':                  'Progress · Muscle map',
    'bodyMap.data.live':               'LIVE',
    'bodyMap.data.noData':             'NO DATA',

    // ── Headline · one per state, `\n` at the designed break ────────────
    'bodyMap.headline.empty':          'Your muscle\nheat map.',
    'bodyMap.headline.volume':         'Where your\nwork landed.',
    'bodyMap.headline.recovery.one':   '{n} muscle\nneeds recovery.',
    'bodyMap.headline.recovery.other': '{n} muscles\nneed recovery.',

    // ── Body copy, matched to the headline above ────────────────────────
    'bodyMap.body.empty':
      'Log a workout and the muscles you trained light up here — colour shows fatigue so you know what’s ready to hit again.',
    'bodyMap.body.recovery':
      'Colour shows fatigue right now — fresh green muscles are ready, hot ones still need rest before you hit them again.',
    'bodyMap.body.volume':
      'Colour shows training volume over the selected window — brighter means more work landed there.',

    // ── Controls ────────────────────────────────────────────────────────
    'bodyMap.mode.recovery':           'Recovery',
    'bodyMap.mode.volume':             'Volume',
    'bodyMap.range.7d':                '7 DAYS',
    'bodyMap.range.30d':               '30 DAYS',
    'bodyMap.range.90d':               '90 DAYS',
    'bodyMap.rangeShort.7d':           '7D',
    'bodyMap.rangeShort.30d':          '30D',
    'bodyMap.rangeShort.90d':          '90D',

    // ── The two silhouettes and the ramp beneath them ───────────────────
    'bodyMap.figure.front':            'FRONT',
    'bodyMap.figure.back':             'BACK',
    'bodyMap.legend.fresh':            'FRESH',
    'bodyMap.legend.fatigued':         'FATIGUED',
    'bodyMap.legend.less':             'LESS',
    'bodyMap.legend.more':             'MORE VOLUME',

    // ── Ranked list ─────────────────────────────────────────────────────
    'bodyMap.list.recovery':           'Recovery by muscle',
    'bodyMap.list.volume':             'Volume by muscle',

    // ── Detail sheet ────────────────────────────────────────────────────
    'bodyMap.detail.recov':            'RECOV',
    'bodyMap.detail.sets':             'SETS',
    'bodyMap.detail.volume':           'VOLUME',
    'bodyMap.detail.last':             'LAST',
    // Two forms of the same fact: the kicker prints it whole ("3d ago"),
    // the LAST tile prints the number big and this as its unit.
    'bodyMap.detail.daysAgo':          '{n}d ago',
    'bodyMap.detail.daysAgoUnit':      'd ago',
    'bodyMap.detail.untrained':        'untrained',
    'bodyMap.detail.topExercises':     'Top exercises',
    'bodyMap.detail.close':            'CLOSE',
    // Shown in place of an exercise's name when the log has none — a data
    // defect rather than a real title, so it names the category.
    'bodyMap.detail.unnamedExercise':  'Exercise',

    // ── Recovery bands, on the detail sheet's status pill ───────────────
    'bodyMap.status.ready':            'Ready to train',
    'bodyMap.status.recovering':       'Recovering',
    'bodyMap.status.needsRest':        'Needs rest',

    // ── The one word no shared namespace carries ────────────────────────
    // See the header: every other muscle and region resolves elsewhere.
    'bodyMap.muscle.lowerBack':        'Lower Back',

    // ── Screen-reader only ──────────────────────────────────────────────
    // The two silhouettes are the whole feature and a screen reader could
    // not reach them: fourteen `<g onClick>` groups, no role, no label, no
    // tab stop. These are what VoiceOver now announces. They are NOT
    // visible anywhere, so they carry the state the colour was carrying —
    // a fill is not information you can hear.
    //
    // The muscle label leads with the name because that is what someone
    // swiping the figure is looking for; the number qualifies it. Both
    // modes get their own string rather than one with a swapped suffix,
    // since word order between a percentage and a weight is not the same
    // in every language.
    'bodyMap.a11y.figureFront':        'Front view, {n} muscles',
    'bodyMap.a11y.figureBack':         'Back view, {n} muscles',
    'bodyMap.a11y.muscleRecovery':     '{muscle}, {pct}% recovered',
    'bodyMap.a11y.muscleVolume':       '{muscle}, {vol} {unit}',
    // Appended to a muscle's label so the gesture is discoverable — a
    // button that says only "Chest, 40% recovered" does not tell you it
    // opens anything.
    'bodyMap.a11y.opensDetail':        'shows details',
    'bodyMap.a11y.closeDetail':        'Close muscle details',
    // The detail sheet's recovery ring. Its number is real text inside the
    // ring, so the cluster is named rather than hidden — read raw it says
    // "100 RECOV", which is a caption, not a sentence.
    'bodyMap.a11y.recoveredPct':       '{pct}% recovered',
  },
};

export default bodyMapTranslations;
