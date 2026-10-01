-- Fresh-database replay fix. Production skips this file (it is older than
-- production's newest migration) and is already in the state it produces.
--
-- In production, anon holds no privilege on public.public_profiles. The
-- baseline dump does not say so: it only GRANTs to authenticated and
-- service_role, and a fresh Supabase database gives anon ALL on every new
-- view through the platform's default privileges, which run before the
-- baseline's own ALTER DEFAULT PRIVILEGES lines. So on a preview branch anon
-- could read the view, and 20260927162000's probe ("anon can read
-- public_profiles") stopped the replay there, failing every migration PR's
-- preview. This brings a fresh database in line with production before that
-- probe runs.

REVOKE ALL ON public.public_profiles FROM anon;
