-- 110_moderator_rpcs_search_path.sql
--
-- Hardening fix for mig 103_moderator_reports.
--
-- The four SECURITY DEFINER functions defined there
--   • is_app_admin(UUID)
--   • list_reports_for_admin(TEXT, INT)
--   • resolve_report(UUID, TEXT)
--   • delete_reported_content(UUID)
-- omit `SET search_path = public` in their definition.
--
-- For SECURITY DEFINER functions, Supabase's database linter and
-- the PostgreSQL security model both flag this as
-- `function_search_path_mutable`: a user with CREATE privilege on
-- a non-public schema could (in principle) shadow operators or
-- helper functions resolved by an unqualified name inside the
-- function body, and an admin invoking the SECURITY DEFINER
-- function would execute that shadowed code under elevated
-- privileges.
--
-- All other SECURITY DEFINER functions in this repo
-- (increment_flex_coins, claim_referral, notify_*_for, etc.) set
-- search_path = public explicitly. This brings the four moderator
-- RPCs in line with that house pattern.
--
-- ALTER FUNCTION SET is the minimum-touch fix — the function
-- body stays as written in mig 103. The setting is persisted on
-- the catalog row and applies to every invocation.

ALTER FUNCTION public.is_app_admin(UUID)
  SET search_path = public;

ALTER FUNCTION public.list_reports_for_admin(TEXT, INT)
  SET search_path = public;

ALTER FUNCTION public.resolve_report(UUID, TEXT)
  SET search_path = public;

ALTER FUNCTION public.delete_reported_content(UUID)
  SET search_path = public;

NOTIFY pgrst, 'reload schema';
