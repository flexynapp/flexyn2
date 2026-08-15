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
 * Newest-first: a slot may legitimately hold several meals since migration
 * 355, and this answers "which one would a swap replace" — the most recent.
 * Only `upsert({ replaceSlot: true })` uses it; see the note there.
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
 * How many meals one slot holds. Mirrors the trigger migration 355 installs —
 * change both together or the UI promises something the database refuses.
 *
 * Three, because TWO is the floor that has to work (every plan template's
 * snack1 and snack2 both map to the single `snack` type, so applying a plan
 * needs two in one slot) and past three a day stops being a plan and becomes
 * a record — which `syncPlannerDiaryLog` already mirrors into nutrition_logs,
 * uncapped.
 */
export const SLOT_CAPACITY = 3;

/**
 * True when a write bounced off that cap.
 *
 * Matched on SQLSTATE alone: `meal_plans` carries no other CHECK constraint
 * (verified against production — pg_constraint holds only the primary key and
 * the user_id foreign key), so 23514 on this table can only be the trigger.
 * Matching the message instead would break the moment it is translated.
 */
export function isSlotFull(err) {
  return err?.code === '23514';
}

/**
 * A slot holds up to SLOT_CAPACITY meals.
 *
 * This used to resolve the slot's existing row and update it, which made a
 * second dinner overwrite the first — correct while migration 344's unique
 * index existed, and wrong as a rule. 355 reverses that: a day can carry two
 * dinners, and uniqueness moved to the mirror identity (user_id, log_id),
 * which is what the 2026-08-11 duplicate incident was actually about. Those 6
 * unreachable rows were one diary entry mirrored repeatedly, never two
 * different meals.
 *
 * So the default is now an INSERT. Resolving an id is right when the caller
 * KNOWS the row — editing one — and wrong as a default:
 *
 *   upsert({ id })              → update that row
 *   upsert({ replaceSlot: true }) → swap the slot's newest meal in place
 *   upsert({})                  → a new meal in the slot
 */
export async function upsert({ id, replaceSlot = false, user, planDate, mealType, recipeId, foodSnapshot, notes }) {
  if (!user?.id || !planDate) throw new Error('user + planDate required');
  const slotType = mealType || 'snack';
  const rowId = id || (replaceSlot ? await findSlot(user.id, planDate, slotType) : null);
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
 * Delete the planner row that MIRRORS a diary entry.
 *
 * The Nutrition page's photo logger writes a meal_plans row 120-192ms after
 * its nutrition_logs row, stamping the new log's id onto the snapshot.
 * Deleting the diary entry used to remove only the log, leaving the plan
 * behind pointing at a row that no longer exists — 3 of 8 production rows
 * were in that state before a dedupe cleared them incidentally. The planner
 * now sums a day's calories, so an orphan is no longer a stale cell: it is
 * the app reporting calories for a meal the user deleted.
 *
 * Filtering on the JSON path is what makes this one statement instead of a
 * read-then-delete, and `meal_plans_user_log_uniq` (migration 355) means it
 * can only ever match one row.
 */
export async function removeMirrorForLog(logId) {
  if (!logId) return;
  const { error } = await supabase
    .from('meal_plans')
    .delete()
    .eq('food_snapshot->>log_id', String(logId));
  if (error) throw error;
}

/**
 * What a day adds up to. Pure, so the arithmetic is testable without a grid.
 *
 * Only a snapshot carries numbers — a recipe-backed plan stores `recipe_id`
 * and nothing else — so a day of recipe slots reports `counted: 0` against a
 * non-zero `meals`. The caller must render that as "no macros yet" rather
 * than as a zero: a 0 kcal at someone who planned three meals is the app
 * calling them lazy, which is the rule CLAUDE.md states for empty sections.
 */
export function dayTotals(plans) {
  const out = { calories: 0, protein: 0, carbs: 0, fat: 0, meals: 0, counted: 0 };
  for (const p of plans || []) {
    out.meals += 1;
    const s = p?.food_snapshot;
    if (!s) continue;
    const kcal = Number(s.calories);
    const pr = Number(s.protein_g), c = Number(s.carbs_g), f = Number(s.fat_g);
    const any = [kcal, pr, c, f].some(v => Number.isFinite(v) && v > 0);
    if (!any) continue;
    out.counted += 1;
    if (Number.isFinite(kcal)) out.calories += kcal;
    if (Number.isFinite(pr)) out.protein += pr;
    if (Number.isFinite(c)) out.carbs += c;
    if (Number.isFinite(f)) out.fat += f;
  }
  return out;
}
