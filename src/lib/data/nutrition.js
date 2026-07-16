// src/lib/data/nutrition.js
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { containsProfanity } from '@/lib/profanityFilter';

// Diary logs mirrored from the meal planner carry notes:'planner' so they
// can be kept in sync with the plan grid without touching manually-logged
// meals. One planner log per slot (date + meal_type).
export const PLANNER_LOG_TAG = 'planner';

export const list = (email, limit = 50) =>
  db.entities.NutritionLog.filter({ created_by: email }, '-date', limit);

function assertNoTextProfanity(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && containsProfanity(val)) {
      throw Object.assign(new Error(`Profanity detected in field "${key}"`), { code: 'PROFANITY', field: key });
    }
  }
}

export const create = (data) => {
  assertNoTextProfanity({ food_name: data.food_name, notes: data.notes });
  // Dual-write: write both old column names (migration 001) and new _g/_mg names
  // (migration 006). The resilient retry loop strips whichever set doesn't exist yet,
  // ensuring macros always land somewhere regardless of migration state.
  const enriched = {
    ...data,
    // Old names (always exist — migration 001)
    protein: data.protein_g  ?? data.protein  ?? null,
    carbs:   data.carbs_g    ?? data.carbs    ?? null,
    fat:     data.fat_g      ?? data.fat      ?? null,
    fiber:   data.fiber_g    ?? data.fiber    ?? null,
    sodium:  data.sodium_mg  ?? data.sodium   ?? null,
  };
  return db.entities.NutritionLog.create(enriched);
};
export const update = (id, data) => {
  const textFields = {};
  if (data.food_name !== undefined) textFields.food_name = data.food_name;
  if (data.notes !== undefined) textFields.notes = data.notes;
  if (Object.keys(textFields).length) assertNoTextProfanity(textFields);
  return db.entities.NutritionLog.update(id, data);
};
export const remove = (id) => db.entities.NutritionLog.delete(id);

// Remove any planner-originated diary log for a given slot (date + meal_type).
// Idempotent; only touches rows tagged notes:'planner', never manual logs.
export const removePlannerDiaryLog = ({ user, date, mealType }) => {
  if (!user?.email || !date) return Promise.resolve();
  return supabase
    .from('nutrition_logs')
    .delete()
    .eq('created_by', user.email)
    .eq('date', date)
    .eq('meal_type', mealType || 'snack')
    .eq('notes', PLANNER_LOG_TAG);
};

// Sync a planner meal into the diary for its slot: clear the previous
// planner log for that slot, then (unless removing) write the new one. Keeps
// re-adds from double-counting and lets plan removal un-log the meal.
export const syncPlannerDiaryLog = async ({ user, date, mealType, snapshot }) => {
  if (!user?.email || !date) return;
  await removePlannerDiaryLog({ user, date, mealType });
  if (!snapshot) return;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  await create({
    food_name:       snapshot.name || 'Planned meal',
    calories:        num(snapshot.calories),
    protein_g:       num(snapshot.protein_g),
    carbs_g:         num(snapshot.carbs_g),
    fat_g:           num(snapshot.fat_g),
    sodium_mg:       num(snapshot.sodium_mg),
    fiber_g:         num(snapshot.fiber_g),
    sugar_g:         num(snapshot.sugar_g),
    cholesterol_mg:  num(snapshot.cholesterol_mg),
    iron_mg:         num(snapshot.iron_mg),
    magnesium_mg:    num(snapshot.magnesium_mg),
    calcium_mg:      num(snapshot.calcium_mg),
    potassium_mg:    num(snapshot.potassium_mg),
    vitamin_a_iu:    num(snapshot.vitamin_a_iu),
    vitamin_c_mg:    num(snapshot.vitamin_c_mg),
    vitamin_d_iu:    num(snapshot.vitamin_d_iu),
    vitamin_b12_mcg: num(snapshot.vitamin_b12_mcg),
    meal_type:       mealType || 'snack',
    date,
    notes:           PLANNER_LOG_TAG,
    created_by:      user.email,
    user_id:         user.id,
  });
};

export const purgeForUser = async (email) => {
  if (!email) return;
  const PAGE = 100;
  let total = 0;
  while (true) {
    const batch = await db.entities.NutritionLog
      .filter({ created_by: email }, '-created_date', PAGE).catch(() => []);
    if (!batch || batch.length === 0) break;
    await Promise.all(batch.map(r =>
      db.entities.NutritionLog.delete(r.id).catch(() => {})
    ));
    total += batch.length;
    if (batch.length < PAGE || total > 5000) break;
  }
};