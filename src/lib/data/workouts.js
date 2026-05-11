// src/lib/data/workouts.js
import { db } from '@/api/db';
import { containsProfanity } from '@/lib/profanityFilter';

/** List the current user's workout logs, newest first. */
export const list = (email, limit = 50) =>
  db.entities.WorkoutLog.filter({ created_by: email }, '-date', limit);

/** Fetch a workout log by id. */
export const get = (id) =>
  db.entities.WorkoutLog.get(id);

function assertNoTextProfanity(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && containsProfanity(val)) {
      throw Object.assign(new Error(`Profanity detected in field "${key}"`), { code: 'PROFANITY', field: key });
    }
  }
}

/** Create a new workout log. Returns the saved record. */
export const create = (data) => {
  assertNoTextProfanity({ notes: data.notes });
  return db.entities.WorkoutLog.create(data);
};

/** Update a workout log by id. */
export const update = (id, data) => {
  if (data.notes !== undefined) assertNoTextProfanity({ notes: data.notes });
  return db.entities.WorkoutLog.update(id, data);
};

/** Delete a workout log by id. */
export const remove = (id) =>
  db.entities.WorkoutLog.delete(id);

/**
 * Page through and delete every workout log owned by a user.
 * Used by account deletion. Best-effort; safe to call repeatedly.
 */
export const purgeForUser = async (email) => {
  if (!email) return;
  const PAGE = 100;
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await db.entities.WorkoutLog
      .filter({ created_by: email }, '-created_date', PAGE)
      .catch(() => []);
    if (!batch || batch.length === 0) break;
    await Promise.all(batch.map(r =>
      db.entities.WorkoutLog.delete(r.id).catch(() => {})
    ));
    total += batch.length;
    if (batch.length < PAGE || total > 5000) break;
  }
};