// src/lib/data/goals.js
import { db } from '@/api/db';
import { containsProfanity } from '@/lib/profanityFilter';

export const list = (email) =>
  db.entities.Goal.filter({ created_by: email }, '-created_date');

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
  return db.entities.Goal.create(data);
};
export const update = (id, data) => {
  const textFields = {};
  if (data.exercise_name !== undefined) textFields.exercise_name = data.exercise_name;
  if (data.exercise      !== undefined) textFields.exercise      = data.exercise;
  if (data.notes         !== undefined) textFields.notes         = data.notes;
  if (Object.keys(textFields).length) assertNoTextProfanity(textFields);
  return db.entities.Goal.update(id, data);
};
export const remove = (id) => db.entities.Goal.delete(id);

export const purgeForUser = async (email) => {
  if (!email) return;
  const batch = await db.entities.Goal.filter({ created_by: email }).catch(() => []);
  await Promise.all((batch || []).map(r =>
    db.entities.Goal.delete(r.id).catch(() => {})
  ));
};