// src/lib/waterEntries.js
//
// One definition of "is this NutritionLog row a glass of water, not a meal".
//
// It used to live twice, and the two copies disagreed. Nutrition.jsx counted a
// bare `"Water"` row as an 8 oz glass; MealHistoryModal required `water_oz > 0`
// before it would filter the same row out of the meal list. Rows written before
// migration 006 carry `water_oz: null`, so every one of them slipped through the
// history filter and rendered as a "Water — 0 cal" meal, which also made its day
// count as a logged zero-calorie day in the "Avg cal/day" stat.
//
// Encoding: the oz value lives in `food_name` so it survives even where the
// `water_oz` column does not exist.
//   "Water"   → 8 oz (legacy / standard glass)
//   "Water|N" → N oz

const PREFIX = 'Water|';

export function isWaterEntry(entry) {
  const name = entry?.food_name;
  if (typeof name !== 'string') return false;
  return name === 'Water' || name.startsWith(PREFIX);
}

/**
 * Ounces for a water row. Non-water rows are 0.
 *
 * A stored `water_oz` wins when it is present and numeric — matching the
 * original `??` semantics, so a legitimately stored 0 still reads as 0 rather
 * than silently becoming 8. Only null/undefined falls through to the name.
 */
export function waterEntryOz(entry) {
  if (!isWaterEntry(entry)) return 0;
  const stored = entry.water_oz;
  if (stored != null && Number.isFinite(Number(stored))) return Number(stored);
  const name = entry.food_name;
  if (name.startsWith(PREFIX)) {
    const oz = Number(name.slice(PREFIX.length));
    return Number.isFinite(oz) ? oz : 8;
  }
  return 8;
}

export function waterFoodName(oz) {
  return oz === 8 ? 'Water' : `${PREFIX}${oz}`;
}

/** Partition a day's rows into the meals you ate and the water you drank. */
export function splitWaterEntries(entries = []) {
  const meals = [];
  const water = [];
  for (const entry of entries) {
    if (isWaterEntry(entry)) water.push(entry);
    else meals.push(entry);
  }
  return { meals, water };
}

export function sumWaterOz(entries = []) {
  let total = 0;
  for (const entry of entries) total += waterEntryOz(entry);
  return total;
}
