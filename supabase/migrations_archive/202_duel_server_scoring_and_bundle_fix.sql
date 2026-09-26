-- 202_duel_server_scoring_and_bundle_fix.sql
--
-- (1) submit_duel_result_atomic already recomputed VOLUME server-side for
--     'open' duels, but 'exercise' duels scored off the client's reps/weight
--     and 'mirror' duels off the client's sets_completed (60% of the score)
--     — both inflatable to fake a win (trophies / win-count). Fix: derive
--     EVERY score field (volume, reps, weight, sets_completed) from the
--     validated, caller-owned, in-window workout log and ignore the client
--     p_result entirely. Both duelists are scored identically from real
--     logged sets, so legitimate results are unchanged.
--
-- (2) purchase_bundle referenced user_profiles.user_id, which does not exist
--     (the table is keyed by id) — the bundle RPC errored 100% of the time.
--     Corrected to id. (Feature stays dormant until a create-bundle flow
--     exists; this is a correctness fix, not an activation.)

-- ── Server-side duel metrics from a workout log ────────────────────────
CREATE OR REPLACE FUNCTION public._duel_metrics_from_log(p_exercises jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_ex         JSONB;
  v_set        JSONB;
  v_vol        NUMERIC := 0;
  v_max_reps   NUMERIC := 0;
  v_max_weight NUMERIC := 0;
  v_sets       INT     := 0;
  v_w          NUMERIC;
  v_r          NUMERIC;
BEGIN
  IF p_exercises IS NULL OR jsonb_typeof(p_exercises) <> 'array' THEN
    RETURN jsonb_build_object('volume', 0, 'reps', 0, 'weight', 0, 'sets_completed', 0);
  END IF;
  FOR v_ex IN SELECT * FROM jsonb_array_elements(p_exercises) LOOP
    IF jsonb_typeof(v_ex->'sets') = 'array' THEN
      FOR v_set IN SELECT * FROM jsonb_array_elements(v_ex->'sets') LOOP
        v_w := COALESCE((v_set->>'weight')::NUMERIC, 0);
        v_r := COALESCE((v_set->>'reps')::NUMERIC, 0);
        v_vol := v_vol + v_w * v_r;
        IF v_r > 0 THEN v_sets := v_sets + 1; END IF;
        IF v_r > v_max_reps   THEN v_max_reps := v_r; END IF;
        IF v_w > v_max_weight THEN v_max_weight := v_w; END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('volume', v_vol, 'reps', v_max_reps,
                            'weight', v_max_weight, 'sets_completed', v_sets);
END;
$function$;

-- ── Duel submit: score entirely from the server-computed log metrics ───
CREATE OR REPLACE FUNCTION public.submit_duel_result_atomic(p_duel_id uuid, p_result jsonb, p_workout_log_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid            UUID := auth.uid();
  v_duel_id        UUID;
  v_status         TEXT;
  v_winner_id      UUID;
  v_challenger_id  UUID;
  v_opponent_id    UUID;
  v_challenger_res JSONB;
  v_opponent_res   JSONB;
  v_created_at     TIMESTAMPTZ;
  v_expires_at     TIMESTAMPTZ;
  v_role           TEXT;
  v_winner         UUID;
  v_completed      BOOLEAN := FALSE;
  v_log_owner      UUID;
  v_log_created    TIMESTAMPTZ;
  v_log_exercises  JSONB;
  v_volume         NUMERIC;
  v_safe_result    JSONB;
  v_duel_row       public.duels%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_duel_id IS NULL OR p_result IS NULL THEN
    RAISE EXCEPTION 'duel_id and result required' USING ERRCODE = '22023';
  END IF;
  IF p_workout_log_id IS NULL THEN
    RAISE EXCEPTION 'workout_log_required' USING ERRCODE = '22023';
  END IF;

  SELECT id, status, winner_id, challenger_id, opponent_id,
         challenger_result, opponent_result, created_at, expires_at
    INTO v_duel_id, v_status, v_winner_id, v_challenger_id, v_opponent_id,
         v_challenger_res, v_opponent_res, v_created_at, v_expires_at
    FROM public.duels WHERE id = p_duel_id FOR UPDATE;
  IF v_duel_id IS NULL THEN
    RAISE EXCEPTION 'duel not found' USING ERRCODE = '22023';
  END IF;
  IF v_status = 'completed' OR v_status = 'expired' OR v_status = 'declined' THEN
    RETURN jsonb_build_object('duel_id', p_duel_id, 'status', v_status,
                              'winner_id', v_winner_id, 'already_final', TRUE);
  END IF;

  SELECT user_id, created_at, exercises
    INTO v_log_owner, v_log_created, v_log_exercises
    FROM public.workout_logs WHERE id = p_workout_log_id;
  IF v_log_owner IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'invalid_workout_log' USING ERRCODE = '42501';
  END IF;
  IF v_log_created < v_created_at OR v_log_created > COALESCE(v_expires_at, now()) THEN
    RAISE EXCEPTION 'workout_outside_duel_window' USING ERRCODE = '22023';
  END IF;

  -- EVERY score field comes from the log — the client p_result is ignored.
  v_safe_result := public._duel_metrics_from_log(v_log_exercises)
                    || jsonb_build_object('workout_log_id', p_workout_log_id, 'server_computed', TRUE);
  v_volume := COALESCE((v_safe_result->>'volume')::NUMERIC, 0);

  IF v_challenger_id = v_uid THEN
    v_role := 'challenger';
    UPDATE public.duels SET challenger_result = v_safe_result WHERE id = p_duel_id;
    v_challenger_res := v_safe_result;
  ELSIF v_opponent_id = v_uid THEN
    v_role := 'opponent';
    UPDATE public.duels SET opponent_result = v_safe_result WHERE id = p_duel_id;
    v_opponent_res := v_safe_result;
  ELSE
    RAISE EXCEPTION 'not your duel' USING ERRCODE = '42501';
  END IF;

  IF v_challenger_res IS NOT NULL AND v_opponent_res IS NOT NULL THEN
    SELECT * INTO v_duel_row FROM public.duels WHERE id = p_duel_id;
    v_winner := public._duel_resolve_winner(v_duel_row);
    UPDATE public.duels SET status = 'completed', winner_id = v_winner WHERE id = p_duel_id;
    v_completed := TRUE;
  END IF;

  RETURN jsonb_build_object(
    'duel_id',       p_duel_id,
    'role',          v_role,
    'status',        CASE WHEN v_completed THEN 'completed' ELSE v_status END,
    'winner_id',     v_winner,
    'completed',     v_completed,
    'already_final', FALSE,
    'server_volume', v_volume
  );
END;
$function$;

-- ── purchase_bundle: user_profiles is keyed by id, not user_id ─────────
CREATE OR REPLACE FUNCTION public.purchase_bundle(p_bundle_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_buyer_id     UUID := auth.uid();
  v_bundle_status TEXT;
  v_bundle_seller UUID;
  v_discount_pct  NUMERIC;
  v_lid           UUID;
  v_price         INTEGER;
  v_inv           UUID;
  v_seller        UUID;
  v_total_price   INTEGER := 0;
  v_discounted    INTEGER;
  v_buyer_coins   INTEGER;
  v_listing_ids   UUID[] := '{}';
BEGIN
  IF v_buyer_id IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;

  SELECT status, seller_user_id, discount_pct
    INTO v_bundle_status, v_bundle_seller, v_discount_pct
    FROM public.marketplace_bundles WHERE id = p_bundle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bundle_not_found'; END IF;
  IF v_bundle_status <> 'active' THEN RAISE EXCEPTION 'bundle_not_available'; END IF;
  IF v_bundle_seller = v_buyer_id THEN RAISE EXCEPTION 'cannot_buy_own_bundle'; END IF;

  FOR v_lid, v_price IN
    SELECT id, asking_price
      FROM public.marketplace_listings
     WHERE bundle_id = p_bundle_id AND status = 'active' AND listing_type = 'sale'
     FOR UPDATE
  LOOP
    v_total_price := v_total_price + COALESCE(v_price, 0);
    v_listing_ids := array_append(v_listing_ids, v_lid);
  END LOOP;
  IF array_length(v_listing_ids, 1) IS NULL THEN RAISE EXCEPTION 'bundle_empty'; END IF;

  v_discounted := GREATEST(1, ROUND(v_total_price * (1 - v_discount_pct / 100)));

  SELECT flex_coins INTO v_buyer_coins FROM public.user_profiles WHERE id = v_buyer_id FOR UPDATE;
  IF v_buyer_coins < v_discounted THEN RAISE EXCEPTION 'insufficient_coins'; END IF;

  UPDATE public.user_profiles SET flex_coins = flex_coins - v_discounted WHERE id = v_buyer_id;

  FOR v_lid, v_price, v_inv, v_seller IN
    SELECT id, asking_price, inventory_id, seller_user_id
      FROM public.marketplace_listings WHERE id = ANY(v_listing_ids)
  LOOP
    UPDATE public.user_profiles SET flex_coins = flex_coins + COALESCE(v_price, 0)
     WHERE id = v_seller;
    UPDATE public.user_inventory SET user_id = v_buyer_id, is_listed = false
     WHERE id = v_inv;
    UPDATE public.marketplace_listings SET status = 'completed' WHERE id = v_lid;
  END LOOP;

  UPDATE public.marketplace_bundles SET status = 'completed' WHERE id = p_bundle_id;

  RETURN jsonb_build_object('bundle_id', p_bundle_id, 'listing_count', array_length(v_listing_ids, 1),
                            'total_price', v_total_price, 'paid_price', v_discounted,
                            'buyer_coins', v_buyer_coins - v_discounted);
END;
$function$;
