-- 030_goal_complete_atomic.sql
--
-- Two related fixes:
--
-- 1. INCREMENT_FLEX_COINS RPC — atomic coin delta.
--    Several call sites still do read-modify-write on user_profiles.flex_coins
--    (capsules._addFlexCoins, league rewards, etc.). The new RPC lets all of
--    them call a single statement that's race-safe under SECURITY DEFINER.
--
-- 2. COMPLETE_GOAL RPC — idempotent goal completion.
--    `completeMutation` in goals/GoalsModal.jsx invoked the XP edge function
--    AND set status='completed' as two separate writes. A fast double-tap or
--    a stale `goals` array in GoalsAlmostComplete could fire the same
--    completion twice, double-crediting XP and double-incrementing the
--    GOAL_COMPLETED quest. The new RPC uses an atomic state transition —
--    only the FIRST caller flips status to completed; subsequent callers
--    get { already_completed: true } and the client knows to skip the XP
--    grant / quest progress.

-- ── Atomic flex_coins increment ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_flex_coins(p_delta INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_delta IS NULL OR p_delta = 0 THEN RETURN; END IF;
  -- Allow negative deltas (purchases, refunds). Clamp final value at 0
  -- so a race can't push the user's balance into the negative even if a
  -- bad caller passes a delta larger than their balance.
  UPDATE public.user_profiles
     SET flex_coins = GREATEST(0, COALESCE(flex_coins, 0) + p_delta)
   WHERE id = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_flex_coins(INTEGER) TO authenticated;

-- ── Idempotent goal completion ───────────────────────────────────────────────
-- Returns:
--   { completed: true,  goal_id }       — first caller; client should grant XP
--   { completed: false, already: true } — duplicate; client should skip rewards
CREATE OR REPLACE FUNCTION public.complete_goal(p_goal_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_email  TEXT := auth.email();
  v_row    RECORD;
BEGIN
  IF v_uid IS NULL OR v_email IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_goal_id IS NULL THEN
    RAISE EXCEPTION 'goal_id required' USING ERRCODE = '22023';
  END IF;

  -- Atomic state transition: only flip a row that is currently 'active'.
  -- RETURNING reports whether this caller was the one to flip it.
  UPDATE public.goals
     SET status = 'completed',
         completed_at = now()
   WHERE id = p_goal_id
     AND created_by = v_email
     AND status = 'active'
  RETURNING id INTO v_row;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object(
      'completed', false,
      'already',   true,
      'goal_id',   p_goal_id
    );
  END IF;

  RETURN jsonb_build_object(
    'completed', true,
    'goal_id',   p_goal_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_goal(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
