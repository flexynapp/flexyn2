-- 142_workout_idempotency_reconcile_and_bar_volume.sql
--
-- Three workout-tab integrity upgrades surfaced by the May 2026
-- zero-tolerance audit:
--
-- C-2: Idempotency key on workout_logs. Stops double-tap / network-
--      retry from inserting the same workout twice + double-crediting
--      XP / volume / streak / leagues / crew wars.
--
-- D-4: Per-row credit tracking + reconciliation RPC. When the network
--      drops after the workout INSERT but BEFORE increment_user_volume
--      lands, the workout is saved but counters silently undercount.
--      A Dashboard-mount reconcile pass detects un-credited rows and
--      replays the volume increment.
--
-- C-3: User-profile toggle for "include bar weight in volume."
--      Default off so historical totals stay comparable; opt-in users
--      get a more accurate weight-moved number on barbell exercises.
--
-- All changes are idempotent — re-running the bundle is safe.

-- ── 1. Idempotency + credit tracking columns ───────────────────────
ALTER TABLE public.workout_logs
  ADD COLUMN IF NOT EXISTS idempotency_key    UUID;
ALTER TABLE public.workout_logs
  ADD COLUMN IF NOT EXISTS volume_credited_at TIMESTAMPTZ;

-- Partial unique index — only enforces uniqueness when both user_id
-- and idempotency_key are present, so pre-feature rows (NULL key)
-- aren't blocked from coexisting.
CREATE UNIQUE INDEX IF NOT EXISTS workout_logs_idempotency_idx
  ON public.workout_logs (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Index for the reconcile RPC's filter — recent un-credited rows.
CREATE INDEX IF NOT EXISTS workout_logs_uncredited_idx
  ON public.workout_logs (user_id, created_at)
  WHERE volume_credited_at IS NULL;

-- ── 2. Mark-credited RPC ────────────────────────────────────────────
-- Caller asserts that the volume for this workout has been applied
-- to user_profiles.total_volume_lbs. Idempotent: re-calls are no-ops.
CREATE OR REPLACE FUNCTION public.mark_workout_volume_credited(
  p_workout_log_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.workout_logs
     SET volume_credited_at = COALESCE(volume_credited_at, now())
   WHERE id = p_workout_log_id
     AND user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.mark_workout_volume_credited(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_workout_volume_credited(UUID) TO authenticated;

-- ── 3. Reconciliation RPC ───────────────────────────────────────────
-- Scans the caller's recent (last 7 days) workout_logs where
-- volume_credited_at IS NULL AND total_volume > 0, sums the deltas,
-- applies them via increment_user_volume, and marks the rows credited.
-- Returns the number of workouts reconciled + the total volume
-- recovered, so the client can surface a transparent toast if the
-- result is non-trivial.
CREATE OR REPLACE FUNCTION public.reconcile_my_workout_volume()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_total_delta NUMERIC := 0;
  v_count       INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(COALESCE(total_volume, 0)), 0)::NUMERIC, COUNT(*)
    INTO v_total_delta, v_count
    FROM public.workout_logs
   WHERE user_id = v_uid
     AND volume_credited_at IS NULL
     AND COALESCE(total_volume, 0) > 0
     AND created_at > now() - INTERVAL '7 days';

  IF v_count = 0 THEN
    RETURN jsonb_build_object('reconciled', 0, 'delta', 0);
  END IF;

  -- Atomic credit via the existing increment RPC (mig 023 / 032).
  PERFORM public.increment_user_volume(v_total_delta);

  -- Mark all the rows we just credited. Same WHERE clause so we
  -- don't accidentally re-mark rows that were credited during our
  -- own SUM (unlikely but defensive).
  UPDATE public.workout_logs
     SET volume_credited_at = now()
   WHERE user_id = v_uid
     AND volume_credited_at IS NULL
     AND COALESCE(total_volume, 0) > 0
     AND created_at > now() - INTERVAL '7 days';

  RETURN jsonb_build_object(
    'reconciled', v_count,
    'delta',      v_total_delta
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_my_workout_volume() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_my_workout_volume() TO authenticated;

-- ── 4. User-profile setting for bar-weight volume math ─────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS include_bar_in_volume BOOLEAN NOT NULL DEFAULT FALSE;

-- Service role grant for any future server-side reads.
GRANT SELECT, UPDATE (include_bar_in_volume) ON public.user_profiles TO authenticated;

NOTIFY pgrst, 'reload schema';
