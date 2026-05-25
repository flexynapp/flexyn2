-- 148_rls_gaps_blocking_user_flows.sql
--
-- Three user-facing flows are silently RLS-blocked in production today
-- (see audit-findings/06-rls-coverage.md), plus two monthly-league
-- economy-bypass policies. All idempotent and DO-block-guarded so
-- safe to re-apply.
--
-- ─────────────────────────────────────────────────────────────────────
-- FIX 1 (HIGH) — cycle_logs editing fails silently
-- ─────────────────────────────────────────────────────────────────────
-- Before: mig 128 created policies for SELECT / INSERT / DELETE only,
-- and granted SELECT / INSERT / DELETE. The client's updateLog()
-- (src/lib/data/cycleLogs.js:50-58) calls .update(patch) — silently
-- RLS-blocked. Editing a logged period appears to succeed in the UI
-- but no row is touched. Users lose data.
--
-- After: add owner-only UPDATE policy + grant UPDATE.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cycle_logs') THEN
    -- Drop in case a partial earlier apply left a stub policy.
    DROP POLICY IF EXISTS "cycle_logs: update own" ON public.cycle_logs;
    CREATE POLICY "cycle_logs: update own"
      ON public.cycle_logs FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
    GRANT UPDATE ON public.cycle_logs TO authenticated;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- FIX 2 (HIGH) — gym verification queue admin actions
-- ─────────────────────────────────────────────────────────────────────
-- Before: mig 135 grants only SELECT / INSERT on gym_verification_queue.
-- The admin queue uses .select('*').eq('status','pending') directly,
-- but the only SELECT policy is "read own" — so admins see ZERO rows
-- in the queue, since most pending submissions aren't theirs.
-- The reject button does .update({status:'rejected'}) but there's no
-- UPDATE policy or grant — silently blocked.
--
-- After: add two SECURITY DEFINER RPCs gated on is_app_admin(auth.uid()):
--   list_pending_gym_verifications() — replaces the direct select
--   reject_gym_verification(p_id, p_reason)  — replaces the direct update
-- The client is updated in a follow-up commit; until then, this is
-- additive (existing routes still work, just return empty / silently
-- fail as before).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='gym_verification_queue') THEN

    -- Add status_reason column for the reject reason if not present.
    EXECUTE 'ALTER TABLE public.gym_verification_queue ADD COLUMN IF NOT EXISTS rejection_reason TEXT';

    -- list_pending_gym_verifications: admin reader
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.list_pending_gym_verifications(p_limit INT DEFAULT 50)
      RETURNS SETOF public.gym_verification_queue
      LANGUAGE plpgsql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $fn$
      BEGIN
        IF NOT public.is_app_admin(auth.uid()) THEN
          RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
        END IF;
        RETURN QUERY
          SELECT * FROM public.gym_verification_queue
           WHERE status = 'pending'
           ORDER BY created_at ASC
           LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
      END;
      $fn$;

      REVOKE ALL    ON FUNCTION public.list_pending_gym_verifications(INT) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.list_pending_gym_verifications(INT) TO authenticated;
    $body$;

    -- reject_gym_verification: admin write
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.reject_gym_verification(p_id UUID, p_reason TEXT DEFAULT NULL)
      RETURNS VOID
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $fn$
      BEGIN
        IF NOT public.is_app_admin(auth.uid()) THEN
          RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
        END IF;
        UPDATE public.gym_verification_queue
           SET status           = 'rejected',
               rejection_reason = NULLIF(btrim(coalesce(p_reason, '')), '')
         WHERE id = p_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'verification_not_found' USING ERRCODE = 'P0002';
        END IF;
      END;
      $fn$;

      REVOKE ALL    ON FUNCTION public.reject_gym_verification(UUID, TEXT) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.reject_gym_verification(UUID, TEXT) TO authenticated;
    $body$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- FIX 3 (MEDIUM) — monthly_leagues / monthly_league_members open writes
-- ─────────────────────────────────────────────────────────────────────
-- Before: mig 132 created INSERT policy WITH CHECK (true) on
-- monthly_leagues and a FOR ALL policy on monthly_league_members
-- gated only on user_id = auth.uid(). That meant any authenticated user
-- could INSERT into either table directly, bypassing the 5000/call cap
-- that mig 147 enforces in record_monthly_xp.
--
-- After: drop the broad client policies; rely on record_monthly_xp
-- (SECURITY DEFINER, runs as postgres) for all writes. Service role
-- always bypasses, so cron-driven monthly rollover keeps working.
-- The reads (SELECT) stay open so leaderboards still render.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='monthly_leagues') THEN
    -- Drop the broad client write policies. Names may vary by what
    -- mig 132 actually created; cover the likely names.
    DROP POLICY IF EXISTS "monthly_leagues: insert"           ON public.monthly_leagues;
    DROP POLICY IF EXISTS "monthly_leagues: client insert"    ON public.monthly_leagues;
    DROP POLICY IF EXISTS "monthly_leagues: update"           ON public.monthly_leagues;
    DROP POLICY IF EXISTS "monthly_leagues: client update"    ON public.monthly_leagues;
    -- Revoke the bulk grants. Reads stay (separate GRANT below).
    REVOKE INSERT, UPDATE, DELETE ON public.monthly_leagues FROM authenticated;
    -- Make sure SELECT still works for the leaderboard.
    GRANT  SELECT ON public.monthly_leagues TO authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='monthly_league_members') THEN
    DROP POLICY IF EXISTS "monthly_lm: write"                 ON public.monthly_league_members;
    DROP POLICY IF EXISTS "monthly_league_members: write"     ON public.monthly_league_members;
    DROP POLICY IF EXISTS "monthly_league_members: insert"    ON public.monthly_league_members;
    DROP POLICY IF EXISTS "monthly_league_members: update"    ON public.monthly_league_members;
    REVOKE INSERT, UPDATE, DELETE ON public.monthly_league_members FROM authenticated;
    GRANT  SELECT ON public.monthly_league_members TO authenticated;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
