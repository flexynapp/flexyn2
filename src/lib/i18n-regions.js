// Muscle-region names — the four buckets the colour encoding can carry.
//
// TODO(i18n): English only. Per CLAUDE.md we don't ship machine-translated
// copy; every call site uses tFallback('regions.x', 'English') so an
// untranslated language renders correct English rather than a key code.
//
// Notes for whoever translates this:
//
//   • These are the PUSH / PULL / LEGS split, which most training
//     traditions already have a word for. Prefer the term lifters in your
//     language actually use over a literal translation of the English —
//     these are gym vocabulary, not anatomy.
//
//   • regions.other is Core PLUS whole-body and cardio work. It is
//     deliberately not "Other": someone reading "Other" beside three named
//     regions would reasonably wonder what was being hidden, and the honest
//     answer is "core, and the things that aren't a push/pull/legs axis".
//     Keep it concrete. It is also the only bucket rendered in a neutral
//     grey rather than a hue — see src/lib/muscleRegions.js for why the
//     palette stops at three.
//
//   • Short labels, on chips under a 120px chart. If your language has no
//     compact form, prefer a shorter true word to a cramped exact one.

export const regionTranslations = {
  en: {
    'regions.push':  'Push',
    'regions.pull':  'Pull',
    'regions.legs':  'Legs',
    'regions.other': 'Core & other',
  },
};

export default regionTranslations;
