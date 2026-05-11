// src/lib/data/bodyMetrics.js
import { db } from '@/api/db';

export const list = (email, limit = 200) =>
  db.entities.BodyMetric.filter({ created_by: email }, 'date', limit);

export const create = (data) => db.entities.BodyMetric.create(data);
export const update = (id, data) => db.entities.BodyMetric.update(id, data);
export const remove = (id) => db.entities.BodyMetric.delete(id);

export const purgeForUser = async (email) => {
  if (!email) return;
  const batch = await db.entities.BodyMetric.filter({ created_by: email }).catch(() => []);
  await Promise.all((batch || []).map(r =>
    db.entities.BodyMetric.delete(r.id).catch(() => {})
  ));
};