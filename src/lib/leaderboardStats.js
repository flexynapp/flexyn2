// src/lib/leaderboardStats.js
// Note: country_code / state_code are NOT backfilled here — they come from
// onboarding location step. Pre-existing users without those fields will be
// excluded from regional leaderboards until they update their profile.
import { db } from '@/api/db';
import { grantForAchievementMilestone } from '@/lib/data/capsules';

// v3 — bumped to force one-time re-run that also grants achievement-milestone
// capsules to pre-existing users (added in migration 022). Without this bump
// users who already have v2's flag would never receive their back-payment.
const BACKFILL_FLAG = 'fn-leaderboard-stats-backfilled-v3';

/**
 * One-time client-side backfill: sync the unlocked achievement count
 * onto the User record and back-pay any owed achievement-milestone
 * capsules. Safe to call on every modal open because of the
 * localStorage flag.
 *
 * total_volume_lbs / total_distance_meters are NOT touched here
 * anymore: they're RPC-maintained (increment_user_volume /
 * increment_user_distance since mig 023, reconcile_my_workout_volume
 * since 142) and the 142/173 trigger rejects direct client writes with
 * 42501. The old absolute-set was also lossy — it recomputed from the
 * most recent 1000 logs, so heavy users could have a correct server
 * total clobbered by a lower client recompute.
 */
export async function backfillLeaderboardStatsOnce(userEmail) {
  if (!userEmail) return;

  const me = await db.auth.me();
  const flagValue = `${userEmail}|${me?.account_reset_at || ''}`;
  try {
    if (localStorage.getItem(BACKFILL_FLAG) === flagValue) return;
  } catch { /* ignore */ }

  try {
    // Filter by user_id, not created_by: server-granted achievements (mig
    // 189) stamp created_by='' for guests, so the email filter missed
    // them; user_id is populated by BOTH writers (entity create + RPC).
    const achievements = me?.id
      ? await db.entities.Achievement.filter({ user_id: me.id })
      : await db.entities.Achievement.filter({ created_by: userEmail });

    // Every row in `achievements` IS an unlocked achievement (rows are
    // inserted at unlock time, with unlocked_at). The old predicate
    // `a.unlocked` referenced a column that never existed, so this always
    // computed 0 — and then CLOBBERED a nonzero
    // achievements_unlocked_count back to 0 on the next line, zeroing the
    // user on the achievements leaderboard.
    const unlockedCount = achievements.length;

    if ((Number(me?.achievements_unlocked_count) || 0) !== unlockedCount) {
      await db.auth.updateMe({ achievements_unlocked_count: unlockedCount });
    }

    // Back-pay achievement milestone capsules for existing users. The grant
    // function is idempotent via user_profiles.milestone_capsules_awarded —
    // running it here every session is safe and ensures pre-existing users
    // get the capsules they were owed before this feature shipped.
    if (me?.id && unlockedCount > 0) {
      try {
        await grantForAchievementMilestone(me.id, userEmail, unlockedCount);
      } catch (err) {
        console.warn('[backfill] milestone capsule grant failed:', err);
      }
    }

    try { localStorage.setItem(BACKFILL_FLAG, flagValue); } catch { /* ignore */ }
  } catch { /* non-blocking */ }
}