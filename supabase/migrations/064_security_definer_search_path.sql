-- Migration 061 — Harden SECURITY DEFINER helpers with explicit search_path
--
-- SECURITY DEFINER functions run with the privileges of their owner
-- (typically the database superuser created by Supabase). Without an
-- explicit `search_path`, an attacker who can create objects in any
-- schema on the path can shadow built-in functions/types and hijack
-- the call. Postgres docs are explicit about this — every SECURITY
-- DEFINER function should pin `search_path` to schemas the caller
-- doesn't control.
--
-- Three functions shipped without the clause:
--   - public.is_crew_member(uuid)     — migration 048
--   - public.is_crew_admin(uuid)      — migration 048
--   - public.perform_prestige(uuid)   — migration 057
--
-- ALTER FUNCTION ... SET is idempotent (re-applying produces the same
-- final state) so this migration is safe to re-run on a partially-
-- applied environment. We don't recreate the function bodies — that
-- would risk diverging from whatever the running definition is.

ALTER FUNCTION public.is_crew_member(uuid)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.is_crew_admin(uuid)
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.perform_prestige(uuid)
  SET search_path = public, pg_catalog;
