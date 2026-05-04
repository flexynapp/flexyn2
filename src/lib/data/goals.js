// src/lib/data/goals.js
import { base44 } from '@/api/base44Client';
import { containsProfanity } from '@/lib/profanityFilter';

export const list = (email) =>
  base44.entities.Goal.filter({ created_by: email }, '-created_date');

function assertNoTextProfanity(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && containsProfanity(val)) {
      throw Object.assign(new Error(`Profanity detected in field "${key}"`), { code: 'PROFANITY', field: key });
    }
  }
}

export const create = (data) => {
  assertNoTextProfanity({
    exercise_name: data.exercise_name,
    exercise: data.exercise,
    notes: data.notes,
  });
  return base44.entities.Goal.create(data);
};
export const update = (id, data) => {
  const textFields = {};
  if (data.exercise_name !== undefined) textFields.exercise_name = data.exercise_name;
  if (data.exercise      !== undefined) textFields.exercise      = data.exercise;
  if (data.notes         !== undefined) textFields.notes         = data.notes;
  if (Object.keys(textFields).length) assertNoTextProfanity(textFields);
  return base44.entities.Goal.update(id, data);
};
export const remove = (id) => base44.entities.Goal.delete(id);

export const purgeForUser = async (email) => {
  if (!email) return;
  const batch = await base44.entities.Goal.filter({ created_by: email }).catch(() => []);
  await Promise.all((batch || []).map(r =>
    base44.entities.Goal.delete(r.id).catch(() => {})
  ));
};