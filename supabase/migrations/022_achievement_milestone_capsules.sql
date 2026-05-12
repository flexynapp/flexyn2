-- 022_achievement_milestone_capsules.sql
--
-- Tracks how many achievement-count milestone capsules have been granted
-- to a user, so the client-side grant logic in src/lib/data/capsules.js
-- (grantForAchievementMilestone) is idempotent. Without this counter
-- the reconciliation pass in leaderboardStats would re-grant every
-- milestone every time the count is re-derived.
--
-- Milestones the client uses (see capsules.js):
--   5  unlocks → standard capsule
--   10 unlocks → standard capsule
--   25 unlocks → premium capsule
--   50 unlocks → premium capsule
--   100 unlocks → elite capsule
--
-- `milestone_capsules_awarded` counts the number of milestones already
-- granted (0..5). The client only grants milestones whose index is
-- >= awarded count.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS milestone_capsules_awarded INTEGER NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
