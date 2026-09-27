// src/lib/data/bodyMetrics.js
import { ownedRows } from './ownedRows';

const rows = ownedRows('body_metrics');

// Newest weigh-in first, like every other log module's list(). The old
// oldest-first version had no callers.
export const list = (userId, limit = 200) =>
  rows.filter({ user_id: userId }, '-date', limit);

export const create = (data) => rows.create(data);
export const update = (id, data) => rows.update(id, data);
export const remove = (id) => rows.remove(id);
