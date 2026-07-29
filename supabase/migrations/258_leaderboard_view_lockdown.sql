-- 258_leaderboard_view_lockdown.sql
--
-- Fixes a data exposure introduced by migration 257.
--
-- 257 created public.leaderboard_eligible_profiles and tried to lock it
-- down with:
--
--     REVOKE ALL ON public.leaderboard_eligible_profiles FROM PUBLIC;
--     GRANT SELECT ON public.leaderboard_eligible_profiles TO authenticated;
--
-- That is not sufficient on this database. `PUBLIC` is the pseudo-role;
-- revoking from it does nothing about grants held explicitly by `anon` and
-- `authenticated`, and this project hands those out automatically on every
-- new object in the public schema (migration 085's ALTER DEFAULT PRIVILEGES
-- plus Supabase's own defaults). Those grants are applied at CREATE time, so
-- the REVOKE ran and then the roles kept their own separate grants.
--
-- Verified state after 257 landed:
--   • anon           had SELECT
--   • authenticated  had SELECT, INSERT, UPDATE, DELETE, TRUNCATE
--   • the view is owned by postgres and has no security_invoker option,
--     so it runs with the OWNER's rights and bypasses row-level security
--   • user_profiles has RLS enabled — which the view therefore defeats
--
-- Net effect: anyone holding the publishable anon key could read every
-- user's id, username, full name, avatar and lifetime XP / volume /
-- distance / achievement counts straight off PostgREST without logging in.
-- That is a strictly worse leak than the `email` column 257 set out to
-- remove.
--
-- The fix is to grant nothing at all. Both leaderboard RPCs are SECURITY
-- DEFINER and owned by postgres, so they read the view with the owner's
-- rights regardless of what anon/authenticated hold. The view never needed
-- to be reachable from PostgREST; 257's GRANT was cargo-culted from the
-- table pattern, where it is required.

REVOKE ALL ON public.leaderboard_eligible_profiles FROM PUBLIC;
REVOKE ALL ON public.leaderboard_eligible_profiles FROM anon;
REVOKE ALL ON public.leaderboard_eligible_profiles FROM authenticated;

-- Belt and braces: if a future migration re-grants SELECT by accident,
-- security_invoker makes the view enforce user_profiles' RLS as the CALLING
-- role instead of the owner's, so a stray grant leaks nothing on its own.
--
-- Checked before enabling this: user_profiles is owned by postgres and has
-- relforcerowsecurity = false, so the SECURITY DEFINER RPCs — which execute
-- as postgres — still bypass its policies and keep returning full boards.
-- If anyone later turns on FORCE ROW LEVEL SECURITY for user_profiles, the
-- leaderboards go empty and this line is why.
ALTER VIEW public.leaderboard_eligible_profiles SET (security_invoker = true);

-- NOTE: deliberately NOT touching ALTER DEFAULT PRIVILEGES here. Revoking
-- the schema-wide default from anon would silently change every future
-- table in public, and there are unauthenticated read paths in the app
-- (PublicProfile renders for logged-out visitors). Out of scope for a fix
-- to one view — but the same default WILL re-arm this view on any later
-- CREATE OR REPLACE VIEW, so re-run the REVOKEs above if you edit it.

NOTIFY pgrst, 'reload schema';
