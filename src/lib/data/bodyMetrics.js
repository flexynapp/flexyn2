// src/lib/data/bodyMetrics.js
import { db } from '@/api/db';

export const list = (userId, limit = 200) =>
  db.entities.BodyMetric.filter({ user_id: userId }, 'date', limit);

export const create = (data) => db.entities.BodyMetric.create(data);
export const update = (id, data) => db.entities.BodyMetric.update(id, data);
export const remove = (id) => db.entities.BodyMetric.delete(id);
