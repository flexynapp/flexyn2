// src/lib/data/mealPlans.js
//
// Planned future meals (mig 123). Used by the meal-planner UI to let
// the user pre-schedule tomorrow's meals + by the grocery-list
// generator which walks 7 days of plans and sums ingredients.

import { supabase } from '@/api/supabaseClient';

/** Plans in a date range (inclusive). */
export async function listInRange(userId, startDate, endDate) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('meal_plans')
    .select('*')
    .eq('user_id', userId)
    .gte('plan_date', startDate)
    .lte('plan_date', endDate)
    .order('plan_date', { ascending: true });
  if (error) return [];
  return data ?? [];
}

/**
 * The id of the plan already occupying a (user, date, meal) slot, or null.
 *
 * Newest-first because production contains slots that were filled more than
 * once before `upsert` resolved the id (see below) — when there are several,
 * the most recent is the one the grid was showing.
 */
export async function findSlot(userId, planDate, mealType) {
  if (!userId || !planDate) return null;
  const { data, error } = await supabase
    .from('meal_plans')
    .select('id')
    .eq('user_id', userId)
    .eq('plan_date', planDate)
    .eq('meal_type', mealType || 'snack')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return null;
  return data?.[0]?.id ?? null;
}

/**
 * A slot holds ONE plan. `onConflict: 'id'` cannot enforce that on its own:
 * a caller that doesn't already know the row id sends no `id` at all, Postgres
 * generates a fresh one, nothing conflicts, and the "upsert" INSERTs. Every
 * re-fill of an occupied slot therefore appended a row, and the grid keys
 * cells by `${plan_date}-${meal_type}` so only the last one won — the rest
 * became invisible rows that still counted toward the grocery-list CTA.
 * Measured on production 2026-08-11: 8 rows across 2 slots, 6 unreachable.
 *
 * Resolving the id first makes the update path work whether or not the
 * uniqueness migration has been applied, which matters because the frontend
 * auto-deploys and the SQL is pasted by hand.
 */
export async function upsert({ id, user, planDate, mealType, recipeId, foodSnapshot, notes }) {
  if (!user?.id || !planDate) throw new Error('user + planDate required');
  const slotType = mealType || 'snack';
  const rowId = id || await findSlot(user.id, planDate, slotType);
  const row = {
    user_id:       user.id,
    user_email:    user.email,
    plan_date:     planDate,
    meal_type:     slotType,
    recipe_id:     recipeId    || null,
    food_snapshot: foodSnapshot || null,
    notes:         notes || null,
  };
  if (rowId) row.id = rowId;
  const { data, error } = await supabase
    .from('meal_plans')
    .upsert(row, { onConflict: 'id' })
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function remove(id) {
  if (!id) throw new Error('id required');
  const { error } = await supabase
    .from('meal_plans')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function markCompleted(id, isCompleted) {
  if (!id) throw new Error('id required');
  const { error } = await supabase
    .from('meal_plans')
    .update({ is_completed: !!isCompleted })
    .eq('id', id);
  if (error) throw error;
}

/**
 * The ingredients a single plan contributes to a grocery list — the one
 * place that decides it, so the CTA's count and the list itself can never
 * disagree.
 *
 * A plan contributes NOTHING unless a recipe is attached or its snapshot
 * carries an `ingredients` array. Neither the Photo-AI nor the manual entry
 * path writes one (they store macros), so in production this is empty for
 * every row that exists: 0 of 8 snapshots carry `ingredients`.
 */
export function planIngredients(plan, recipesById) {
  if (!plan || plan.is_completed) return [];
  const recipe = plan.recipe_id ? recipesById?.get(plan.recipe_id) : null;
  const ingredients = recipe?.ingredients
    || (Array.isArray(plan.food_snapshot?.ingredients) ? plan.food_snapshot.ingredients : []);
  if (!Array.isArray(ingredients)) return [];
  return ingredients.filter(ing => String(ing?.name || '').trim());
}

/** Plans in `plans` that will actually put something on the list. */
export function shoppablePlans(plans, recipesById) {
  return (plans || []).filter(p => planIngredients(p, recipesById).length > 0);
}

/**
 * Build a consolidated grocery list from upcoming meal plans:
 * walks every plan in the range, sums ingredient grams across all
 * meals, returns one item per unique ingredient name.
 *
 * @param {Array} plans   meal_plans rows with embedded recipes
 * @param {Map<string, object>} recipesById  recipe lookup
 * @returns {Array<{ name, total_grams, recipes: string[] }>}
 */
export function buildGroceryList(plans, recipesById) {
  const out = new Map();
  for (const p of plans || []) {
    const recipe = p.recipe_id ? recipesById?.get(p.recipe_id) : null;
    for (const ing of planIngredients(p, recipesById)) {
      const key = String(ing?.name || '').trim().toLowerCase();
      if (!key) continue;
      if (!out.has(key)) {
        out.set(key, { name: ing.name, total_grams: 0, recipes: new Set() });
      }
      const slot = out.get(key);
      slot.total_grams += Number(ing.grams) || 0;
      if (recipe?.name) slot.recipes.add(recipe.name);
    }
  }
  return Array.from(out.values()).map(v => ({
    name: v.name,
    total_grams: Math.round(v.total_grams),
    recipes: Array.from(v.recipes),
  })).sort((a, b) => a.name.localeCompare(b.name));
}
