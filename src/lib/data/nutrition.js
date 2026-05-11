// src/lib/data/nutrition.js
import { db } from '@/api/db';
import { containsProfanity } from '@/lib/profanityFilter';

export const list = (email, limit = 50) =>
  db.entities.NutritionLog.filter({ created_by: email }, '-date', limit);

function assertNoTextProfanity(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && containsProfanity(val)) {
      throw Object.assign(new Error(`Profanity detected in field "${key}"`), { code: 'PROFANITY', field: key });
    }
  }
}

export const create = (data) => {
  assertNoTextProfanity({ food_name: data.food_name, notes: data.notes });
  // Dual-write: write both old column names (migration 001) and new _g/_mg names
  // (migration 006). The resilient retry loop strips whichever set doesn't exist yet,
  // ensuring macros always land somewhere regardless of migration state.
  const enriched = {
    ...data,
    // Old names (always exist — migration 001)
    protein: data.protein_g  ?? data.protein  ?? null,
    carbs:   data.carbs_g    ?? data.carbs    ?? null,
    fat:     data.fat_g      ?? data.fat      ?? null,
    fiber:   data.fiber_g    ?? data.fiber    ?? null,
    sodium:  data.sodium_mg  ?? data.sodium   ?? null,
  };
  return db.entities.NutritionLog.create(enriched);
};
export const update = (id, data) => {
  const textFields = {};
  if (data.food_name !== undefined) textFields.food_name = data.food_name;
  if (data.notes !== undefined) textFields.notes = data.notes;
  if (Object.keys(textFields).length) assertNoTextProfanity(textFields);
  return db.entities.NutritionLog.update(id, data);
};
export const remove = (id) => db.entities.NutritionLog.delete(id);

export const purgeForUser = async (email) => {
  if (!email) return;
  const PAGE = 100;
  let total = 0;
  while (true) {
    const batch = await db.entities.NutritionLog
      .filter({ created_by: email }, '-created_date', PAGE).catch(() => []);
    if (!batch || batch.length === 0) break;
    await Promise.all(batch.map(r =>
      db.entities.NutritionLog.delete(r.id).catch(() => {})
    ));
    total += batch.length;
    if (batch.length < PAGE || total > 5000) break;
  }
};