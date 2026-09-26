-- 192_economy_rpc_hardening.sql
--
-- Closes three economy holes found by the pre-launch security audit
-- (2026-07-12). All three verified LIVE against prod via pg_proc before
-- writing this. Each fix re-emits the function with the SAME signature so
-- existing clients keep working unchanged.
--
--   FIX 1 (CRITICAL) grant_level_up_rewards(p_new_level) trusted the
--     client-supplied level outright. The CAS on
--     level_capsules_awarded_through only prevents RE-granting a range —
--     it does not bound the FIRST call, so any authenticated user
--     (including anonymous guests) could call p_new_level=99 and mint the
--     whole ladder: ~98 standard / ~19 premium / ~9 elite capsules plus
--     ~6,800 flex_coins in one call. The mig-176 mint guard doesn't apply
--     (it lives inside increment_flex_coins; this function updates
--     flex_coins directly, which the 142/173 trigger allows for definer
--     functions). Fix: clamp p_new_level to the server-maintained
--     user_profiles.current_level (RPC-only since mig 173; written by
--     increment_user_xp — verified in prod). Legit flow is unaffected:
--     the client calls this AFTER increment_user_xp has already advanced
--     current_level, and the gap-granting loop back-fills any level a
--     race might defer.
--
--   FIX 2 (MEDIUM) update_solo_challenge_progress accepted client-typed
--     progress numbers (p_volume_lbs etc.) and added them to claims —
--     the "server-side gate" in complete_solo_challenge compares against
--     a value the client fully controls, so every solo-challenge reward
--     was claimable with zero workouts. Fix: derive progress from the
--     caller's own rows in workout_logs / cardio_logs since the claim
--     started, and ignore the client numbers (parameters kept only for
--     signature compatibility). 'beat_any_pr' has no server-side PR
--     table, so the client signal is kept but clamped to the number of
--     workouts logged since the claim — you can't report more PRs than
--     sessions.
--
--   FIX 3 (LOW) claim_crew_xp_fuel(p_message_id, p_xp) never verified the
--     message: any fresh UUID yielded a claim (XP capped at 1000/call and
--     by mig 188's daily ledger, so farming-grade, not leaderboard-
--     breaking). Fix: the message must exist, be message_type='xp_fuel',
--     and belong to a crew the caller is a member of.
--
-- Paste-safe per repo convention: public.<table>, auth.<fn>(), bare
-- columns in single-table statements, scalar SELECT ... INTO, no
-- alias.column or record-dotted tokens.

-- ── FIX 1: grant_level_up_rewards — clamp to server-maintained level ──

