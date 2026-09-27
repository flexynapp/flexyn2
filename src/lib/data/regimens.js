// src/lib/data/regimens.js
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { containsProfanity } from '@/lib/profanityFilter';

export const list = (userId) =>
  db.entities.Regimen.filter({ user_id: userId }, '-created_date');

function assertNoTextProfanity(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && containsProfanity(val)) {
      throw Object.assign(new Error(`Profanity detected in field "${key}"`), { code: 'PROFANITY', field: key });
    }
  }
}

export const create = (data) => {
  assertNoTextProfanity({ name: data.name, description: data.description });
  return db.entities.Regimen.create(data);
};
export const update = (id, data) => {
  const textFields = {};
  if (data.name !== undefined) textFields.name = data.name;
  if (data.description !== undefined) textFields.description = data.description;
  if (Object.keys(textFields).length) assertNoTextProfanity(textFields);
  return db.entities.Regimen.update(id, data);
};
export const remove = (id) => db.entities.Regimen.delete(id);

/**
 * Fetch all public templates from any user, sorted by copy count.
 *
 * Reads from a UNION of is_public=true and is_public_free=true. The two
 * columns drifted in migration 143 (the gated SELECT policy was scoped
 * to is_public_free, but client code kept writing is_public alone), so
 * a strict filter on either column missed regimens published under the
 * other flag. We OR them with a single raw .or() call.
 */
export const listPublic = async (limit = 100) => {
  const { data, error } = await supabase
    .from('regimens')
    .select('*')
    .or('is_public.eq.true,is_public_free.eq.true')
    .order('copy_count', { ascending: false })
    .limit(limit);
  if (error) {
    // Pre-mig-143 hosts won't have is_public_free at all — the .or()
    // 42703s on those. Fall back to the legacy is_public-only path so
    // older deployments still surface public regimens.
    if (error.code === '42703') {
      const rows = await db.entities.Regimen
        .filter({ is_public: true }, '-copy_count', limit)
        .catch(() => []);
      return rows;
    }
    return [];
  }
  return data ?? [];
};

/**
 * Copy a public template into the current user's regimen library.
 * Increments the original's copy_count and records authorship on the copy.
 */
export const copyTemplate = async (original, user) => {
  const copy = await db.entities.Regimen.create({
    created_by: user.email,
    name: original.name,
    description: original.description || '',
    exercises: original.exercises || [],
    is_public: false,
    copy_count: 0,
    original_template_id: original.id,
    // Prefer the original's explicit username; only fall back to
    // "Unknown" if it's missing. The previous email-prefix fallback
    // leaked the original user's email local-part as the author
    // attribution on every copy. (Audit 17 #F28.)
    original_author_username: original.author_username || 'Unknown',
  });
  // Bump the source template's copy count via a security-definer RPC that
  // bypasses RLS (direct cross-user update is rejected by Postgres policies).
  await supabase.rpc('increment_copy_count', { p_table: 'regimens', p_id: original.id }).catch(() => {});
  return copy;
};
