// src/lib/data/cardio.js
import { db } from '@/api/db';
import { containsProfanity } from '@/lib/profanityFilter';

export const list = (email, limit = 50) =>
  db.entities.CardioLog.filter({ created_by: email }, '-date', limit);

export const listByDate = (email, date) =>
  db.entities.CardioLog.filter({ created_by: email, date }, '-created_date', 50);

function assertNoTextProfanity(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && containsProfanity(val)) {
      throw Object.assign(new Error(`Profanity detected in field "${key}"`), { code: 'PROFANITY', field: key });
    }
  }
}

export const create = (data) => {
  assertNoTextProfanity({ notes: data.notes });
  return db.entities.CardioLog.create(data);
};
export const update = (id, data) => {
  if (data.notes !== undefined) assertNoTextProfanity({ notes: data.notes });
  return db.entities.CardioLog.update(id, data);
};
export const remove = (id) => db.entities.CardioLog.delete(id);

export const purgeForUser = async (email) => {
  if (!email) return;
  const PAGE = 100;
  let total = 0;
  while (true) {
    const batch = await db.entities.CardioLog
      .filter({ created_by: email }, '-created_date', PAGE).catch(() => []);
    if (!batch || batch.length === 0) break;
    await Promise.all(batch.map(r =>
      db.entities.CardioLog.delete(r.id).catch(() => {})
    ));
    total += batch.length;
    if (batch.length < PAGE || total > 5000) break;
  }
};