-- 245_league_members_xp_lockdown.sql
--
-- Closes an XP-forgery vector on league standings.
--
-- NOTE ON NUMBERING: 244 is already taken by
-- 244_dm_purge_unsend_guest_identity.sql. This is 245.
--
-- THE HOLE
--
-- public.league_members carried
--
--   "league_members: update own"  UPDATE  PERMISSIVE  {authenticated}
--   USING (user_id = (SELECT auth.uid()))
--
-- plus an UPDATE grant to authenticated. The policy constrains WHICH ROW
-- you may update — your own — but says nothing about WHICH COLUMNS. So
-- any signed-in user could
--
--   UPDATE public.league_members SET weekly_xp = 999999 WHERE user_id = <self>
--
-- straight from the browser, bypassing increment_league_xp entirely.
-- League placement drives promotion/demotion and pays out through
-- claim_league_resolution / distribute_league_rewards, so that is forged
-- standings and forged rewards, not just a cosmetic number.
--
-- Notably the INSERT path was ALREADY defended: trigger
-- league_members_guard_insert forces weekly_xp := 0 and rank := NULL for
-- any caller that is not postgres/service_role. Whoever wrote that saw
-- the risk on insert and did not mirror it onto update. This finishes the
-- job using that same, already-proven pattern.
--
-- WHO ACTUALLY WRITES THIS TABLE (enumerated before changing anything)
--
--   distribute_league_rewards  SECURITY DEFINER
--   ensure_my_league           SECURITY DEFINER  (mig 242)
--   increment_league_xp        SECURITY DEFINER
--   record_monthly_xp          SECURITY DEFINER
--   get_friend_leaderboard     SECURITY DEFINER  (reads only)
--   _tg_sync_league_member_count  AFTER trigger, maintains leagues.member_count
--
-- Every one runs as the function owner (postgres) and therefore bypasses
-- RLS — none of them depends on the user-facing UPDATE policy. The only
-- client-side UPDATE in the codebase was the legacy non-atomic fallback in
-- recordWeeklyXp, reached solely when increment_league_xp is missing
-- (42883/42P01). That RPC is deployed, so the fallback was dead code; it
-- is removed in the same commit as this migration.
--
-- So: nothing legitimate needs the policy, and it is dropped rather than
-- narrowed. A capability removed cannot be misused.
--
-- Defence in depth: the guard trigger is added anyway, so that
-- re-introducing a permissive UPDATE policy later cannot silently reopen
-- the hole. It pins every trust-bearing column to its previous value for
-- non-privileged callers instead of raising, matching the insert guard's
-- quiet-clamp behaviour so a stray write degrades rather than errors.
--
-- SIBLING TABLE, CHECKED: public.leagues is already safe. authenticated
-- holds SELECT only (no INSERT/UPDATE/DELETE) and RLS carries a single
-- "leagues: read all" SELECT policy with no write policy at all, so a
-- client cannot flip is_resolved or edit tier/week. Two independent locks,
-- same as the 403 that led to migration 242. No change needed there.
--
-- Paste-safe: public.<table>, OLD./NEW., bare columns, and no bare
-- angle-bracket comparison operators in any statement body.

-- 1. Remove the capability.
DROP POLICY IF EXISTS "league_members: update own" ON public.league_members;

REVOKE UPDATE ON public.league_members FROM authenticated;

-- 2. Belt and braces: clamp protected columns for any non-privileged
--    caller, mirroring league_members_guard_insert.
CREATE OR REPLACE FUNCTION public.league_members_guard_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;
  -- A client may not move XP, rank, league membership or identity.
  NEW.weekly_xp  := OLD.weekly_xp;
  NEW.rank       := OLD.rank;
  NEW.league_id  := OLD.league_id;
  NEW.user_id    := OLD.user_id;
  NEW.user_email := OLD.user_email;
  NEW.joined_at  := OLD.joined_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS league_members_guard_update_tr ON public.league_members;
CREATE TRIGGER league_members_guard_update_tr
  BEFORE UPDATE ON public.league_members
  FOR EACH ROW
  EXECUTE FUNCTION public.league_members_guard_update();

NOTIFY pgrst, 'reload schema';
