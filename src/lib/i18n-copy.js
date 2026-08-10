// Tap-to-copy i18n — src/components/TapToCopy.jsx, the shared affordance
// that puts a stat on the clipboard. Six call sites: the leaderboard rank
// pill, both streak banners, two profile lift stats, and the PR History
// modal's all-time figure.
//
// TODO(i18n): English only. Per CLAUDE.md we don't ship machine-translated
// copy. Every call site uses tFallback('key', 'English'), so an untranslated
// language renders correct English rather than a key code.
//
// The component built both of its strings by interpolating an English noun
// into an English frame — `Copied ${label}` and `Copy ${label}` — with the
// noun hardcoded at each call site ('rank', 'streak', 'tonnage', 'PR'). So
// six screens' worth of feedback and six aria-labels were English in all 15
// languages, on a component whose whole job is a one-tap flex.
//
// ── The frames are a slot in a sentence, and that is the hard part ─────
//
// `copy.toast` and `copy.action` interpolate a noun. English does not care;
// most of the other 14 do:
//
//   • Spanish/Portuguese/Italian/French — the participle agrees with the
//     noun's gender ("copiado" vs "copiada"), which a single frame cannot
//     know.
//   • Russian/Polish — the noun needs a case ending the citation form does
//     not have.
//   • Turkish — the suffix harmonises with the noun's last vowel.
//   • Arabic — definiteness and agreement both move.
//
// **You are expected to rewrite the frame, not just translate it.** The
// standard escape is a colon, which keeps the noun in citation form and is
// correct everywhere: "Copiado: {label}", «Скопировано: {label}»,
// "Kopyalandı: {label}". Reach for that rather than contorting an
// agreement you cannot see. Dropping the placeholder entirely is also fine
// for `copy.toast` if your language would rather just say "Copied" — the
// toast fires under the user's own thumb, so the noun is confirmation
// rather than information.
//
// `copy.action` is the aria-label and NEEDS its noun: a screen-reader user
// arrives at the control out of context, and three of these sit on one
// profile card. Keep it distinguishable even if the toast loses its noun.
//
// ── The nouns ──────────────────────────────────────────────────────────
//
// One vocabulary, so the same concept is not translated twice. These are
// the objects of "Copy —", so give them whatever form your frame wants;
// if you chose the colon frame, citation form is right.
//
// `copy.noun.value` is the component's default, used when a call site
// passes no label at all. It is deliberately vague — it means "the thing
// you just tapped" — and should stay a generic word rather than becoming
// "number" or "stat", because nothing guarantees the payload is either.

export const copyTranslations = {
  en: {
    'copy.toast':        'Copied {label}',
    'copy.action':       'Copy {label}',

    'copy.noun.value':   'value',
    'copy.noun.rank':    'rank',
    'copy.noun.streak':  'streak',
    'copy.noun.tonnage': 'tonnage',
    // Short for "personal record" and left as an abbreviation on purpose —
    // it is what the app calls this everywhere else, and it sits in a
    // 1200ms toast. If your language has no equivalent initialism, a short
    // word beats an expansion nobody has time to read.
    'copy.noun.pr':      'PR',
  },
};

export default copyTranslations;
