-- 214_regrant_anon_rls_predicate_fns.sql
--
-- Corrective follow-up to 213. That migration revoked anon EXECUTE from all
-- non-whitelisted public SECURITY DEFINER functions. Four of them are used as
-- RLS PREDICATES inside policies that apply TO public (which includes anon):
--   • is_blocked        — SELECT policies on hub_posts, hub_comments
--   • is_crew_member    — SELECT policies on crews, crew_members, crew_messages,
--                         crew_assigned_regimens (+ crew_messages INSERT)
--   • is_crew_admin     — crew_members / crew_messages / crews / crew_assigned_
--                         regimens write policies
--   • is_crew_moderator — crew_messages pin (UPDATE) policy
--
-- Postgres evaluates policy predicate functions as the QUERYING role, so that
-- role needs EXECUTE. With anon revoked, an anonymous SELECT against those
-- tables throws "permission denied for function" instead of returning rows.
-- Re-grant anon EXECUTE on exactly these four. Safe: each returns false when
-- auth.uid() is NULL (the anon case), so it cannot leak cross-user data — it
-- only lets the surrounding policy evaluate to its intended (empty) result.
--
-- These four will re-appear in the advisor's anon_security_definer_function_
-- executable list; that is expected and justified — RLS requires it.
--
-- Idempotent (GRANT is a no-op if already held). Paste-safe: single-table
-- catalog read, bare columns, identity signatures via oid::regprocedure.

DO $$
DECLARE
  v_sig text;
BEGIN
  FOR v_sig IN
    SELECT oid::regprocedure::text
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('is_blocked','is_crew_admin','is_crew_member','is_crew_moderator')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', v_sig);
  END LOOP;
END $$;
