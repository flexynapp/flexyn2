// src/lib/data/nutritionRecipes.js
//
// CRUD wrapper for user-built recipes (mig 123). A "recipe" is a
// multi-ingredient meal saved once and loggable in one tap —
// "my chicken rice bowl" = 1 row vs 3 entries every time the user
// eats it.

import { supabase } from '@/api/supabaseClient';

/** Sum macros across the ingredients array. Stored in totals JSONB. */
export function sumIngredients(ingredients = []) {
  return ingredients.reduce(
    (acc, i) => ({
      calories:       acc.calories       + (Number(i.calories)       || 0),
      protein_g:      acc.protein_g      + (Number(i.protein_g)      || 0),
      carbs_g:        acc.carbs_g        + (Number(i.carbs_g)        || 0),
      fat_g:          acc.fat_g          + (Number(i.fat_g)          || 0),
      fiber_g:        acc.fiber_g        + (Number(i.fiber_g)        || 0),
      sugar_g:        acc.sugar_g        + (Number(i.sugar_g)        || 0),
      sodium_mg:      acc.sodium_mg      + (Number(i.sodium_mg)      || 0),
      cholesterol_mg: acc.cholesterol_mg + (Number(i.cholesterol_mg) || 0),
    }),
    {
      calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
      fiber_g: 0, sugar_g: 0, sodium_mg: 0, cholesterol_mg: 0,
    }
  );
}

/** Per-serving macros — divides totals by servings (default 1). */
export function perServing(totals, servings) {
  const s = Number(servings) > 0 ? Number(servings) : 1;
  const out = {};
  for (const k of Object.keys(totals || {})) {
    out[k] = (Number(totals[k]) || 0) / s;
  }
  return out;
}

export async function listMine(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('nutrition_recipes')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) return [];
  return data ?? [];
}

export async function upsert({ id, user, name, servings, ingredients }) {
  if (!user?.id || !name?.trim()) throw new Error('user + name required');
  const totals = sumIngredients(ingredients);
  const row = {
    user_id:     user.id,
    user_email:  user.email,
    name:        name.trim(),
    servings:    Number(servings) || 1,
    ingredients,
    totals,
    updated_at:  new Date().toISOString(),
  };
  if (id) row.id = id;
  const { data, error } = await supabase
    .from('nutrition_recipes')
    .upsert(row, { onConflict: 'id' })
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function remove(id) {
  if (!id) throw new Error('id required');
  const { error } = await supabase
    .from('nutrition_recipes')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
