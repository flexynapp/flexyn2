// src/lib/data/regimens.js
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { containsProfanity } from '@/lib/profanityFilter';

export const list = (email) =>
  db.entities.Regimen.filter({ created_by: email }, '-created_date');

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

/** Fetch all public templates from any user, sorted by copy count then date. */
export const listPublic = async (limit = 100) => {
  const rows = await db.entities.Regimen.filter({ is_public: true }, '-copy_count', limit).catch(() => []);
  return rows;
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
    original_author_username: original.author_username || original.created_by?.split('@')[0] || 'Unknown',
  });
  // Bump the source template's copy count via a security-definer RPC that
  // bypasses RLS (direct cross-user update is rejected by Postgres policies).
  await supabase.rpc('increment_copy_count', { p_table: 'regimens', p_id: original.id }).catch(() => {});
  return copy;
};

/**
 * Cascade-purge regimens for a deleted account, EXCEPT public templates
 * that have been copied by other users — those are tombstoned (kept as
 * rows but stripped of authorship + hidden from new copies) so that any
 * existing copies still resolve `original_template_id` cleanly.
 *
 * Without this distinction, deleting an account that had popular public
 * templates left every clone with a dangling original_template_id, and
 * any UI that fetched the original (for credit / reporting / "see new
 * version") would 404 forever.
 */
export const purgeForUser = async (email) => {
  if (!email) return;
  const batch = await db.entities.Regimen.filter({ created_by: email }).catch(() => []);
  if (!batch || batch.length === 0) return;

  await Promise.all(batch.map(async (r) => {
    // Public template with copies → tombstone, don't delete.
    // - is_public=false so it stops appearing in template listings.
    // - name prefixed [Deleted account] so any UI that still shows it
    //   gives the user clear context.
    // - description cleared so deleted user's words don't linger.
    // - copy_count preserved so historical popularity is intact.
    if (r.is_public && (r.copy_count || 0) > 0) {
      try {
        await db.entities.Regimen.update(r.id, {
          is_public:   false,
          name:        '[Deleted account] ' + (r.name?.slice(0, 80) || 'Regimen'),
          description: '',
        });
      } catch (err) {
        console.warn('[regimens] tombstone failed for', r.id, err);
      }
      return;
    }
    // Private OR uncopied public template → safe to delete entirely.
    try {
      await db.entities.Regimen.delete(r.id);
    } catch (err) {
      console.warn('[regimens] delete failed for', r.id, err);
    }
  }));
};
