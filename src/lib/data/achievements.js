// src/lib/data/achievements.js
import { db } from '@/api/db';
import { filterAfterReset } from '@/lib/accountReset';

export const list = async (email) => {
  // Prefer user_id: server-granted achievements (mig 189) stamp
  // created_by='' for guests, so an email filter misses them. Both
  // writers (entity create + the 189 RPC) populate user_id.
  const me = await db.auth.me().catch(() => null);
  const rows = me?.id
    ? await db.entities.Achievement.filter({ user_id: me.id })
    : await db.entities.Achievement.filter({ created_by: email });
  return filterAfterReset(rows, me);
};

export const purgeForUser = async (email) => {
  if (!email) return;
  const batch = await db.entities.Achievement.filter({ created_by: email }).catch(() => []);
  await Promise.all((batch || []).map(r =>
    db.entities.Achievement.delete(r.id).catch(() => {})
  ));
};