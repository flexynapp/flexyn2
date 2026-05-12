// src/lib/data/templates.js
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { containsProfanity } from '@/lib/profanityFilter';

export const list = (email) =>
  db.entities.WorkoutTemplate.filter({ created_by: email }, '-created_date');

function assertNoTextProfanity(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && containsProfanity(val)) {
      throw Object.assign(new Error(`Profanity detected in field "${key}"`), { code: 'PROFANITY', field: key });
    }
  }
}

export const create = (data) => {
  assertNoTextProfanity({ name: data.name, description: data.description || '' });
  return db.entities.WorkoutTemplate.create(data);
};
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

  return db.entities.WorkoutTemplate.update(id, data);
};
export const remove = (id) => db.entities.WorkoutTemplate.delete(id);

/** Fetch all public templates from any user, sorted by copy count then date. */
export const listPublic = async (limit = 100) => {
  const rows = await db.entities.WorkoutTemplate.filter(
    { is_public: true }, '-copy_count', limit
  ).catch(() => []);
  return rows;
};

/**
 * Copy a public template into the current user's library.
 * Increments the original's copy_count.
 */
export const copyTemplate = async (original, user) => {
  const copy = await db.entities.WorkoutTemplate.create({
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

export const purgeForUser = async (email) => {
  if (!email) return;
  const batch = await db.entities.WorkoutTemplate.filter({ created_by: email }).catch(() => []);
  await Promise.all((batch || []).map(r =>
    db.entities.WorkoutTemplate.delete(r.id).catch(() => {})
  ));
};

