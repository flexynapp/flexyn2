-- 213_revoke_anon_execute_secdef.sql
--
-- Hardening: strip anonymous EXECUTE from SECURITY DEFINER functions.
--
-- The Supabase security advisor flagged 85 public SECURITY DEFINER functions
-- as executable by the `anon` role (anon_security_definer_function_executable).
-- Root cause: the early Base44-era migrations 003-006 ran a blanket
--   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;
-- and every function created since inherits anon EXECUTE via Postgres' default
-- PUBLIC grant. SECURITY DEFINER functions bypass RLS, so anon reachability is
-- the risky surface even though almost all of them internally gate on
-- auth.uid() (NULL for anon) — this closes the hole as defense-in-depth.
--
-- Why REVOKE FROM anon alone is NOT enough: for functions created after 006,
-- anon holds EXECUTE via the default grant to PUBLIC, not via an explicit anon
-- grant. So we must REVOKE FROM PUBLIC too — but that would also strip the
-- `authenticated` / `service_role` access those functions rely on. We therefore
-- capture each function's CURRENT authenticated + service_role privilege and
-- re-grant it explicitly, so the only net change is: anon loses EXECUTE.
--
-- Kept anon-callable (intentional public surface, explicitly granted TO anon in
-- their own migrations — 072/142/195/206):
--   get_public_profile_by_username, get_pending_duel_invite_public,
--   get_gym_vs_gym_leaderboard, resolve_profile_email
-- (resolve_profile_email returns email to anon one row at a time; it's the
-- documented single-row accessor from mig 195 and its removal is bound to the
-- tracked email-off-public_profiles refactor — left as-is here on purpose.)
--
-- Internal `_`-prefixed SECURITY DEFINER helpers (e.g. _crew_member_week_stats
-- from mig 212) currently have NO caller grants and are reached only from
-- within other definer functions as the owner — they have authenticated=false,
-- so the preserve-current logic below correctly leaves them owner-only while
-- still stripping anon/PUBLIC.
--
-- Idempotent: GRANT is a no-op if already held; REVOKE is a no-op if already
-- absent. Safe to re-run. Paste-safe: single-table catalog reads, bare columns
-- (oid/proname/pronamespace/prosecdef), no alias.column tokens; identity
-- signatures come from oid::regprocedure so REVOKE/GRANT target the exact
-- overload.

DO $$
DECLARE
  v_sig     text;
  v_authed  boolean;
  v_service boolean;
BEGIN
  FOR v_sig, v_authed, v_service IN
    SELECT oid::regprocedure::text,
           has_function_privilege('authenticated', oid, 'EXECUTE'),
           has_function_privilege('service_role',  oid, 'EXECUTE')
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND prosecdef
      AND proname NOT IN (
        'get_public_profile_by_username',
        'get_pending_duel_invite_public',
        'get_gym_vs_gym_leaderboard',
        'resolve_profile_email'
      )
  LOOP
    -- Preserve current trusted-role access explicitly before dropping PUBLIC.
    IF v_authed THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
    END IF;
    IF v_service THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);
    END IF;
    -- Remove anon: the explicit 003-006 role grant AND the default PUBLIC grant.
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', v_sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon',   v_sig);
  END LOOP;
END $$;
