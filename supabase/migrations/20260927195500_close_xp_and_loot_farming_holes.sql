-- Close four reward farming holes found in the 2026-09-27 XP audit.
--
-- Every hole below was reproduced against production as a real
-- authenticated guest inside a rolled-back transaction before this file was
-- written. Numbers are from those runs.
--
-- 1. THE GAUNTLET COULD BE REPLAYED FOREVER.
--    user_gauntlet_progress and user_gauntlet_completions carried one ALL
--    policy each ("own rows"), so a client could DELETE its own completion
--    and UPDATE current_challenge_sequence to any step it liked.
--    complete_gauntlet_challenge trusts both. Step 9 (any_compound_pr) falls
--    through to "any workout log will do", so: set the sequence to 9, log one
--    45 lb set, call the RPC, delete the completion, set 9 again, repeat.
--    Two loops paid 2,000 XP and 800 coins. The XP was written straight into
--    total_xp, so it skipped xp_grant_log: no rolling 24h cap, no audit row,
--    and current_level was never recomputed. The client only ever READS
--    these two tables (src/lib/data/gauntlet.js), so they become read-only
--    and the RPC is the only writer. XP now goes through award_xp_internal,
--    the same capped and logged path every other server award uses.
--    lifetime_xp is no longer touched here: it is the prestige accumulator
--    (perform_prestige folds total_xp into it), so adding to it directly
--    counted gauntlet XP twice for anyone who later prestiged.
--    The two sessions_in_N_days branches also skip implausible logs now,
--    matching the weekly_lbs branch beside them (migration 362's rule).
--
-- 2. CAPSULE LOOT COULD BE FORGED AND DUPLICATED.
--    user_capsules lets a client UPDATE its own rows (the legacy openCapsule
--    fallback flips is_opened). Nothing limited WHICH columns. So a client
--    could set capsule_type = 'elite' before opening, set rolled_rarity =
--    'legendary' between claim_capsule_loot and finalize_capsule_claim
--    (finalize reads the rarity back off the row), and then set
--    finalized_at = NULL to finalize again. One standard capsule produced
--    two legendary items. A guard trigger now lets client roles change only
--    is_opened (false to true), opened_at and user_email. The RPCs run as
--    the table owner and are unaffected.
--
-- 3. ANY SIGNED-IN USER COULD RESOLVE A LEAGUE.
--    distribute_league_rewards and claim_league_resolution were still
--    EXECUTE-able by authenticated, although the comment in
--    src/lib/data/leagues.js says migration 310 took them away from the
--    browser. distribute_league_rewards checks neither is_resolved nor
--    whether the week is over, so a caller could rank, promote and pay the
--    CURRENT week early (coins and capsules to every member), and
--    claim_league_resolution could mark the live league resolved, which
--    griefs the Monday rollover. Nothing in the app or in the database calls
--    either one any more; the server resolver is
--    resolve_league_bracket_internal. Revoked.
--
-- 4. reset_my_profile_stats RE-ARMED THE REWARD LADDERS.
--    It zeroes last_daily_chest_at, level_capsules_awarded_through and
--    milestone_capsules_awarded but leaves every capsule already granted,
--    so claim_daily_chest, reset, claim again is an unlimited capsule tap,
--    and re-levelling re-mints the level capsules. The app has no caller
--    (no reference anywhere in src/), so it is revoked rather than patched.
--    If a "reset my stats" feature is ever built, it must leave those three
--    columns alone.
--
-- Not changed here, and reported instead: grant_action_xp still takes the XP
-- amount from the client for every action. Its per-action daily caps bound
-- the damage (about 8,000 XP a day, which feeds league standings), but the
-- fix is to derive each amount on the server, which touches every caller.

-- ── 1. Gauntlet ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS user_gauntlet_progress_own    ON public.user_gauntlet_progress;
DROP POLICY IF EXISTS user_gauntlet_completions_own ON public.user_gauntlet_completions;
DROP POLICY IF EXISTS user_gauntlet_progress_read    ON public.user_gauntlet_progress;
DROP POLICY IF EXISTS user_gauntlet_completions_read ON public.user_gauntlet_completions;

CREATE POLICY user_gauntlet_progress_read ON public.user_gauntlet_progress
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY user_gauntlet_completions_read ON public.user_gauntlet_completions
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_gauntlet_progress    FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_gauntlet_completions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.complete_gauntlet_challenge(p_sequence_number integer, p_workout_log_id uuid DEFAULT NULL::uuid, p_score double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id      UUID := auth.uid();
  v_challenge_id UUID; v_title TEXT; v_metric TEXT; v_target NUMERIC;
  v_xp_reward INT; v_coin_reward INT; v_cur_seq INT; v_next_seq INT;
  v_path_done BOOLEAN := FALSE; v_log_owner UUID; v_log_ex JSONB;
  v_agg NUMERIC; v_cnt INT; v_window INT; v_ok BOOLEAN := FALSE;
  v_xp_before BIGINT; v_xp_after BIGINT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT id, title, metric, target_value, xp_reward, coin_reward
    INTO v_challenge_id, v_title, v_metric, v_target, v_xp_reward, v_coin_reward
    FROM public.gauntlet_challenges WHERE sequence_number = p_sequence_number;
  IF v_challenge_id IS NULL THEN RAISE EXCEPTION 'challenge_not_found'; END IF;
  INSERT INTO public.user_gauntlet_progress (user_id, current_challenge_sequence)
  VALUES (v_user_id, 1) ON CONFLICT (user_id) DO NOTHING;
  SELECT current_challenge_sequence INTO v_cur_seq
    FROM public.user_gauntlet_progress WHERE user_id = v_user_id FOR UPDATE;
  IF v_cur_seq <> p_sequence_number THEN RAISE EXCEPTION 'wrong_challenge'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_gauntlet_completions
              WHERE user_id = v_user_id AND challenge_id = v_challenge_id) THEN
    RAISE EXCEPTION 'already_completed';
  END IF;
  IF p_workout_log_id IS NOT NULL THEN
    SELECT user_id, exercises INTO v_log_owner, v_log_ex
      FROM public.workout_logs WHERE id = p_workout_log_id;
    IF v_log_owner IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'invalid_workout_log' USING ERRCODE = '42501';
    END IF;
    -- Migration 362: a flagged log cannot buy an award.
    IF public.workout_log_is_flagged(p_workout_log_id) THEN
      RAISE EXCEPTION 'implausible_workout_log' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_metric = 'session_volume' THEN
    v_ok := (v_log_ex IS NOT NULL AND public._duel_calc_volume(v_log_ex) >= v_target);
  ELSIF v_metric = 'min_exercises_no_skip' THEN
    v_ok := (v_log_ex IS NOT NULL AND jsonb_typeof(v_log_ex) = 'array'
             AND jsonb_array_length(v_log_ex) >= v_target);
  ELSIF v_metric = 'weekly_lbs' THEN
    SELECT COALESCE(SUM(public._duel_calc_volume(exercises)), 0) INTO v_agg
      FROM public.workout_logs
     WHERE user_id = v_user_id
       AND NOT COALESCE(implausible, FALSE)
       AND date >= (date_trunc('week', (now() AT TIME ZONE 'utc')::date) - INTERVAL '1 day')::date;
    v_ok := (v_agg >= v_target);
  ELSIF v_metric IN ('sessions_in_5_days', 'sessions_in_7_days') THEN
    v_window := CASE v_metric WHEN 'sessions_in_5_days' THEN 5 ELSE 7 END;
    SELECT COUNT(DISTINCT date) INTO v_cnt FROM public.workout_logs
     WHERE user_id = v_user_id
       AND NOT COALESCE(implausible, FALSE)
       AND date >= ((now() AT TIME ZONE 'utc')::date - v_window);
    v_ok := (v_cnt >= v_target);
  ELSIF v_metric = 'consecutive_days' THEN
    SELECT COALESCE(workout_streak, 0) INTO v_cnt FROM public.user_profiles WHERE id = v_user_id;
    v_ok := (v_cnt >= v_target);
  ELSE
    v_ok := (v_log_ex IS NOT NULL);
  END IF;
  IF NOT v_ok THEN RAISE EXCEPTION 'challenge_target_not_met' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.user_gauntlet_completions
    (user_id, challenge_id, sequence_number, score, workout_log_id)
  VALUES (v_user_id, v_challenge_id, p_sequence_number, p_score, p_workout_log_id);
  v_next_seq := p_sequence_number + 1;
  SELECT COUNT(*) = 0 INTO v_path_done FROM public.gauntlet_challenges WHERE sequence_number = v_next_seq;
  UPDATE public.user_gauntlet_progress SET
    current_challenge_sequence = CASE WHEN v_path_done THEN p_sequence_number ELSE v_next_seq END,
    challenges_completed = challenges_completed + 1, last_completed_at = NOW(),
    path_completed = v_path_done,
    path_completed_at = CASE WHEN v_path_done THEN NOW() ELSE NULL END
  WHERE user_id = v_user_id;

  -- XP through the capped, logged path. Report what actually landed.
  SELECT COALESCE(total_xp, 0) INTO v_xp_before FROM public.user_profiles WHERE id = v_user_id;
  PERFORM public.award_xp_internal(v_user_id, v_xp_reward);
  SELECT COALESCE(total_xp, 0) INTO v_xp_after FROM public.user_profiles WHERE id = v_user_id;

  UPDATE public.user_profiles SET
    flex_coins = COALESCE(flex_coins, 0) + v_coin_reward
  WHERE id = v_user_id;
  RETURN jsonb_build_object('challenge_id', v_challenge_id, 'challenge_title', v_title,
    'next_sequence', v_next_seq, 'xp_awarded', GREATEST(0, v_xp_after - v_xp_before)::int,
    'coins_awarded', v_coin_reward, 'path_completed', v_path_done);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.complete_gauntlet_challenge(integer, uuid, double precision) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.complete_gauntlet_challenge(integer, uuid, double precision) TO authenticated;

-- ── 2. Capsules ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_capsules_guard_client_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- The loot RPCs run as the table owner; only client roles are limited.
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF NEW.user_id         IS DISTINCT FROM OLD.user_id
     OR NEW.capsule_type    IS DISTINCT FROM OLD.capsule_type
     OR NEW.earned_at       IS DISTINCT FROM OLD.earned_at
     OR NEW.rolled_rarity   IS DISTINCT FROM OLD.rolled_rarity
     OR NEW.rolled_category IS DISTINCT FROM OLD.rolled_category
     OR NEW.rolled_variant  IS DISTINCT FROM OLD.rolled_variant
     OR NEW.finalized_at    IS DISTINCT FROM OLD.finalized_at
     OR (OLD.is_opened IS TRUE AND NEW.is_opened IS NOT TRUE) THEN
    RAISE EXCEPTION 'capsule contents are server-only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS user_capsules_guard_client_update ON public.user_capsules;
CREATE TRIGGER user_capsules_guard_client_update
  BEFORE UPDATE ON public.user_capsules
  FOR EACH ROW EXECUTE FUNCTION public.user_capsules_guard_client_update();

-- ── 3 and 4. Functions the client must not call ────────────────────────────

REVOKE EXECUTE ON FUNCTION public.distribute_league_rewards(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_league_resolution(uuid)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reset_my_profile_stats()         FROM PUBLIC, anon, authenticated;

-- ── Probe: attempt each hole as a real authenticated user, then roll back ──
-- Asserts both directions: the forgery is refused AND the honest path still
-- pays.

DO $$
DECLARE
  u   UUID := gen_random_uuid();
  lg  UUID;
  cap UUID;
  cap2 UUID;
  r   JSONB;
  v_xp BIGINT;
  v_log INT;
  v_refused BOOLEAN;
  v_fn TEXT;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, aud, role, is_anonymous) VALUES
      (u, 'xp-probe-' || u || '@example.invalid', 'authenticated', 'authenticated', FALSE);
    INSERT INTO public.user_profiles (id, email) VALUES (u, 'xp-probe-' || u || '@example.invalid')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
      VALUES (u, 'xp-probe-' || u || '@example.invalid', 'standard') RETURNING id INTO cap;
    INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
      VALUES (u, 'xp-probe-' || u || '@example.invalid', 'standard') RETURNING id INTO cap2;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', u, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    -- Four exercises: an honest pass at gauntlet step 1.
    INSERT INTO public.workout_logs (user_id, created_by, date, exercises)
    VALUES (u, 'xp-probe-' || u || '@example.invalid', current_date,
      '[{"name":"Bench Press","sets":[{"weight":45,"reps":5}]},
        {"name":"Squat","sets":[{"weight":45,"reps":5}]},
        {"name":"Row","sets":[{"weight":45,"reps":5}]},
        {"name":"Curl","sets":[{"weight":20,"reps":5}]}]')
    RETURNING id INTO lg;

    -- Gauntlet: skipping ahead is refused.
    v_refused := FALSE;
    BEGIN
      INSERT INTO public.user_gauntlet_progress (user_id, current_challenge_sequence) VALUES (u, 9);
    EXCEPTION WHEN insufficient_privilege THEN v_refused := TRUE;
    END;
    IF NOT v_refused THEN RAISE EXCEPTION 'probe: client could write gauntlet progress'; END IF;

    -- Gauntlet: the honest step still pays, through the ledger.
    r := public.complete_gauntlet_challenge(1, lg, NULL);
    IF (r->>'xp_awarded')::int <> 150 OR (r->>'coins_awarded')::int <> 50 THEN
      RAISE EXCEPTION 'probe: honest gauntlet step paid wrong: %', r;
    END IF;

    -- Gauntlet: deleting the completion to replay it is refused.
    v_refused := FALSE;
    BEGIN
      DELETE FROM public.user_gauntlet_completions WHERE user_id = u;
      IF NOT FOUND THEN v_refused := TRUE; END IF;
    EXCEPTION WHEN insufficient_privilege THEN v_refused := TRUE;
    END;
    IF NOT v_refused THEN RAISE EXCEPTION 'probe: client could delete a gauntlet completion'; END IF;

    -- Capsule: upgrading the type is refused.
    v_refused := FALSE;
    BEGIN
      UPDATE public.user_capsules SET capsule_type = 'elite' WHERE id = cap;
    EXCEPTION WHEN insufficient_privilege THEN v_refused := TRUE;
    END;
    IF NOT v_refused THEN RAISE EXCEPTION 'probe: client could change capsule_type'; END IF;

    -- Capsule: the honest open and claim still work.
    PERFORM public.claim_capsule_loot(cap);
    v_refused := FALSE;
    BEGIN
      -- Always a different value: the roll above is random, and forging the
      -- rarity it already landed on changes nothing, so the guard would
      -- rightly stay quiet and this probe would fail now and then.
      UPDATE public.user_capsules
         SET rolled_rarity = CASE WHEN rolled_rarity = 'legendary' THEN 'common' ELSE 'legendary' END
       WHERE id = cap;
    EXCEPTION WHEN insufficient_privilege THEN v_refused := TRUE;
    END;
    IF NOT v_refused THEN RAISE EXCEPTION 'probe: client could rewrite rolled_rarity'; END IF;
    r := public.finalize_capsule_claim(cap, NULL, NULL, NULL, NULL, NULL);
    IF NOT COALESCE((r->>'ok')::boolean, FALSE) THEN RAISE EXCEPTION 'probe: honest finalize failed: %', r; END IF;

    -- Capsule: un-finalizing to claim twice is refused.
    v_refused := FALSE;
    BEGIN
      UPDATE public.user_capsules SET finalized_at = NULL WHERE id = cap;
    EXCEPTION WHEN insufficient_privilege THEN v_refused := TRUE;
    END;
    IF NOT v_refused THEN RAISE EXCEPTION 'probe: client could clear finalized_at'; END IF;

    -- Capsule: the legacy openCapsule write (is_opened false to true) still works.
    UPDATE public.user_capsules SET is_opened = TRUE, opened_at = now() WHERE id = cap2 AND is_opened = FALSE;
    IF NOT FOUND THEN RAISE EXCEPTION 'probe: legacy open was refused'; END IF;

    -- League resolver and profile reset are no longer callable.
    FOREACH v_fn IN ARRAY ARRAY['distribute_league_rewards', 'claim_league_resolution', 'reset_my_profile_stats'] LOOP
      v_refused := FALSE;
      BEGIN
        IF v_fn = 'reset_my_profile_stats' THEN
          PERFORM public.reset_my_profile_stats();
        ELSIF v_fn = 'claim_league_resolution' THEN
          PERFORM public.claim_league_resolution(gen_random_uuid());
        ELSE
          PERFORM public.distribute_league_rewards(gen_random_uuid());
        END IF;
      EXCEPTION WHEN insufficient_privilege THEN v_refused := TRUE;
      END;
      IF NOT v_refused THEN RAISE EXCEPTION 'probe: client could call %', v_fn; END IF;
    END LOOP;

    RESET ROLE;
    SELECT total_xp INTO v_xp FROM public.user_profiles WHERE id = u;
    SELECT count(*) INTO v_log FROM public.xp_grant_log WHERE user_id = u;
    IF v_xp <> 150 OR v_log <> 1 THEN
      RAISE EXCEPTION 'probe: gauntlet XP skipped the ledger: total_xp %, ledger rows %', v_xp, v_log;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'probe passed';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
END;
$$;
