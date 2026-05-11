// src/lib/leaderboardStats.js
// Note: country_code / state_code are NOT backfilled here — they come from
// onboarding location step. Pre-existing users without those fields will be
// excluded from regional leaderboards until they update their profile.
import { db } from '@/api/db';

const BACKFILL_FLAG = 'fn-leaderboard-stats-backfilled-v2';

/**
 * One-time client-side backfill: aggregate the current user's WorkoutLog
 * volume and CardioLog distance, plus their unlocked achievement count,
 * and write them onto the User record. Safe to call on every modal open
 * because of the localStorage flag.
 */
export async function backfillLeaderboardStatsOnce(userEmail) {
  if (!userEmail) return;

  const me = await db.auth.me();
  const flagValue = `${userEmail}|${me?.account_reset_at || ''}`;
  try {
    if (localStorage.getItem(BACKFILL_FLAG) === flagValue) return;
  } catch { /* ignore */ }

  try {
    const [logs, cardioLogs, achievements] = await Promise.all([
      db.entities.WorkoutLog.filter({ created_by: userEmail }, '-date', 1000),
      db.entities.CardioLog.filter({ created_by: userEmail }, '-date', 1000),
      db.entities.Achievement.filter({ created_by: userEmail }),
    ]);

    const volume = logs.reduce((sum, log) =>
      sum + (log.exercises || []).reduce((s, ex) =>
        s + (ex.sets || []).reduce((t, set) =>
          t + (Number(set.weight) || 0) * (Number(set.reps) || 0), 0), 0), 0);

    const distance = cardioLogs.reduce((sum, c) =>
      sum + (Number(c.distance_meters) || 0), 0);

    const unlockedCount = achievements.filter(a => a.unlocked).length;

    const update = {};
    if (Math.abs((Number(me?.total_volume_lbs) || 0) - volume) > 0.01) {
      update.total_volume_lbs = volume;
    }
    if (Math.abs((Number(me?.total_distance_meters) || 0) - distance) > 0.01) {
      update.total_distance_meters = distance;
    }
    if ((Number(me?.achievements_unlocked_count) || 0) !== unlockedCount) {
      update.achievements_unlocked_count = unlockedCount;
    }
    if (Object.keys(update).length > 0) {
      await db.auth.updateMe(update);
    }

    try { localStorage.setItem(BACKFILL_FLAG, flagValue); } catch { /* ignore */ }
  } catch { /* non-blocking */ }
}