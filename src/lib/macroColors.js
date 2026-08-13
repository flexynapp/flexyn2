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

export const MACROS = {
  protein: {
    key: 'protein', short: 'P', label: 'Protein', field: 'protein_g',
    text: 'text-chart-1', chip: 'bg-chart-1/15 text-chart-1', css: 'hsl(var(--chart-1))',
  },
  carbs: {
    key: 'carbs', short: 'C', label: 'Carbs', field: 'carbs_g',
    text: 'text-chart-2', chip: 'bg-chart-2/15 text-chart-2', css: 'hsl(var(--chart-2))',
  },
  fat: {
    key: 'fat', short: 'F', label: 'Fat', field: 'fat_g',
    text: 'text-chart-3', chip: 'bg-chart-3/15 text-chart-3', css: 'hsl(var(--chart-3))',
  },
};

export const MACRO_ORDER = [MACROS.protein, MACROS.carbs, MACROS.fat];

// The second nutrient slide. Sugar and sodium both used to be `primary`, so the
// row read as two of one thing and one of another. These never appear beside
// the macros — they are the other half of a pager — so they take the same three
// slots positionally rather than asking for a fourth hue that does not exist.
export const MICROS = {
  fiber:  { key: 'fiber',  label: 'Fiber',  unit: 'g',  field: 'fiber_g',   text: 'text-chart-1' },
  sugar:  { key: 'sugar',  label: 'Sugar',  unit: 'g',  field: 'sugar_g',   text: 'text-chart-2' },
  sodium: { key: 'sodium', label: 'Sodium', unit: 'mg', field: 'sodium_mg', text: 'text-chart-3' },
};

export const MICRO_ORDER = [MICROS.fiber, MICROS.sugar, MICROS.sodium];
