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

// Remove the diary mirror of ONE planned meal. A slot holds up to three
// planned meals (migration 355), so deleting every planner row in the slot
// took the other meals' calories off the diary too. With a snapshot, one row
// matching that meal's name and calories goes; without one (legacy callers),
// the whole slot is cleared as before. Only touches rows tagged
// notes:'planner', never manual logs.
export const removePlannerDiaryLog = async ({ user, date, mealType, snapshot }) => {
  if (!user?.id || !date) return;
  if (!snapshot) {
    await supabase
      .from('nutrition_logs')
      .delete()
      .eq('user_id', user.id)
      .eq('date', date)
      .eq('meal_type', mealType || 'snack')
      .eq('notes', PLANNER_LOG_TAG);
    return;
  }
  const { data } = await supabase
    .from('nutrition_logs')
    .select('id, calories')
    .eq('user_id', user.id)
    .eq('date', date)
    .eq('meal_type', mealType || 'snack')
    .eq('notes', PLANNER_LOG_TAG)
    .eq('food_name', snapshot.name || 'Planned meal')
    .order('created_at', { ascending: true });
  const cal = Number(snapshot.calories) || 0;
  const match = (data || []).find(r => Number(r.calories) === cal) || (data || [])[0];
  if (match?.id) await remove(match.id);
};

// Mirror one planner meal into the diary. Additive: each planned meal in a
// slot gets its own row, and removing a plan removes only its own row.
export const syncPlannerDiaryLog = async ({ user, date, mealType, snapshot }) => {
  if (!user?.id || !date || !snapshot) return;
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
