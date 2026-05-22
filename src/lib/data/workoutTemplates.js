// src/lib/data/workoutTemplates.js
//
// Wraps the public.workout_templates table (defined in 001_initial_schema.sql).
// A template is a named, reusable workout skeleton — exercise list +
// optional notes, without specific weight/rep values. Users save current
// workouts as templates, then pre-fill new workouts from a saved template.
//
// Distinction from Regimens:
//   Regimens   — a multi-week PROGRAM with progression rules
//   Templates  — a single-session WORKOUT shape, no progression
//
// Templates compose well with the existing "repeat from log" flow:
// both pre-fill the Workout page's exercise list, just from different
// sources (a workout_log row vs. a workout_templates row).

import { supabase } from '@/api/supabaseClient';
import { containsProfanity } from '@/lib/profanityFilter';

/**
 * List all templates owned by the current user. Returns array,
 * empty on failure.
 */
export async function listMyTemplates() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return [];
  const { data, error } = await supabase
    .from('workout_templates')
    .select('id, name, description, exercises, is_public, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) {
    console.warn('[workoutTemplates] list failed:', error);
    return [];
  }
  return data ?? [];
}

/**
 * Save the current workout as a template. Strips weights + reps from
 * each set so the template is a SKELETON, not a copy of a specific
 * session's numbers.
 *
 * @param {object} opts
 * @param {string} opts.name          required, max 80 chars
 * @param {string} [opts.description] optional, max 280 chars
 * @param {Array}  opts.exercises     the current exercises array
 * @returns {{ok: true, id} | {ok: false, reason}}
 */
export async function saveTemplate({ name, description = '', exercises = [] }) {
  const cleanName = (name || '').trim();
  if (!cleanName) return { ok: false, reason: 'name_required' };
  if (cleanName.length > 80) return { ok: false, reason: 'name_too_long' };
  if (description.length > 280) return { ok: false, reason: 'description_too_long' };
  if (!Array.isArray(exercises) || exercises.length === 0) {
    return { ok: false, reason: 'no_exercises' };
  }
  // Profanity gate on user-supplied text (mirrors hub_posts + crew name).
  if (containsProfanity(cleanName) || (description && containsProfanity(description))) {
    return { ok: false, reason: 'profanity' };
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id || !user?.email) return { ok: false, reason: 'unauthenticated' };

  // Build the skeleton: keep exercise name + muscle groups + the set
  // COUNT, but blank the specific weight/reps. The template stores
  // structure, not values.
  const skeleton = exercises.map((ex) => ({
    name:           ex.name,
    displayName:    ex.displayName || ex.name,
    muscle_group:   ex.muscle_group  || '',
    muscle_groups:  Array.isArray(ex.muscle_groups) ? [...ex.muscle_groups] : [],
    sets: Array.from(
      { length: Math.max(1, Array.isArray(ex.sets) ? ex.sets.length : 1) },
      () => ({ weight: null, reps: null }),
    ),
  }));

  const { data, error } = await supabase
    .from('workout_templates')
    .insert({
      created_by:  user.email,
      user_id:     user.id,
      name:        cleanName,
      description: description.trim(),
      exercises:   skeleton,
      is_public:   false,
    })
    .select('id')
    .single();

  if (error) {
    console.warn('[workoutTemplates] save failed:', error);
    return { ok: false, reason: 'db_error' };
  }
  return { ok: true, id: data?.id };
}

/**
 * Update a template's name / description / exercises in-place.
 * Idempotent — sends only the changed fields.
 */
export async function updateTemplate(id, patch = {}) {
  if (!id) return { ok: false, reason: 'no_id' };
  const updates = { updated_at: new Date().toISOString() };
  if (typeof patch.name === 'string') updates.name = patch.name.trim().slice(0, 80);
  if (typeof patch.description === 'string') updates.description = patch.description.trim().slice(0, 280);
  if (Array.isArray(patch.exercises)) updates.exercises = patch.exercises;

  const { error } = await supabase
    .from('workout_templates')
    .update(updates)
    .eq('id', id);
  if (error) {
    console.warn('[workoutTemplates] update failed:', error);
    return { ok: false, reason: 'db_error' };
  }
  return { ok: true };
}

/** Delete a template. */
export async function deleteTemplate(id) {
  if (!id) return { ok: false, reason: 'no_id' };
  const { error } = await supabase
    .from('workout_templates')
    .delete()
    .eq('id', id);
  if (error) {
    console.warn('[workoutTemplates] delete failed:', error);
    return { ok: false, reason: 'db_error' };
  }
  return { ok: true };
}
