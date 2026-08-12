// The food database — Search, the barcode result sheet, and the sheet a
// barcode miss opens.
//
// TODO(i18n): English only. Per CLAUDE.md we don't ship machine-translated
// copy, and most of what is below is prose. Every call site uses
// `tFallback(key, 'English')`, so an untranslated language renders correct
// English rather than a key code. Both prefixes are listed in
// `AWAITING_TRANSLATION` in src/lib/__tests__/i18nCoverage.test.js.
//
// ── WHY THIS FILE EXISTS AT ALL ───────────────────────────────────────────
//
// Two separate reasons, and they are worth telling apart.
//
// **`nutrition.search.*` was already being CALLED and had no dictionary.**
// `FoodSearchSheet` and `LogMealForm` shipped on 2026-08-11 with ten
// `tFallback('nutrition.search.…', 'English')` calls and no part file behind
// any of them, so the keys existed only inside the JSX. Nothing was broken on
// screen — that is the point of `tFallback` — but no translator could find
// them and no coverage check could see them. CLAUDE.md is explicit: a new key
// goes into a part file with English at minimum. These strings are unchanged;
// this file just gives them somewhere to be translated.
//
// **`nutrition.foodDb.*` is new copy, and some of it corrects a claim.** The
// sheet a barcode miss opens told the user "we'll save it for everyone" over
// a button reading "Save for Everyone". It has not done that since migration
// 343: it files a row in `food_item_requests` for a human to review, and an
// admin approval is what creates the shared record. The copy below says what
// the code does. See docs/nutrition-food-database-audit.md.
//
// ── A NOTE FOR WHOEVER TRANSLATES THESE ───────────────────────────────────
//
// Three of these carry weight beyond their length:
//
//   • `foodDb.request.intro` and `.submit` must not promise publication.
//     "Send for review" is a request; "Save for everyone" was a promise the
//     app cannot keep, and it is what this copy replaces. Keep the two
//     halves — sent for review, AND logged for you now — because the second
//     is what stops the first reading as a refusal.
//   • `foodDb.request.blankIsUnknown` is a statement about how the record is
//     stored, not a nicety. A blank field is kept as unknown; it is not a
//     zero. Do not soften it into "optional" — that is the next line's job.
//   • `foodDb.result.caloriesOnly` is shown INSTEAD of a grid of zeros when a
//     submitted label carried nothing but calories. It is a statement about
//     the record, never about the user, and it must not imply they should
//     have entered more.
//
// The sixteen nutrient LABELS are deliberately absent from this file. They
// already exist as `nutrition.macros.*`, `nutrition.minerals.*` and
// `nutrition.vitamins.*` and are called with `t()`, so both sheets inherit
// whatever coverage those keys have rather than forking a second English
// copy of the word "Calcium".

export const foodDbTranslations = {
  en: {
    // ── Search ────────────────────────────────────────────────────────────
    'nutrition.search.title': 'Search',
    'nutrition.search.placeholder': 'Search your foods',
    'nutrition.search.clear': 'Clear search',
    'nutrition.search.results': 'Results',
    'nutrition.search.recent': 'Your foods',
    'nutrition.search.emptyTitle': 'No foods yet',
    'nutrition.search.noneTitle': 'Nothing matches that yet',
    'nutrition.search.noneBody':
      'This searches foods you have scanned, recipes you have saved and meals you have logged. Scan a barcode or log a meal and it will show up here.',
    'nutrition.search.filled': 'Filled in — check the amount, then log it.',
    'nutrition.search.buttonHint': 'your foods & recipes',

    // ── The barcode result sheet ───────────────────────────────────────────
    'nutrition.foodDb.result.tabNutrients': 'Nutrients',
    'nutrition.foodDb.result.tabVitamins': 'Vitamins & minerals',
    'nutrition.foodDb.result.sourceCommunity': 'Community submitted',
    'nutrition.foodDb.result.caloriesOnly':
      'This record only carries calories. Whoever added it left the rest of the label blank.',

    // ── The sheet a barcode miss opens ─────────────────────────────────────
    'nutrition.foodDb.request.title': 'Not in the catalogue yet',
    'nutrition.foodDb.request.barcode': 'Barcode',
    'nutrition.foodDb.request.intro':
      'No database we check knows this barcode. Enter what the label says and we will send it for review — you can log it for yourself right away.',
    'nutrition.foodDb.request.name': 'Food name',
    'nutrition.foodDb.request.namePlaceholder': 'e.g. Organic Almond Butter',
    'nutrition.foodDb.request.serving': 'Serving size',
    'nutrition.foodDb.request.servingPlaceholder': 'e.g. 2 tbsp (32g)',
    'nutrition.foodDb.request.tabNutrients': 'Nutrient values',
    'nutrition.foodDb.request.tabVitamins': 'Vitamins & minerals',
    'nutrition.foodDb.request.blankIsUnknown':
      'Leave a field blank if the label does not list it. A blank is kept as unknown, not as zero.',
    'nutrition.foodDb.request.vitaminsOptional': 'All of these are optional.',
    'nutrition.foodDb.request.addVitamins': 'Add vitamins & minerals (optional)',
    'nutrition.foodDb.request.submit': 'Send for review',
    'nutrition.foodDb.request.submitting': 'Sending…',
    'nutrition.foodDb.request.needName': 'Enter the food name.',
    'nutrition.foodDb.request.badName': 'Please use an appropriate food name.',
    'nutrition.foodDb.request.needCalories': 'Calories are required.',
    'nutrition.foodDb.request.failed': 'Could not send the request. Please try again.',
    'nutrition.foodDb.request.sent':
      'Sent for review. Logged for you now, and everyone gets it once it’s approved.',
    'nutrition.foodDb.request.alreadyQueued':
      'Someone already asked for this one — it’s in the queue. Logged for you now.',
  },
};

export default foodDbTranslations;
