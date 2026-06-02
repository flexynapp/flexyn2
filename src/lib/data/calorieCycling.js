// src/lib/data/calorieCycling.js
//
// Per-day-type calorie + macro targets. Common in evidence-based
// programs: more on training days, less on rest days. Stored on
// user_profiles.calorie_cycling as { training: {calories, ...},
// rest: {calories, ...} } so the dashboard widgets can resolve the
// right goal for "today" based on whether a workout has been logged.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';


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

/** Persist the cycling config. */
export async function saveMine(userId, cycling) {
  if (!userId) throw new Error('userId required');
  const { error } = await supabase
    .from('user_profiles')
    .update({ calorie_cycling: cycling || null })
    .eq('id', userId);
  if (error) throw error;
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
