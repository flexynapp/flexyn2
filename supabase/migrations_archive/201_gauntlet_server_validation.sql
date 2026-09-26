-- 201_gauntlet_server_validation.sql
--
-- complete_gauntlet_challenge trusted the CLIENT's "challenge met" decision:
-- the app evaluates the target in evaluateChallengeCriteria() and calls the
-- RPC with workoutLogId = null, and the RPC awarded xp_reward + coin_reward
-- (writing total_xp DIRECTLY, bypassing every XP cap) with no server proof.
-- A modified client could claim the whole gauntlet's rewards without meeting
-- any target.
--
-- Fix: re-derive the metric SERVER-SIDE and reject if unmet. The checks
-- mirror the client evaluator but are deliberately LENIENT on window edges
-- (a day wider) so a legitimately-earned completion is never falsely denied
-- — the point is to require real qualifying activity, not to re-litigate a
-- boundary. The client change (companion commit) passes the real
-- workoutLogId so the per-session metrics can be verified.
--
-- Rewritten with scalar SELECT INTO (no %ROWTYPE record.field access) for
-- paste-safety; the progress/completion/reward logic is otherwise identical.

CREATE OR REPLACE FUNCTION public.complete_gauntlet_challenge(
  p_sequence_number integer,
  p_workout_log_id uuid DEFAULT NULL::uuid,
  p_score double precision DEFAULT NULL::double precision)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id      UUID := auth.uid();
  v_challenge_id UUID;
  v_title        TEXT;
  v_metric       TEXT;
  v_target       NUMERIC;
  v_xp_reward    INT;
  v_coin_reward  INT;
  v_cur_seq      INT;
  v_next_seq     INT;
  v_path_done    BOOLEAN := FALSE;
  v_log_owner    UUID;
  v_log_ex       JSONB;
  v_agg          NUMERIC;
  v_cnt          INT;
  v_window       INT;
  v_ok           BOOLEAN := FALSE;
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

  -- ── Server-side proof that the challenge was actually met ──
  IF p_workout_log_id IS NOT NULL THEN
    SELECT user_id, exercises INTO v_log_owner, v_log_ex
      FROM public.workout_logs WHERE id = p_workout_log_id;
    IF v_log_owner IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'invalid_workout_log' USING ERRCODE = '42501';
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
       AND date >= (date_trunc('week', (now() AT TIME ZONE 'utc')::date) - INTERVAL '1 day')::date;
    v_ok := (v_agg >= v_target);

  ELSIF v_metric IN ('sessions_in_5_days', 'sessions_in_7_days') THEN
    v_window := CASE v_metric WHEN 'sessions_in_5_days' THEN 5 ELSE 7 END;
    SELECT COUNT(DISTINCT date) INTO v_cnt
      FROM public.workout_logs
     WHERE user_id = v_user_id
       AND date >= ((now() AT TIME ZONE 'utc')::date - v_window);
    v_ok := (v_cnt >= v_target);

  ELSIF v_metric = 'consecutive_days' THEN
    SELECT COALESCE(workout_streak, 0) INTO v_cnt
      FROM public.user_profiles WHERE id = v_user_id;
    v_ok := (v_cnt >= v_target);

  ELSE
    -- any_compound_pr (and any future metric): a full PR check needs the
    -- user's whole history + compound classification, which isn't practical
    -- here — require at least a real, caller-owned workout log so it can't
    -- be claimed with no activity.
    v_ok := (v_log_ex IS NOT NULL);
  END IF;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'challenge_target_not_met' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.user_gauntlet_completions
    (user_id, challenge_id, sequence_number, score, workout_log_id)
  VALUES (v_user_id, v_challenge_id, p_sequence_number, p_score, p_workout_log_id);

  v_next_seq := p_sequence_number + 1;
  SELECT COUNT(*) = 0 INTO v_path_done FROM public.gauntlet_challenges
   WHERE sequence_number = v_next_seq;

  UPDATE public.user_gauntlet_progress SET
    current_challenge_sequence = CASE WHEN v_path_done THEN p_sequence_number ELSE v_next_seq END,
    challenges_completed       = challenges_completed + 1,
    last_completed_at          = NOW(),
    path_completed             = v_path_done,
    path_completed_at          = CASE WHEN v_path_done THEN NOW() ELSE NULL END
  WHERE user_id = v_user_id;

  UPDATE public.user_profiles SET
    total_xp    = COALESCE(total_xp, 0)    + v_xp_reward,
    lifetime_xp = COALESCE(lifetime_xp, 0) + v_xp_reward,
    flex_coins  = COALESCE(flex_coins, 0)  + v_coin_reward
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'challenge_id',    v_challenge_id,
    'challenge_title', v_title,
    'next_sequence',   v_next_seq,
    'xp_awarded',      v_xp_reward,
    'coins_awarded',   v_coin_reward,
    'path_completed',  v_path_done
  );
END;
$function$;
