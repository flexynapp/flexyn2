-- Migration 293: make guest accounts work, and restore goal completion
--
-- Two fixes. The second was found by testing the first.
--
-- ── 1. goals.completed_at has never existed ──────────────────────────────
--
-- Migration 030 created complete_goal() with:
--     UPDATE public.goals SET status='completed', completed_at=now() ...
-- and no migration has ever added that column. plpgsql plans a statement on
-- first execution, not at CREATE time, so the function was accepted and has
-- thrown 42703 for every caller since the day it shipped.
--
-- Verified against production as the real owner of a real active goal:
--     SQLSTATE 42703 — column "completed_at" of relation "goals" does not exist
--
-- It fails at plan time, before the WHERE is evaluated, so ownership and
-- status are irrelevant — nobody has ever completed a goal through this RPC.
-- Both call sites (GoalsModal, GoalsAlmostComplete) only fall back to the
-- legacy direct UPDATE on 42883/42P01 ("RPC missing"); 42703 hits their
-- `throw error` branch, so the whole completion flow rejects.
--
-- The column is added rather than the assignment removed, because two
-- independent code paths want it: this RPC, and CardioGoals.jsx which writes
-- completed_at on its own goal update (silently dropped today by db.js's
-- strip-and-retry on 42703).
--
-- Historical completed goals are left NULL rather than backfilled from
-- updated_at. NULL honestly means "we don't know when"; a timestamp copied
-- from an unrelated column would be a fabricated completion date.
--
-- ── 2. Guest accounts are locked out of the app ──────────────────────────
--
-- auth.email() reads a JWT claim. Anonymous sign-in tokens carry no email
-- claim, so it is NULL for every guest — while migration 172 writes a
-- guest_<uuid>@flexyn.guest placeholder into user_profiles.email, which is
-- what the rest of the email-keyed model matches on. The two identity
-- sources disagree precisely for these users.
--
-- 20 such accounts exist, all with the placeholder populated. 32 policies
-- across 21 tables and 18 SECURITY DEFINER functions gate on auth.email(),
-- and they are the core ones: workout_logs, goals, body_metrics,
-- cardio_logs, nutrition_logs, regimens, hub_posts, hub_follows,
-- hub_messages. A guest could not log a workout, set a goal, log food, post,
-- follow, or DM. Verified before/after in a rolled-back transaction: a guest
-- INSERT into goals went from "new row violates row-level security policy"
-- to ALLOWED.
--
-- public.current_user_email() already existed for exactly this —
-- COALESCE(auth.email(), user_profiles.email for auth.uid()) — and 7
-- functions already used it. It had never reached the policy layer.
--
-- WHY NULLIF: current_user_email() returns '' where auth.email() returns
-- NULL. A bare swap would turn `IF v_email IS NULL THEN RAISE 'unauthenticated'`
-- into a check that never fires. NULLIF(..., '') restores exact NULL
-- semantics, so this is a true drop-in at every site.
--
-- The rewrite is done by a loop over the catalog rather than 50 hand-written
-- objects: each policy and function is re-created from its own current
-- definition with only that one token substituted. Nothing else can drift,
-- and there is no opportunity to typo someone out of their own data.
--
-- Idempotent: after one run nothing matches auth.email() any more, so a
-- second run is a no-op. Safe to re-run.
--
-- NOT changed, deliberately: current_user_email() itself, which must keep
-- calling auth.email() as its first choice.

-- ── 1 ────────────────────────────────────────────────────────────────────
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- ── 2a. policies ─────────────────────────────────────────────────────────
DO $mig_policies$
DECLARE
  r        RECORD;
  v_repl   CONSTANT text := 'NULLIF(public.current_user_email(), ' || chr(39) || chr(39) || ')';
  v_cmd    text;
  v_roles  text;
  v_sql    text;
  v_n      integer := 0;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, pol.polname AS nm, pol.polcmd AS cmd,
           pg_get_expr(pol.polqual, pol.polrelid)      AS q,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS w,
           (SELECT string_agg(quote_ident(rolname), ', ')
              FROM pg_roles WHERE oid = ANY(pol.polroles)) AS roles
    FROM pg_policy pol
    JOIN pg_class c     ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '')
        || COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) ~* 'auth\.email\(\)'
  LOOP
    v_cmd := CASE r.cmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                        WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END;
    v_roles := COALESCE(r.roles, 'PUBLIC');

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.nm, r.tbl);

    v_sql := format('CREATE POLICY %I ON public.%I FOR %s TO %s', r.nm, r.tbl, v_cmd, v_roles);
    IF r.q IS NOT NULL THEN
      v_sql := v_sql || ' USING (' || replace(r.q, 'auth.email()', v_repl) || ')';
    END IF;
    IF r.w IS NOT NULL THEN
      v_sql := v_sql || ' WITH CHECK (' || replace(r.w, 'auth.email()', v_repl) || ')';
    END IF;
    EXECUTE v_sql;
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'migration 293: rewrote % policies', v_n;
END
$mig_policies$;

-- ── 2b. functions ────────────────────────────────────────────────────────
DO $mig_functions$
DECLARE
  r      RECORD;
  v_repl CONSTANT text := 'NULLIF(public.current_user_email(), ' || chr(39) || chr(39) || ')';
  v_n    integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname <> 'current_user_email'
      AND pg_get_functiondef(p.oid) ~* 'auth\.email\(\)'
  LOOP
    EXECUTE replace(pg_get_functiondef(r.oid), 'auth.email()', v_repl);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'migration 293: rewrote % functions', v_n;
END
$mig_functions$;
