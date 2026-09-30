// src/lib/data/regimens.js
import { supabase } from '@/api/supabaseClient';
import { containsProfanity } from '@/lib/profanityFilter';
import { ownedRows } from './ownedRows';
import { selectProfiles } from './users';

// Nobody reads created_by (the owner's email) or original_author_email back:
// other users cannot, because the table grants SELECT column by column, so
// select('*') would be refused. The owner is user_id.
export const PUBLIC_COLUMNS = 'id, user_id, name, description, days, created_at, created_date, is_public, is_public_free, copy_count, original_template_id, original_author_username, exercises, is_template, template_id, difficulty';

/** A person's own regimens also carry the fields only their editor uses. */
export const OWN_COLUMNS = `${PUBLIC_COLUMNS}, is_active, updated_at, copied_from_post_id`;

const rows = ownedRows('regimens', { columns: OWN_COLUMNS });

// The user's own regimens, newest first. Every reader of the
// ['regimens', email] cache calls this with no limit, so whichever page
// fills the cache first leaves the same rows for the others.
export const list = (userId, limit) =>
  rows.filter({ user_id: userId }, '-created_date', limit);

/** Fetch a regimen by id, or null (including one the policies hide). */
export const get = (id) => rows.get(id);

function assertNoTextProfanity(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && containsProfanity(val)) {
      throw Object.assign(new Error(`Profanity detected in field "${key}"`), { code: 'PROFANITY', field: key });
    }
  }
}

// async so a refused name rejects the promise instead of throwing before
// the caller has one to .catch().
export const create = async (data) => {
  assertNoTextProfanity({ name: data.name, description: data.description });
  return rows.create(data);
};
export const update = async (id, data) => {
  const textFields = {};
  if (data.name !== undefined) textFields.name = data.name;
  if (data.description !== undefined) textFields.description = data.description;
  if (Object.keys(textFields).length) assertNoTextProfanity(textFields);
  return rows.update(id, data);
};
export const remove = (id) => rows.remove(id);

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
    .select(PUBLIC_COLUMNS)
    .or('is_public.eq.true,is_public_free.eq.true')
    .order('copy_count', { ascending: false })
    .limit(limit);
  if (error) {
    // Pre-mig-143 hosts won't have is_public_free at all — the .or()
    // 42703s on those. Fall back to the legacy is_public-only path so
    // older deployments still surface public regimens.
    if (error.code === '42703') {
      return rows
        .filter({ is_public: true }, '-copy_count', limit)
        .catch(() => []);
    }
    return [];
  }
  return data ?? [];
};

/**
 * Copy a public template into the current user's regimen library.
 * Increments the original's copy_count and records authorship on the copy.
 */
async function ownerUsername(original) {
  if (!original?.user_id) return null;
  const res = await selectProfiles((from) => from
    .select('username')
    .eq('id', original.user_id)
    .maybeSingle());
  return res?.data?.username || null;
}

export const copyTemplate = async (original, user) => {
  const copy = await rows.create({
    created_by: user.email,
    name: original.name,
    description: original.description || '',
    exercises: original.exercises || [],
    is_public: false,
    copy_count: 0,
    original_template_id: original.id,
    // The author is the template's owner. `original.author_username` was
    // never a column on regimens, so every copy was credited to "Unknown".
    // (The email-prefix fallback before that leaked the owner's address,
    // Audit 17 #F28.)
    original_author_username: (await ownerUsername(original)) || 'Unknown',
  });
  // Bump the source template's copy count via a security-definer RPC that
  // bypasses RLS (direct cross-user update is rejected by Postgres policies).
  await supabase.rpc('increment_copy_count', { p_table: 'regimens', p_id: original.id }).catch(() => {});
  return copy;
};
