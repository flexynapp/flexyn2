// Nutrition — the two "there is nothing here" lines, for the Nutrition
// page's Macros and Vitamins & Minerals cards.
//
// TODO(i18n): English only. Per CLAUDE.md we don't ship machine-translated
// copy. Both call sites use tFallback('key', 'English'), so an untranslated
// language renders correct English rather than a key code.
//
// ── WHY THESE STRINGS EXIST AT ALL ────────────────────────────────────────
//
// Both cards used to render their tiles unconditionally, so a nutrient with
// nothing behind it drew "0.0g · 0%" over a zero-width bar. For the eight
// vitamins and minerals — plus sugar and cholesterol on the macro card —
// that zero was not "nothing logged today", it was permanent: those ten
// columns do not exist on `nutrition_logs` (migration 006 declares them and
// has never been applied), so `db.js` strips them from every insert and no
// code path could ever have produced a non-zero figure. CLAUDE.md: a section
// with no data must not render as zeros, because a 0 reads as a failure the
// user did not commit.
//
// ── A NOTE FOR WHOEVER TRANSLATES THESE ───────────────────────────────────
//
// The two lines are deliberately different claims and should stay different:
//
//   • `macros` is TEMPORARY and the user can act on it — they have not eaten
//     yet, or have not logged it. It should read as an invitation, not a
//     fault. Keep the second clause ("log a meal to…") actionable.
//   • `micros` is a STATEMENT ABOUT THE APP — it is not recording these, and
//     nothing the user does today changes that. It must not imply they
//     forgot to do something, and it must not promise the feature is coming.
//     "aren't being recorded yet" is doing careful work: passive, about the
//     app, no blame, no roadmap.
//
// If migration 006 is applied and the Log Meal form's micronutrient inputs
// start persisting, the `micros` line stops rendering on its own and the
// tiles return with no code change. See docs/nutrition-meal-logging-audit.md.

export const nutritionUntrackedTranslations = {
  en: {
    'nutrition.untracked.macros': 'Nothing logged yet today — log a meal to see your macros.',
    'nutrition.untracked.micros': "Vitamins and minerals aren't being recorded yet, so there's nothing to show here.",
  },
};

export default nutritionUntrackedTranslations;
