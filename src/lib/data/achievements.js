// src/lib/data/achievements.js
import { db } from '@/api/db';
import { filterAfterReset } from '@/lib/accountReset';

export const list = async (email) => {
  const [rows, me] = await Promise.all([
    db.entities.Achievement.filter({ created_by: email }),
    db.auth.me().catch(() => null),
  ]);
  return filterAfterReset(rows, me);
};

export const purgeForUser = async (email) => {
  if (!email) return;
  const batch = await db.entities.Achievement.filter({ created_by: email }).catch(() => []);
  await Promise.all((batch || []).map(r =>
    db.entities.Achievement.delete(r.id).catch(() => {})
  ));
};