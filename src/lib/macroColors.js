// src/lib/macroColors.js
//
// One colour per macro, everywhere.
//
// Three surfaces had three different answers for the same three macros:
//   MealHistoryModal     P = info        C = primary  F = destructive
//   PhotoMealResultModal P = destructive C = info     F = primary
//   NutritionTrendsChart P = #ef4444     C = #3b82f6  F = #eab308  (raw hex,
//                                                      answering to no theme)
// A user could see protein painted three ways in three taps.
//
// None of those three is the answer. Macros need mutual DISTINGUISHABILITY,
// not state meaning, and CLAUDE.md carves them out of the four-hue rule for
// exactly that reason: routing them through the state hues renders a healthy
// fat figure in `destructive`, which is the app calling a macro a failure.
// The categorical ramp in index.css is the documented home — three hues that
// passed an all-pairs ΔE gate under deuteranopia in both themes.

// `field` is the RESULT-shaped key (what mealEntryToResult emits and what
// PhotoMealResultModal indexes its edit state by). `read` is the ordered list
// of keys to try when pulling a value off a raw nutrition_logs ROW, and the two
// are not the same thing: migration 006 declared the `_g` / `_mg` aliases and
// has never been applied, so the table's real columns are `protein` / `carbs` /
// `fat` / `fiber` / `sodium` and there is no `sugar` column at all. Reading
// `entry.protein_g` off a row returns undefined for every row in production.
// Use macroValue(), never entry[m.field].
export const MACROS = {
  protein: {
    key: 'protein', short: 'P', label: 'Protein', field: 'protein_g', read: ['protein_g', 'protein'],
    tint: 'bg-chart-1/20', chip: 'bg-chart-1/20 text-foreground', css: 'hsl(var(--chart-1))',
  },
  carbs: {
    key: 'carbs', short: 'C', label: 'Carbs', field: 'carbs_g', read: ['carbs_g', 'carbs'],
    tint: 'bg-chart-2/20', chip: 'bg-chart-2/20 text-foreground', css: 'hsl(var(--chart-2))',
  },
  fat: {
    key: 'fat', short: 'F', label: 'Fat', field: 'fat_g', read: ['fat_g', 'fat'],
    tint: 'bg-chart-3/20', chip: 'bg-chart-3/20 text-foreground', css: 'hsl(var(--chart-3))',
  },
};

export const MACRO_ORDER = [MACROS.protein, MACROS.carbs, MACROS.fat];

/** Read one macro off a raw nutrition_logs row, alias first, real column second. */
export function macroValue(entry, macro) {
  for (const key of macro.read) {
    const raw = entry?.[key];
    if (raw == null) continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

// The second nutrient slide. Sugar and sodium both used to be `primary`, so the
// row read as two of one thing and one of another. These never appear beside
// the macros — they are the other half of a pager — so they take the same three
// slots positionally rather than asking for a fourth hue that does not exist.
export const MICROS = {
  fiber:  { key: 'fiber',  label: 'Fiber',  unit: 'g',  field: 'fiber_g',   tint: 'bg-chart-1/20' },
  sugar:  { key: 'sugar',  label: 'Sugar',  unit: 'g',  field: 'sugar_g',   tint: 'bg-chart-2/20' },
  sodium: { key: 'sodium', label: 'Sodium', unit: 'mg', field: 'sodium_mg', tint: 'bg-chart-3/20' },
};

export const MICRO_ORDER = [MICROS.fiber, MICROS.sugar, MICROS.sodium];
