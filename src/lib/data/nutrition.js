// src/lib/data/nutrition.js
import { supabase } from '@/api/supabaseClient';
import { containsProfanity } from '@/lib/profanityFilter';
import { ownedRows } from './ownedRows';

const rows = ownedRows('nutrition_logs');

// Diary logs mirrored from the meal planner carry notes:'planner' so they
// can be kept in sync with the plan grid without touching manually-logged
// meals. One planner log per slot (date + meal_type).
export const PLANNER_LOG_TAG = 'planner';

export const list = (userId, limit = 50) =>
  rows.filter({ user_id: userId }, '-date', limit);

/** Fetch a diary row by id, or null. */
export const get = (id) => rows.get(id);

// Newest logged first, for history, search and "log it again" lists.
export const listRecent = (userId, limit = 300) =>
  rows.filter({ user_id: userId }, '-created_at', limit);

// One day's diary, meals and water together. The Nutrition page takes the
// rows in whatever order the table returns them and sorts them itself; the
// hydration ring asks for newest first and caps the read.
export const listForDate = (userId, date, { newestFirst = false, limit } = {}) =>
  newestFirst
    ? rows.filter({ user_id: userId, date }, '-created_date', limit ?? 100)
    : rows.filter({ user_id: userId, date }, undefined, limit);

function assertNoTextProfanity(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && containsProfanity(val)) {
      throw Object.assign(new Error(`Profanity detected in field "${key}"`), { code: 'PROFANITY', field: key });
    }
  }
}

// The form, scanner, planner and recipes name macros with a unit suffix;
// the table's columns do not.
const MACRO_COLUMN = {
  protein_g: 'protein',
  carbs_g:   'carbs',
  fat_g:     'fat',
  fiber_g:   'fiber',
  sodium_mg: 'sodium',
};

export const create = (data) => {
  assertNoTextProfanity({ food_name: data.food_name, notes: data.notes });
  const row = { ...data };
  for (const [alias, column] of Object.entries(MACRO_COLUMN)) {
    row[column] = data[alias] ?? data[column] ?? null;
    delete row[alias];
  }
  return rows.create(row);
};
export const update = (id, data) => {
  const textFields = {};
  if (data.food_name !== undefined) textFields.food_name = data.food_name;
  if (data.notes !== undefined) textFields.notes = data.notes;
  if (Object.keys(textFields).length) assertNoTextProfanity(textFields);
  return rows.update(id, data);
};
export const remove = (id) => rows.remove(id);

// Remove any planner-originated diary log for a given slot (date + meal_type).
// Idempotent; only touches rows tagged notes:'planner', never manual logs.
export const removePlannerDiaryLog = ({ user, date, mealType }) => {
  if (!user?.id || !date) return Promise.resolve();
  return supabase
    .from('nutrition_logs')
    .delete()
    .eq('user_id', user.id)
    .eq('date', date)
    .eq('meal_type', mealType || 'snack')
    .eq('notes', PLANNER_LOG_TAG);
};

// Sync a planner meal into the diary for its slot: clear the previous
// planner log for that slot, then (unless removing) write the new one. Keeps
// re-adds from double-counting and lets plan removal un-log the meal.
export const syncPlannerDiaryLog = async ({ user, date, mealType, snapshot }) => {
  if (!user?.id || !date) return;
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
