// src/lib/recipeFormat.js
//
// Presentation helpers shared by the Recipes surfaces (hub list, detail
// sheet, log sheet). Pure and dependency-free so every screen shows the same
// number for the same recipe.
//
// EVERYTHING HERE IS PER SERVING unless the name says otherwise. That is the
// one rule the old hub row got ambiguous — it printed "412 cal/serving · 38P ·
// 41C · 9F", where the qualifier reads as if it applies to the calories alone
// even though the macros were already divided too.

import { perServing, servingsOf } from '@/lib/data/nutritionRecipes';

/** Rounded per-serving calories. */
export function perServingCals(recipe) {
  return Math.round((Number(recipe?.totals?.calories) || 0) / servingsOf(recipe));
}

/** Per-serving protein / carbs / fat, rounded, as numbers. */
export function perServingMacros(recipe) {
  const per = perServing(recipe?.totals || {}, servingsOf(recipe));
  return {
    p: Math.round(Number(per.protein_g) || 0),
    c: Math.round(Number(per.carbs_g)   || 0),
    f: Math.round(Number(per.fat_g)     || 0),
  };
}

/** "38P · 41C · 9F" — the macro line under a recipe name. */
export function macroLine(recipe) {
  const { p, c, f } = perServingMacros(recipe);
  return `${p}P · ${c}C · ${f}F`;
}

/** "412 cal · 38P · 41C · 9F" — the full per-serving line. */
export function nutritionLine(recipe) {
  return `${perServingCals(recipe)} cal · ${macroLine(recipe)}`;
}

/** "4 servings" / "1 serving". */
export function servingsLabel(recipe) {
  const s = servingsOf(recipe);
  return `${s} ${s === 1 ? 'serving' : 'servings'}`;
}

// Amounts are entered for the whole recipe, so the detail sheet has to scale
// them to the serving it is showing. Trailing zeros are dropped — "0.8 g" and
// "80 g" are both fine to read, "80.00 g" is not.
function trim(n) {
  // Two decimals is enough for a scaled amount, and String() already drops a
  // trailing zero (0.80 → "0.8"), so no branch is needed here. There used to
  // be a ternary whose arms were identical — it did nothing.
  return String(Math.round(n * 100) / 100);
}

/**
 * Ingredient rows scaled from the whole recipe down to `servings` of it.
 * Returns [{ name, amount }] where `amount` is already a display string.
 */
export function scaledIngredients(recipe, servings = 1) {
  const rows = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  const factor = (Number(servings) > 0 ? Number(servings) : 1) / servingsOf(recipe);
  return rows.map((ing) => {
    const raw = Number(ing?.amount ?? ing?.grams) || 0;
    const unit = ing?.unit || 'g';
    return {
      name:   ing?.name || 'Ingredient',
      amount: raw > 0 ? `${trim(raw * factor)} ${unit}` : '—',
    };
  });
}

/**
 * What a meal-planner slot stores ALONGSIDE the recipe id, so the plan
 * survives the recipe being deleted.
 *
 * `meal_plans.recipe_id` has no foreign key on purpose (mig 123) — deleting a
 * recipe must not delete someone's plan. But the id was all the row carried,
 * so a plan that outlived its recipe rendered as a bare "—". This is the same
 * per-serving shape the manual and photo paths already write, which is why the
 * planner's existing `recipe?.name || plan.food_snapshot?.name` fallback picks
 * it up with no render change.
 */
export function plannerSnapshot(recipe) {
  const per = perServing(recipe?.totals || {}, servingsOf(recipe));
  const r1 = (v) => Math.round((Number(v) || 0) * 10) / 10;
  return {
    name:      recipe?.name || 'Recipe',
    calories:  Math.round(Number(per.calories) || 0),
    protein_g: r1(per.protein_g),
    carbs_g:   r1(per.carbs_g),
    fat_g:     r1(per.fat_g),
    fiber_g:   r1(per.fiber_g),
  };
}

/**
 * Recipe-level nutrients as display chips, scaled to one serving.
 *
 * A blank amount is UNFILLED, not zero — `Number('')` is 0 and finite, which
 * would render a confident "Zinc 0 mg" for a field nobody ever typed in.
 * `normalizeMicros` makes the same distinction on the way into the database;
 * this is the same rule on the way back out, for rows that predate it.
 */
export function microChips(recipe) {
  const micros = Array.isArray(recipe?.micros) ? recipe.micros : [];
  const s = servingsOf(recipe);
  return micros
    .filter((m) => {
      if (!m?.label) return false;
      if (m.amount === '' || m.amount == null) return false;
      return Number.isFinite(Number(m.amount));
    })
    .map((m) => `${m.label} ${trim(Number(m.amount) / s)}${m.unit ? ` ${m.unit}` : ''}`);
}