CREATE OR REPLACE FUNCTION public.grant_level_up_rewards(p_new_level INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid             UUID := auth.uid();
  v_email           TEXT;
  v_prev_through    INT;
  v_level_cap       INT;
  v_lvl             INT;
  v_standard_count  INT := 0;
  v_premium_count   INT := 0;
  v_elite_count     INT := 0;
  v_coins_total     INT := 0;
  v_new_balance     INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_new_level IS NULL OR p_new_level < 1 THEN
    RAISE EXCEPTION 'invalid level' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(level_capsules_awarded_through, 0),
         email,
         GREATEST(COALESCE(current_level, 1), 1)
    INTO v_prev_through, v_email, v_level_cap
    FROM public.user_profiles
   WHERE id = v_uid
   FOR UPDATE;

  -- THE FIX — never grant past the level the server itself computed.
  -- current_level is RPC-only (mig 173) and maintained by
  -- increment_user_xp, so it cannot be inflated from the client.
  IF p_new_level > v_level_cap THEN
    p_new_level := v_level_cap;
  END IF;

  -- Atomic CAS — only the FIRST caller advances the counter.
  UPDATE public.user_profiles
     SET level_capsules_awarded_through = p_new_level
   WHERE id = v_uid
     AND COALESCE(level_capsules_awarded_through, 0) = v_prev_through
     AND v_prev_through < p_new_level;

  IF NOT FOUND THEN
    SELECT flex_coins INTO v_new_balance
      FROM public.user_profiles WHERE id = v_uid;
    RETURN jsonb_build_object(
      'already_granted', TRUE,
      'awarded_through', v_prev_through,
      'standard',        0,
      'premium',         0,
      'elite',           0,
      'coins',           0,
      'new_balance',     COALESCE(v_new_balance, 0)
    );
  END IF;

  -- Grant the gap. Level 1 is intentionally skipped: the welcome
  -- capsule already covers it.
  FOR v_lvl IN GREATEST(v_prev_through + 1, 2) .. p_new_level LOOP
    INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
      VALUES (v_uid, v_email, 'standard');
    v_standard_count := v_standard_count + 1;
    v_coins_total := v_coins_total + 50;

    IF v_lvl % 5 = 0 THEN
      INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
        VALUES (v_uid, v_email, 'premium');
      v_premium_count := v_premium_count + 1;
      v_coins_total := v_coins_total + 100;
    END IF;

    IF v_lvl % 10 = 0 THEN
      INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
        VALUES (v_uid, v_email, 'elite');
      v_elite_count := v_elite_count + 1;
    END IF;
  END LOOP;

  UPDATE public.user_profiles
     SET flex_coins = COALESCE(flex_coins, 0) + v_coins_total
   WHERE id = v_uid
  RETURNING flex_coins INTO v_new_balance;

  RETURN jsonb_build_object(
    'already_granted', FALSE,
    'awarded_through', p_new_level,
    'standard',        v_standard_count,
    'premium',         v_premium_count,
    'elite',           v_elite_count,
    'coins',           v_coins_total,
    'new_balance',     COALESCE(v_new_balance, 0)
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.grant_level_up_rewards(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_level_up_rewards(INT) TO authenticated;

-- ── FIX 2: update_solo_challenge_progress — derive from server data ──

CREATE OR REPLACE FUNCTION public.update_solo_challenge_progress(
  p_volume_lbs    NUMERIC DEFAULT 0,
  p_session_count INT     DEFAULT 0,
  p_cardio_min    INT     DEFAULT 0,
  p_prs_hit       INT     DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_claim_id   UUID;
  v_chall_id   UUID;
  v_current    NUMERIC;
  v_claimed_at TIMESTAMPTZ;
  v_kind       TEXT;
  v_target     NUMERIC;
  v_derived    NUMERIC;
  v_sessions   INT;
  v_new        NUMERIC;
  v_bumped     INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  FOR v_claim_id, v_chall_id, v_current, v_claimed_at IN
    SELECT id, challenge_id, progress, claimed_at
      FROM public.solo_challenge_claims
     WHERE user_id = v_uid
       AND status  = 'active'
  LOOP
    SELECT kind, target_value
      INTO v_kind, v_target
      FROM public.solo_challenges
     WHERE id = v_chall_id
       AND is_active = TRUE
       AND expires_at > NOW();

    IF NOT FOUND THEN CONTINUE; END IF;

    -- Recompute from the caller's own log rows since the claim was
    -- opened. The p_* parameters are intentionally ignored (kept only
    -- so existing clients calling this signature keep working).
    IF v_kind = 'weekly_volume' THEN
      SELECT COALESCE(SUM(total_volume), 0)
        INTO v_derived
        FROM public.workout_logs
       WHERE user_id = v_uid
         AND created_at >= v_claimed_at;
    ELSIF v_kind = 'workout_count' THEN
      SELECT COUNT(*)::numeric
        INTO v_derived
        FROM public.workout_logs
       WHERE user_id = v_uid
         AND created_at >= v_claimed_at;
    ELSIF v_kind = 'cardio_minutes' THEN
      SELECT COALESCE(SUM(duration_min), 0)
        INTO v_derived
        FROM public.cardio_logs
       WHERE user_id = v_uid
         AND created_at >= v_claimed_at;
    ELSIF v_kind = 'beat_any_pr' THEN
      -- No server-side PR table exists; keep the client signal but
      -- bound it: you cannot have hit more PRs than workouts logged
      -- since the claim opened.
      SELECT COUNT(*)::int
        INTO v_sessions
        FROM public.workout_logs
       WHERE user_id = v_uid
         AND created_at >= v_claimed_at;
      v_derived := LEAST(v_current + GREATEST(COALESCE(p_prs_hit, 0), 0), v_sessions);
    ELSE
      v_derived := v_current;
    END IF;

    -- Progress is monotonic and capped at target.
    v_new := LEAST(v_target, GREATEST(v_current, COALESCE(v_derived, 0)));
    IF v_new > v_current THEN
      UPDATE public.solo_challenge_claims
         SET progress = v_new
       WHERE id = v_claim_id;
      v_bumped := v_bumped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('claims_updated', v_bumped);
END;
$$;

REVOKE ALL    ON FUNCTION public.update_solo_challenge_progress(NUMERIC, INT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_solo_challenge_progress(NUMERIC, INT, INT, INT) TO authenticated;

-- ── FIX 3: claim_crew_xp_fuel — validate the message ──────────────────

CREATE OR REPLACE FUNCTION public.claim_crew_xp_fuel(p_message_id UUID, p_xp INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_amount   INT;
  v_crew_id  UUID;
  v_msg_type TEXT;
  v_member   INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_message_id IS NULL THEN
    RAISE EXCEPTION 'message_id required' USING ERRCODE = '22023';
  END IF;

  -- THE FIX — the claimed message must be a real xp_fuel message in a
  -- crew the caller belongs to. Previously any fresh UUID paid out.
  SELECT crew_id, message_type
    INTO v_crew_id, v_msg_type
    FROM public.crew_messages
   WHERE id = p_message_id;
  IF v_crew_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'message_not_found');
  END IF;
  IF v_msg_type IS DISTINCT FROM 'xp_fuel' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_fuel_message');
  END IF;
  SELECT COUNT(*)::int
    INTO v_member
    FROM public.crew_members
   WHERE crew_id = v_crew_id
     AND user_id = v_uid;
  IF v_member = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_crew_member');
  END IF;

  -- Clamp XP to a sane range (client default is 25).
  v_amount := GREATEST(1, LEAST(COALESCE(p_xp, 25), 1000));
  BEGIN
    INSERT INTO public.crew_xp_claims (message_id, user_id, xp_amount)
    VALUES (p_message_id, v_uid, v_amount);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_claimed');
  END;
  PERFORM public.increment_user_xp(v_uid, v_amount);
  RETURN jsonb_build_object('ok', true, 'xp_amount', v_amount);
END;
$$;

REVOKE ALL    ON FUNCTION public.claim_crew_xp_fuel(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_crew_xp_fuel(UUID, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
