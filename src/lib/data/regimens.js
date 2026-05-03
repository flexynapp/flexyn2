// src/lib/data/regimens.js
import { base44 } from '@/api/base44Client';
import { containsProfanity } from '@/lib/profanityFilter';

export const list = (email) =>
  base44.entities.Regimen.filter({ created_by: email }, '-created_date');

function assertNoTextProfanity(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && containsProfanity(val)) {
      throw Object.assign(new Error(`Profanity detected in field "${key}"`), { code: 'PROFANITY', field: key });
    }
  }
}

export const create = (data) => {
  assertNoTextProfanity({ name: data.name, description: data.description });
  return base44.entities.Regimen.create(data);
};
export const update = (id, data) => {
  const textFields = {};
  if (data.name !== undefined) textFields.name = data.name;
  if (data.description !== undefined) textFields.description = data.description;
  if (Object.keys(textFields).length) assertNoTextProfanity(textFields);
  return base44.entities.Regimen.update(id, data);
};
export const remove = (id) => base44.entities.Regimen.delete(id);

/** Fetch all public templates from any user, sorted by copy count then date. */
export const listPublic = async (limit = 100) => {
  const rows = await base44.entities.Regimen.filter({ is_public: true }, '-copy_count', limit).catch(() => []);
  return rows;
};

/**
 * Copy a public template into the current user's regimen library.
 * Increments the original's copy_count and records authorship on the copy.
 */
export const copyTemplate = async (original, user) => {
  const copy = await base44.entities.Regimen.create({
    created_by: user.email,
    name: original.name,
    description: original.description || '',
    exercises: original.exercises || [],
    is_public: false,
    copy_count: 0,
    original_template_id: original.id,
    original_author_username: original.author_username || original.created_by?.split('@')[0] || 'Unknown',
  });
  // Bump the source template's copy count (cross-user write — Base44 allows this)
  const newCount = (Number(original.copy_count) || 0) + 1;
  await base44.entities.Regimen.update(original.id, { copy_count: newCount }).catch(() => {});
  return copy;
};

export const purgeForUser = async (email) => {
  if (!email) return;
  const batch = await base44.entities.Regimen.filter({ created_by: email }).catch(() => []);
  await Promise.all((batch || []).map(r =>
    base44.entities.Regimen.delete(r.id).catch(() => {})
  ));
};
