// src/lib/data/templates.js
import { supabase } from '@/api/supabaseClient';
import { containsProfanity } from '@/lib/profanityFilter';
import { ownedRows } from './ownedRows';

const rows = ownedRows('workout_templates');

export const list = (userId) =>
  rows.filter({ user_id: userId }, '-created_date');

function assertNoTextProfanity(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && containsProfanity(val)) {
      throw Object.assign(new Error(`Profanity detected in field "${key}"`), { code: 'PROFANITY', field: key });
    }
  }
}

/**
 * A template stores STRUCTURE, not a specific session's numbers: exercise
 * names, muscle groups and how many sets — never the weight or reps that were
 * actually lifted. Loading a template should seed from your history, not from
 * whatever you happened to lift the day you saved it.
 *
 * Two exercise shapes are in circulation and both are legitimate; the workout
 * loader reads either (`hasSetsArray ? ex.sets.length : ex.target_sets`):
 *   • sets: [{ weight, reps }]      — from a finished session
 *   • target_sets / target_reps     — from the hand-built template form
 * This normalizes the first and leaves the second alone, so shapes are
 * preserved and only the numbers are dropped.
 *
 * Enforced here rather than trusted from callers. The template form has never
 * had a weight field, so in practice nothing was leaking numbers — but
 * `create` is a generic entry point and the invariant should hold for whatever
 * calls it next.
 */
export function stripTemplateNumbers(exercises) {
  if (!Array.isArray(exercises)) return [];
  return exercises.map((ex) => {
    if (!Array.isArray(ex?.sets) || ex.sets.length === 0) return ex;
    return {
      ...ex,
      sets: ex.sets.map(() => ({ weight: null, reps: null })),
    };
  });
}

export const create = (data) => {
  assertNoTextProfanity({ name: data.name, description: data.description || '' });
  return rows.create({
    ...data,
    exercises: stripTemplateNumbers(data.exercises),
  });
};

/**
 * Save a finished session as a template.
 *
 * Separate entry point from `create` because the two callers want opposite
 * error contracts: the templates modal mutates and relies on a THROW to drive
 * its onError toast, while the post-workout "Save as template" action is a
 * toast action that needs a value it can branch on. Returning `{ ok, reason }`
 * here keeps that action's existing handling working unchanged.
 *
 * @returns {{ok: true, id?: string} | {ok: false, reason: string}}
 */
export async function saveTemplate({ name, description = '', exercises = [] }) {
  const cleanName = (name || '').trim();
  if (!cleanName) return { ok: false, reason: 'name_required' };
  if (cleanName.length > 80) return { ok: false, reason: 'name_too_long' };
  if ((description || '').length > 280) return { ok: false, reason: 'description_too_long' };
  if (!Array.isArray(exercises) || exercises.length === 0) {
    return { ok: false, reason: 'no_exercises' };
  }
  if (containsProfanity(cleanName) || (description && containsProfanity(description))) {
    return { ok: false, reason: 'profanity' };
  }
  try {
    // rows.create injects created_by (email) and user_id (uuid). Reads
    // key on user_id; created_by stays populated because the table's older
    // policies still accept it and the column is NOT NULL.
    const row = await rows.create({
      name: cleanName,
      description: (description || '').trim(),
      exercises: stripTemplateNumbers(exercises),
      is_public: false,
    });
    return { ok: true, id: row?.id };
  } catch (err) {
    console.warn('[templates] saveTemplate failed:', err);
    return { ok: false, reason: 'db_error' };
  }
}
export const update = async (id, data) => {
  const textFields = {};
  if (data.name !== undefined) textFields.name = data.name;
  if (data.description !== undefined) textFields.description = data.description;
  if (Object.keys(textFields).length) assertNoTextProfanity(textFields);

  // Anti-attribution-laundering: if the caller is flipping is_public to true,
  // refuse on a copy of someone else's template (i.e. original_template_id
  // is set). Without this, a user could copy a popular template, mark it
  // public, and effectively republish someone else's work as their own.
  // The block is loaded from the live row (not trusted from the caller).
  if (data.is_public === true) {
    const { data: existing } = await supabase
      .from('workout_templates')
      .select('original_template_id')
      .eq('id', id)
      .maybeSingle();
    if (existing?.original_template_id) {
      throw Object.assign(new Error('cannot_publish_copy'), { code: 'COPY_NOT_PUBLISHABLE' });
    }
  }

  return rows.update(id, data);
};
export const remove = (id) => rows.remove(id);

/** Fetch all public templates from any user, sorted by copy count then date. */
export const listPublic = async (limit = 100) => {
  return rows.filter(
    { is_public: true }, '-copy_count', limit
  ).catch(() => []);
};

/**
 * Copy a public template into the current user's library.
 * Increments the original's copy_count.
 */
export const copyTemplate = async (original, user) => {
  const copy = await rows.create({
    created_by: user.email,
    name: original.name,
    exercises: original.exercises || [],
    is_public: false,
    copy_count: 0,
    original_template_id: original.id,
    original_author_username:
      original.author_username || (original.created_by || '').split('@')[0] || 'Unknown',
  });
  // Use security-definer RPC to bypass RLS on cross-user copy_count update
  await supabase.rpc('increment_copy_count', { p_table: 'workout_templates', p_id: original.id }).catch(() => {});
  return copy;
};
