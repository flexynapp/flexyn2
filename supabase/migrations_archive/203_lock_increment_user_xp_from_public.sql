-- 203_lock_increment_user_xp_from_public.sql
--
-- Follow-up to 198. The per-action XP caps (grant_action_xp) are only
-- enforced if the raw increment_user_xp RPC is NOT directly client-callable
-- — otherwise a client just calls increment_user_xp(uid, 50000) and skips
-- the caps. Migration 198 revoked EXECUTE from authenticated/anon, but
-- Postgres grants every function a DEFAULT EXECUTE to PUBLIC, and
-- authenticated inherits PUBLIC — so the raw RPC was STILL callable. A live
-- smoke test confirmed it: an authenticated user granted itself XP via
-- increment_user_xp directly. Revoke the PUBLIC grant so the only path left
-- is grant_action_xp (per-action capped) and the SECURITY DEFINER callers
-- (grant_action_xp, grant_xp_milestone_achievements) which run as the owner.
--
-- record_monthly_xp already has no PUBLIC grant (verified), and
-- increment_league_xp / increment_user_volume / increment_user_distance are
-- intentionally client-callable but self-cap, so they don't need this.

REVOKE EXECUTE ON FUNCTION public.increment_user_xp(uuid, integer) FROM PUBLIC;
