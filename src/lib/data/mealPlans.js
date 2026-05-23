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

export async function upsert({ id, user, planDate, mealType, recipeId, foodSnapshot, notes }) {
  if (!user?.id || !planDate) throw new Error('user + planDate required');
  const row = {
    user_id:       user.id,
    user_email:    user.email,
    plan_date:     planDate,
    meal_type:     mealType || 'snack',
    recipe_id:     recipeId    || null,
    food_snapshot: foodSnapshot || null,
    notes:         notes || null,
  };
  if (id) row.id = id;
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
    if (p.is_completed) continue;
    const recipe = p.recipe_id ? recipesById.get(p.recipe_id) : null;
    const ingredients = recipe?.ingredients
      || (Array.isArray(p.food_snapshot?.ingredients) ? p.food_snapshot.ingredients : []);
    for (const ing of ingredients) {
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
