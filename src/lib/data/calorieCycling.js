// src/lib/data/calorieCycling.js
//
// Per-day-type calorie + macro targets. Common in evidence-based
// programs: more on training days, less on rest days. Stored on
// user_profiles.calorie_cycling as { training: {calories, ...},
// rest: {calories, ...} } so the dashboard widgets can resolve the
// right goal for "today" based on whether a workout has been logged.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { db } from '@/api/db';


const EMPTY = { training: null, rest: null };

/** Read the stored cycling config. Returns the EMPTY shape when null. */
export async function getMine(userId) {
  if (!userId) return EMPTY;
  const { data, error } = await safeSelect({
    columns: ['calorie_cycling'],
    build: (cols) => supabase
    .from('user_profiles')
    .select(cols)
    .eq('id', userId)
    .maybeSingle(),
  });
  if (error || !data?.calorie_cycling) return EMPTY;
  return data.calorie_cycling;
}

/**
 * Persist the cycling config. Writes only the calorie_cycling column (a
 * narrow, low-failure write) then patches the db.js `_profile` cache so
 * me() + the react-query ['userProfile'] result reflect the new targets
 * without a full reload — a raw update alone left the module cache stale,
 * so a saved config only took effect after reloading the page.
 */
export async function saveMine(userId, cycling) {
  if (!userId) throw new Error('userId required');
  const value = cycling || null;
  const { error } = await supabase
    .from('user_profiles')
    .update({ calorie_cycling: value })
    .eq('id', userId);
  if (error) throw error;
  // Best-effort cache sync — the write already succeeded, so a cache miss
  // here only costs the pre-fix behavior (update visible after reload).
  try { db.auth.patchCache({ calorie_cycling: value }); } catch { /* non-critical */ }
}

/**
 * Pick today's target from the cycling config based on whether the
 * user has logged a workout today. Falls back to the baseline goal
 * when no cycling is configured or both branches are null.
 */
export function resolveToday(cycling, hadWorkoutToday, fallback) {
  if (!cycling || (cycling.training == null && cycling.rest == null)) {
    return fallback;
  }
  const branch = hadWorkoutToday ? cycling.training : cycling.rest;
  if (!branch) return fallback;
  return { ...fallback, ...branch };
}
