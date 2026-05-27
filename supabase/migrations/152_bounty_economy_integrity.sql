-- 152_bounty_economy_integrity.sql
--
-- Closes a coin-minting exploit in the bounty economy (QA audit, pre-beta):
--
--   1. complete_bounty_claim credited the reward with ZERO server-side
--      verification — the "did you beat the target?" check ran only on the
--      client (checkAndCompleteBounty in bounties.js). A tampered client
--      could call the RPC directly and harvest reward coins doing no work.
--   2. The bounties_insert RLS allowed any authenticated client to INSERT a
--      bounty with an arbitrary `reward` (e.g. 999999) and trivial target,
--      then self-claim it — an unbounded mint.
--
-- After:
--   • complete_bounty_claim re-derives the achieved metric SERVER-SIDE from
--     the caller's own workout_log (exercises JSONB) and raises unless the
--     target was met. The proof log must belong to the caller.
--   • bounties_insert is bound to the standard difficulty tiers, so a direct
--     client insert can't set an off-scale reward. Server-side creation via
--     create_user_bounty (SECURITY DEFINER, mig 098) bypasses RLS and is
--     unaffected.
--
-- Paste-safe: scalar variables only, JSONB arrow operators (no dotted record
-- or alias.column tokens), schema-qualified names throughout. Same VOID
-- return + (UUID, UUID) signature as mig 059, so CREATE OR REPLACE is fine.

CREATE OR REPLACE FUNCTION public.complete_bounty_claim(
  p_claim_id       UUID,
  p_workout_log_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_claim_status TEXT;
  v_bounty_id    UUID;
  v_metric       TEXT;
  v_exercise     TEXT;
  v_target       NUMERIC;
  v_reward       INT;
  v_log_owner    UUID;
  v_exercises    JSONB;
  v_achieved     NUMERIC := 0;
  v_ex           JSONB;
  v_set          JSONB;
  v_w            NUMERIC;
  v_r            NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_workout_log_id IS NULL THEN
    RAISE EXCEPTION 'workout_log_required' USING ERRCODE = '22023';
  END IF;

  -- Lock the claim; must belong to the caller and still be active.
  SELECT status, bounty_id INTO v_claim_status, v_bounty_id
    FROM public.bounty_claims
   WHERE id = p_claim_id AND claimant_id = v_user_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim_not_found' USING ERRCODE = '22023'; END IF;
  IF v_claim_status <> 'active' THEN RAISE EXCEPTION 'claim_not_active' USING ERRCODE = '22023'; END IF;

  SELECT metric::text, exercise_name, target_value, reward
    INTO v_metric, v_exercise, v_target, v_reward
    FROM public.bounties WHERE id = v_bounty_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'bounty_not_found' USING ERRCODE = '22023'; END IF;

  -- The proof workout must be the caller's own log (no borrowing another
  -- user's log). Read its exercises JSONB to verify the target server-side.
  SELECT user_id, exercises INTO v_log_owner, v_exercises
    FROM public.workout_logs WHERE id = p_workout_log_id;
  IF NOT FOUND OR v_log_owner <> v_user_id THEN
    RAISE EXCEPTION 'invalid_workout_log' USING ERRCODE = '42501';
  END IF;

  -- Re-derive the achieved metric (mirrors checkAndCompleteBounty).
  IF v_metric IN ('session_volume', 'weekly_volume') THEN
    v_achieved := public._duel_calc_volume(v_exercises);
  ELSIF v_metric IN ('single_lift_weight', 'single_lift_reps')
        AND v_exercise IS NOT NULL
        AND jsonb_typeof(v_exercises) = 'array' THEN
    FOR v_ex IN SELECT * FROM jsonb_array_elements(v_exercises) LOOP
      IF lower(COALESCE(v_ex->>'name', '')) = lower(v_exercise)
         AND jsonb_typeof(v_ex->'sets') = 'array' THEN
        FOR v_set IN SELECT * FROM jsonb_array_elements(v_ex->'sets') LOOP
          v_w := COALESCE((v_set->>'weight')::NUMERIC, 0);
          v_r := COALESCE((v_set->>'reps')::NUMERIC, 0);
          IF v_metric = 'single_lift_weight' AND v_w > v_achieved THEN v_achieved := v_w; END IF;
          IF v_metric = 'single_lift_reps'   AND v_r > v_achieved THEN v_achieved := v_r; END IF;
        END LOOP;
      END IF;
    END LOOP;
  ELSE
    -- Unknown / unsupported metric → fail closed rather than pay out.
    RAISE EXCEPTION 'unsupported_metric' USING ERRCODE = '22023';
  END IF;

  IF v_achieved < v_target THEN
    RAISE EXCEPTION 'target_not_met' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bounty_claims
     SET status = 'completed', completed_at = NOW(), workout_log_id = p_workout_log_id
   WHERE id = p_claim_id;

  UPDATE public.user_profiles
     SET flex_coins = flex_coins + v_reward
   WHERE id = v_user_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.complete_bounty_claim(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_bounty_claim(UUID, UUID) TO authenticated;

-- Bind direct client inserts to the standard difficulty tiers so a tampered
-- client can't mint by inserting an off-scale reward. create_user_bounty
-- (SECURITY DEFINER) bypasses RLS and is unaffected; the demo generator uses
-- these same standard values so it still works.
DROP POLICY IF EXISTS "bounties_insert" ON public.bounties;
CREATE POLICY "bounties_insert"
  ON public.bounties FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL AND (
      (difficulty = 'easy'   AND entry_fee = 10 AND reward = 60)  OR
      (difficulty = 'medium' AND entry_fee = 15 AND reward = 100) OR
      (difficulty = 'hard'   AND entry_fee = 20 AND reward = 175)
    )
  );

NOTIFY pgrst, 'reload schema';
