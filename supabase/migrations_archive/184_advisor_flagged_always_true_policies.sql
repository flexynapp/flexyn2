-- Migration 184: close the always-true RLS policies the prod advisors flag
--
-- The Supabase security advisors (run live 2026-06-10) still report these
-- `rls_policy_always_true` findings, which means migrations 147/148 — that
-- were meant to fix the monthly-league writes — are NOT deployed to prod
-- (and 147/148 contain alias.column tokens that mangle on mobile paste,
-- the likely reason they never ran). Rather than depend on re-pasting
-- those large files, this migration closes the flagged holes directly and
-- paste-safely. It is idempotent and harmless to run even if 147/148 do
-- later land.
--
-- Flagged policies (exact names from the advisor):
--   • leagues          — "leagues: insert authenticated"            (INSERT WITH CHECK true)
--   • monthly_leagues  — "monthly_leagues: insert authenticated"    (INSERT WITH CHECK true)
--   • monthly_leagues  — "monthly_leagues: update authenticated"    (UPDATE USING/CHECK true)
--   • weekly_debriefs  — "Service role can insert/update debriefs"  (ALL true, no TO role → applies to authenticated)
--   • weekly_debriefs  — "weekly_debriefs_service_role_all"         (ALL true, no TO role → applies to authenticated)
--
-- Legitimate writes to all three tables go through SECURITY DEFINER RPCs
-- / crons (record_monthly_xp, distribute_league_rewards,
-- generate_my_weekly_debrief) which run as postgres and are unaffected by
-- revoking the authenticated client's direct write. Owner SELECT policies
-- (weekly_debriefs_select_own, league read policies) remain, so reads keep
-- working. Paste-safe: no alias.column / record .id tokens.

-- ── leagues ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "leagues: insert authenticated" ON public.leagues;
REVOKE INSERT, UPDATE, DELETE ON public.leagues FROM authenticated;
GRANT  SELECT ON public.leagues TO authenticated;

-- ── monthly_leagues ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "monthly_leagues: insert authenticated" ON public.monthly_leagues;
DROP POLICY IF EXISTS "monthly_leagues: update authenticated" ON public.monthly_leagues;
REVOKE INSERT, UPDATE, DELETE ON public.monthly_leagues FROM authenticated;
GRANT  SELECT ON public.monthly_leagues TO authenticated;

-- ── weekly_debriefs ──────────────────────────────────────────────────────────
-- Drop the two unscoped ALL policies that OR open the table to
-- authenticated, then re-add a single one correctly scoped to service_role
-- (the debrief cron / Edge Function). Owner SELECT stays via
-- weekly_debriefs_select_own (mig 051).
DROP POLICY IF EXISTS "Service role can insert/update debriefs" ON public.weekly_debriefs;
DROP POLICY IF EXISTS "weekly_debriefs_service_role_all"        ON public.weekly_debriefs;

CREATE POLICY "weekly_debriefs: service role writes"
  ON public.weekly_debriefs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE INSERT, UPDATE, DELETE ON public.weekly_debriefs FROM authenticated;

NOTIFY pgrst, 'reload schema';
