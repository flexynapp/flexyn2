-- 085_service_role_grants_audit.sql
--
-- Grants service_role table-level DML on every RLS-enabled public table
-- that's missing it. Closes the same bug class as migration 080 — where
-- push_subscriptions had RLS enabled for authenticated users but no
-- explicit GRANT for service_role, so the send-push Edge Function 500'd
-- with 42501.
--
-- BACKGROUND
-- ──────────
-- service_role bypasses RLS at the POLICY layer but still needs SELECT/
-- INSERT/UPDATE/DELETE on the table itself. Many of the older migrations
-- (pre-080) created RLS-enabled tables with only `GRANT … TO authenticated`
-- and never explicitly granted service_role, on the assumption that
-- service_role's superuser-like nature would cover it. It doesn't —
-- table-level GRANT is independent of role attributes for non-superusers.
--
-- The audit script supabase/migrations/_audit_schema_drift.sql returned
-- one row per affected table. Rather than hardcode the list (which goes
-- stale the moment someone adds a new RLS table), we dynamically iterate
-- over pg_class to find every public.* table with RLS enabled, then
-- GRANT to service_role if not already granted.
--
-- USAGE_GRANT for the schema is included for safety — without it the
-- table-level grants are unreachable. (Already granted on most Supabase
-- setups, but idempotent re-grant is harmless.)
--
-- IDEMPOTENT: re-running this migration after new tables are added picks
-- them up automatically. Existing grants are no-ops (GRANT is naturally
-- idempotent).

DO $$
DECLARE
  v_table TEXT;
  v_count INT := 0;
BEGIN
  -- Ensure service_role can reach the schema.
  GRANT USAGE ON SCHEMA public TO service_role;

  -- Iterate over every RLS-enabled public table and grant service_role
  -- the four DML privileges. We deliberately do NOT grant on tables
  -- without RLS — those are either lookup tables open to everyone (no
  -- additional grant needed) or intentionally locked down at the column
  -- level (a blanket grant would be too broad).
  FOR v_table IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relrowsecurity = true
     ORDER BY c.relname
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role',
      v_table
    );
    v_count := v_count + 1;
  END LOOP;

  -- Also grant sequence usage — many of these tables have bigint id
  -- columns backed by sequences (likes_count, etc.) and service_role
  -- inserts need to draw from them.
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

  -- And EXECUTE on every public function so Edge Functions running as
  -- service_role can call our SECURITY DEFINER helpers without per-
  -- function GRANTs sprinkled across 80 migrations.
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

  RAISE NOTICE '[085] granted service_role on % RLS-enabled public tables', v_count;
END $$;

-- Make future tables auto-grant. ALTER DEFAULT PRIVILEGES means any
-- table created in public after this migration runs will get service_role
-- DML automatically — closes the regression where someone adds a new
-- RLS table and forgets the grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;

NOTIFY pgrst, 'reload schema';
