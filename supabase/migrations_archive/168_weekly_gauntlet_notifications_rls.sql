-- 168_weekly_gauntlet_notifications_rls.sql
--
-- Defense-in-depth: enable RLS on the dedup tracking table introduced
-- in migration 082. The table is already locked down with
-- `REVOKE ALL ON public.weekly_gauntlet_notifications FROM PUBLIC` and
-- a service_role-only GRANT, so direct client access is denied even
-- without RLS. But:
--
--   1. The default-privilege grant chain ALTER DEFAULT PRIVILEGES
--      added in migration 085 grants service_role on every new public
--      table — that's the right policy for OUR write path but it also
--      means a future role being added to the project could pick up
--      access via group inheritance. RLS is the per-row barrier that
--      survives any future GRANT regression.
--
--   2. The Supabase managed dashboard's "table editor" treats RLS-off
--      tables as openly readable and flags them in the security panel.
--      Enabling RLS here gets the row off that warning list without
--      changing what the SECURITY DEFINER fanout function in 082 can
--      do (it runs as the function owner, which bypasses RLS).
--
-- No policy is added — the table is meant to be invisible to clients.
-- With RLS on and no SELECT/INSERT/UPDATE/DELETE policy, every
-- non-bypassing role sees zero rows + cannot write. The SECURITY
-- DEFINER `advance_weekly_gauntlet_statuses()` function from
-- migration 082 keeps working because SECURITY DEFINER runs as the
-- function owner (postgres / service_role) which bypasses RLS.

ALTER TABLE public.weekly_gauntlet_notifications ENABLE ROW LEVEL SECURITY;

-- No CREATE POLICY — the absence of policies means RLS denies
-- everything to non-bypassing roles, which is the intent.

-- Reload PostgREST schema cache so the security configuration takes
-- effect immediately rather than waiting for the next schema poll.
NOTIFY pgrst, 'reload schema';
