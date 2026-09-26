-- 362_flagged_logs_cannot_buy_awards.sql
--
-- The last five paths that still accepted an implausible log. 360 flagged
-- them, 361 kept them off the boards and out of the credited volume; these
-- are the ones that hand out a prize.
--
-- TWO SHAPES, TWO TREATMENTS
--
-- complete_bounty_claim, complete_gauntlet_challenge and
-- submit_duel_result_atomic each take a SPECIFIC p_workout_log_id and
-- grant against it. A WHERE clause is the wrong tool — there is one row
-- and the question is whether it may be spent. Each gets an early guard
-- immediately after the ownership check it already performs, raising
-- `implausible_workout_log` (22023).
--
-- RAISING IS RIGHT HERE, AND IT WAS WRONG IN 360. The difference is what
-- a refusal costs. Refusing to SAVE a workout destroys the session and
-- the user may never get it back. Refusing to spend one on a bounty costs
-- the bounty — the log is still there, still theirs, still in their
-- history. A false positive is recoverable in the second case and not in
-- the first.
--
-- get_friend_leaderboard and get_period_leaderboard are the other shape —
-- aggregates over many rows — and get the same predicate as 361.
--
-- THREE THINGS WORTH KNOWING ABOUT THE EDIT ITSELF
--
--   * The three award bodies below are the INSTALLED definitions with the
--     guard INJECTED, not retyped. They are 94, 79 and 54 lines of live
--     SECURITY DEFINER logic and retyping them from memory is how a
--     silent behaviour change lands.
--   * get_period_leaderboard needed PARENTHESES, not just an AND. Its
--     window clause is `WHERE v_since IS NULL OR date >= v_since` — AND
--     binds tighter than OR, so appending the predicate would have
--     produced `v_since IS NULL OR (date >= … AND NOT implausible)` and
--     silently left the ALL-TIME board unfiltered while looking correct.
--   * get_friend_leaderboard is rewritten alias-free. Its body was built
--     on `wl.`, `hf1.`, `p.`, `r.` — exactly the alias.column tokens the
--     clipboard pipeline mangles into `42601 syntax error at "<"`. The
--     self-join on hub_follows genuinely needs two references, so it is
--     expressed as two CTEs with renamed columns plus an EXISTS. Output
--     equivalence was diffed against the old definition before shipping.
--
-- Paste-safe per repo convention.

-- ── The one question all three ask ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.workout_log_is_flagged(p_log_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $workout_log_is_flagged$
  SELECT COALESCE((SELECT implausible FROM public.workout_logs WHERE id = p_log_id), FALSE);
$workout_log_is_flagged$;

-- Internal. It answers about a log id that may belong to anyone, so it is
-- not a thing a client should be able to ask directly.
REVOKE ALL ON FUNCTION public.workout_log_is_flagged(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.complete_bounty_claim(p_claim_id uuid, p_workout_log_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id      UUID := auth.uid();
  v_claim_status TEXT;
  v_claim_dl     TIMESTAMPTZ;
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
  v_week_logs    JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_workout_log_id IS NULL THEN
    RAISE EXCEPTION 'workout_log_required' USING ERRCODE = '22023';
  END IF;

  SELECT status, bounty_id, deadline
    INTO v_claim_status, v_bounty_id, v_claim_dl
    FROM public.bounty_claims
   WHERE id = p_claim_id AND claimant_id = v_user_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim_not_found'  USING ERRCODE = '22023'; END IF;
  IF v_claim_status <> 'active' THEN RAISE EXCEPTION 'claim_not_active' USING ERRCODE = '22023'; END IF;
  IF v_claim_dl < NOW() THEN RAISE EXCEPTION 'claim_expired' USING ERRCODE = '22023'; END IF;

  SELECT metric::text, exercise_name, target_value, reward
    INTO v_metric, v_exercise, v_target, v_reward
    FROM public.bounties WHERE id = v_bounty_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'bounty_not_found' USING ERRCODE = '22023'; END IF;

  SELECT user_id, exercises INTO v_log_owner, v_exercises
    FROM public.workout_logs WHERE id = p_workout_log_id;
  IF NOT FOUND OR v_log_owner <> v_user_id THEN
    RAISE EXCEPTION 'invalid_workout_log' USING ERRCODE = '42501';
  END IF;

  -- Migration 362: a flagged log cannot buy an award.
  IF public.workout_log_is_flagged(p_workout_log_id) THEN
    RAISE EXCEPTION 'implausible_workout_log' USING ERRCODE = '22023';
  END IF;

  IF v_metric = 'session_volume' THEN
    v_achieved := public._duel_calc_volume(v_exercises);
  ELSIF v_metric = 'weekly_volume' THEN
    v_achieved := 0;
    FOR v_week_logs IN
      SELECT exercises FROM public.workout_logs
       WHERE user_id = v_user_id
         AND NOT COALESCE(implausible, FALSE)
         AND created_at >= NOW() - INTERVAL '7 days'
    LOOP
      v_achieved := v_achieved + public._duel_calc_volume(v_week_logs);
    END LOOP;
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
$function$;

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
     WHERE user_id = v_user_id AND date >= ((now() AT TIME ZONE 'utc')::date - v_window);
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
  UPDATE public.user_profiles SET
    total_xp = COALESCE(total_xp, 0) + v_xp_reward,
    lifetime_xp = COALESCE(lifetime_xp, 0) + v_xp_reward,
    flex_coins = COALESCE(flex_coins, 0) + v_coin_reward
  WHERE id = v_user_id;
  RETURN jsonb_build_object('challenge_id', v_challenge_id, 'challenge_title', v_title,
    'next_sequence', v_next_seq, 'xp_awarded', v_xp_reward, 'coins_awarded', v_coin_reward,
    'path_completed', v_path_done);
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_duel_result_atomic(p_duel_id uuid, p_result jsonb, p_workout_log_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_duel_id UUID; v_status TEXT; v_winner_id UUID; v_challenger_id UUID; v_opponent_id UUID;
  v_challenger_res JSONB; v_opponent_res JSONB; v_created_at TIMESTAMPTZ; v_expires_at TIMESTAMPTZ;
  v_role TEXT; v_winner UUID; v_completed BOOLEAN := FALSE;
  v_log_owner UUID; v_log_created TIMESTAMPTZ; v_log_exercises JSONB; v_volume NUMERIC;
  v_safe_result JSONB; v_duel_row public.duels%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF p_duel_id IS NULL OR p_result IS NULL THEN RAISE EXCEPTION 'duel_id and result required' USING ERRCODE = '22023'; END IF;
  IF p_workout_log_id IS NULL THEN RAISE EXCEPTION 'workout_log_required' USING ERRCODE = '22023'; END IF;
  SELECT id, status, winner_id, challenger_id, opponent_id, challenger_result, opponent_result, created_at, expires_at
    INTO v_duel_id, v_status, v_winner_id, v_challenger_id, v_opponent_id, v_challenger_res, v_opponent_res, v_created_at, v_expires_at
    FROM public.duels WHERE id = p_duel_id FOR UPDATE;
  IF v_duel_id IS NULL THEN RAISE EXCEPTION 'duel not found' USING ERRCODE = '22023'; END IF;
  IF v_status = 'completed' OR v_status = 'expired' OR v_status = 'declined' THEN
    RETURN jsonb_build_object('duel_id', p_duel_id, 'status', v_status, 'winner_id', v_winner_id, 'already_final', TRUE);
  END IF;
  SELECT user_id, created_at, exercises INTO v_log_owner, v_log_created, v_log_exercises
    FROM public.workout_logs WHERE id = p_workout_log_id;
  IF v_log_owner IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'invalid_workout_log' USING ERRCODE = '42501'; END IF;

  -- Migration 362: a flagged log cannot buy an award.
  IF public.workout_log_is_flagged(p_workout_log_id) THEN
    RAISE EXCEPTION 'implausible_workout_log' USING ERRCODE = '22023';
  END IF;
  IF v_log_created < v_created_at OR v_log_created > COALESCE(v_expires_at, now()) THEN
    RAISE EXCEPTION 'workout_outside_duel_window' USING ERRCODE = '22023';
  END IF;
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
  ELSE RAISE EXCEPTION 'not your duel' USING ERRCODE = '42501'; END IF;
  IF v_challenger_res IS NOT NULL AND v_opponent_res IS NOT NULL THEN
    SELECT * INTO v_duel_row FROM public.duels WHERE id = p_duel_id;
    v_winner := public._duel_resolve_winner(v_duel_row);
    UPDATE public.duels SET status = 'completed', winner_id = v_winner WHERE id = p_duel_id;
    v_completed := TRUE;
  END IF;
  RETURN jsonb_build_object('duel_id', p_duel_id, 'role', v_role,
    'status', CASE WHEN v_completed THEN 'completed' ELSE v_status END,
    'winner_id', v_winner, 'completed', v_completed, 'already_final', FALSE, 'server_volume', v_volume);
END;
$function$;

-- ── Period leaderboard: note the parentheses ─────────────────────────

CREATE OR REPLACE FUNCTION public.get_period_leaderboard(p_board text, p_period text, p_limit integer DEFAULT 100)
RETURNS TABLE(rank integer, user_id uuid, username text, full_name text, avatar_url text, value numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $get_period_leaderboard$
#variable_conflict use_column
DECLARE
  v_uid    UUID := auth.uid();
  v_limit  INT  := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
  v_period TEXT := COALESCE(p_period, 'alltime');
  v_board  TEXT := COALESCE(p_board, 'volume');
  v_since  TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF v_board NOT IN ('volume', 'xp', 'sessions', 'achievements', 'distance') THEN
    RAISE EXCEPTION 'invalid board' USING ERRCODE = '22023';
  END IF;
  IF v_period NOT IN ('weekly', 'monthly', 'alltime') THEN
    RAISE EXCEPTION 'invalid period' USING ERRCODE = '22023';
  END IF;

  IF v_board IN ('achievements', 'distance') THEN
    v_period := 'alltime';
  END IF;

  IF v_period = 'alltime' THEN
    RETURN QUERY
      WITH base AS (
        SELECT
          user_id    AS user_id,
          username   AS username,
          full_name  AS full_name,
          avatar_url AS avatar_url,
          CASE v_board
            WHEN 'xp'           THEN xp_value
            WHEN 'volume'       THEN volume_value
            WHEN 'distance'     THEN distance_value
            WHEN 'achievements' THEN achievements_value
            ELSE 0::NUMERIC
          END AS value
        FROM public.leaderboard_eligible_profiles
      ),
      live AS (
        SELECT user_id, username, full_name, avatar_url, value
        FROM base
        WHERE value > 0
      )
      SELECT
        (ROW_NUMBER() OVER (ORDER BY value DESC, user_id ASC))::INT AS rank,
        user_id, username, full_name, avatar_url, value
      FROM live
      ORDER BY value DESC, user_id ASC
      LIMIT v_limit;
    RETURN;
  END IF;

  v_since := CASE v_period
    WHEN 'weekly'  THEN date_trunc('week',  now() AT TIME ZONE 'UTC')
    WHEN 'monthly' THEN date_trunc('month', now() AT TIME ZONE 'UTC')
    ELSE NULL
  END;

  RETURN QUERY
    WITH stats AS (
      SELECT
        user_id                                  AS user_id,
        SUM(COALESCE(total_volume, 0))::NUMERIC  AS agg_volume,
        COUNT(*)::NUMERIC                        AS agg_sessions
      FROM public.workout_logs
      -- The parentheses are load-bearing. Without them AND binds tighter
      -- than OR and the all-time branch loses the filter entirely.
      WHERE (v_since IS NULL OR date >= v_since::date)
        AND NOT COALESCE(implausible, FALSE)
      GROUP BY user_id
    ),
    eligible AS (
      SELECT user_id, username, full_name, avatar_url
      FROM public.leaderboard_eligible_profiles
    ),
    joined AS (
      SELECT
        user_id, username, full_name, avatar_url,
        CASE v_board
          WHEN 'sessions' THEN agg_sessions
          ELSE agg_volume
        END AS value
      FROM stats
      JOIN eligible USING (user_id)
    ),
    live AS (
      SELECT user_id, username, full_name, avatar_url, value
      FROM joined
      WHERE value > 0
    )
    SELECT
      (ROW_NUMBER() OVER (ORDER BY value DESC, user_id ASC))::INT AS rank,
      user_id, username, full_name, avatar_url, value
    FROM live
    ORDER BY value DESC, user_id ASC
    LIMIT v_limit;
END;
$get_period_leaderboard$;

-- ── Friend leaderboard, rewritten alias-free ─────────────────────────

CREATE OR REPLACE FUNCTION public.get_friend_leaderboard(p_mode text DEFAULT 'weekly_xp'::text, p_limit integer DEFAULT 20)
RETURNS TABLE(user_id uuid, username text, avatar_url text, current_level integer, weekly_xp integer, weekly_volume numeric, weekly_sessions integer, is_self boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $get_friend_leaderboard$
-- Every column this returns is also an OUT parameter of the RETURNS TABLE
-- (user_id, username, avatar_url, current_level, weekly_xp, ...), so a bare
-- `user_id` is ambiguous. The original body disambiguated with `wl.` and
-- `p.` aliases — precisely the tokens the clipboard mangles. use_column
-- says "prefer the column" once, for the whole body, and lets every
-- reference stay bare.
#variable_conflict use_column
DECLARE
  v_uid        UUID := auth.uid();
  v_email      TEXT;
  v_limit      INT  := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_mode       TEXT := COALESCE(p_mode, 'weekly_xp');
  v_week_start TIMESTAMPTZ := date_trunc('week', now() AT TIME ZONE 'UTC');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF v_mode NOT IN ('weekly_xp', 'weekly_volume', 'weekly_sessions') THEN
    RAISE EXCEPTION 'invalid mode' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;
  IF v_email IS NULL THEN RETURN; END IF;

  RETURN QUERY
    WITH i_follow AS (
      SELECT followee_email AS f_email
        FROM public.hub_follows
       WHERE follower_email = v_email
    ),
    follows_me AS (
      SELECT follower_email AS b_follower
        FROM public.hub_follows
       WHERE followee_email = v_email
    ),
    candidates AS (
      SELECT f_email AS c_email
        FROM i_follow
       WHERE f_email IN (SELECT b_follower FROM follows_me)
      UNION
      SELECT v_email
    ),
    weekly_stats AS (
      SELECT
        user_id                                 AS s_user_id,
        SUM(COALESCE(total_volume, 0))::NUMERIC AS s_volume,
        COUNT(*)::INT                           AS s_sessions
      FROM public.workout_logs
      WHERE date >= v_week_start::date
        AND NOT COALESCE(implausible, FALSE)
      GROUP BY user_id
    ),
    weekly_xp_per_user AS (
      SELECT
        user_id                             AS x_user_id,
        SUM(COALESCE(weekly_xp, 0))::INT    AS x_xp
      FROM public.league_members
      GROUP BY user_id
    ),
    ranked AS (
      SELECT
        id            AS r_id,
        username      AS r_username,
        avatar_url    AS r_avatar_url,
        current_level AS r_level,
        COALESCE(x_xp,       0)::INT     AS r_xp,
        COALESCE(s_volume,   0)::NUMERIC AS r_volume,
        COALESCE(s_sessions, 0)::INT     AS r_sessions,
        (id = v_uid)                     AS r_is_self
      FROM public.user_profiles
      JOIN candidates          ON c_email   = email
      LEFT JOIN weekly_stats       ON s_user_id = id
      LEFT JOIN weekly_xp_per_user ON x_user_id = id
      WHERE username IS NOT NULL
        AND username NOT LIKE 'deleted_%'
    )
    SELECT
      r_id, r_username, r_avatar_url, r_level,
      r_xp, r_volume, r_sessions, r_is_self
    FROM ranked
    ORDER BY
      CASE v_mode
        WHEN 'weekly_xp'       THEN r_xp::NUMERIC
        WHEN 'weekly_volume'   THEN r_volume
        WHEN 'weekly_sessions' THEN r_sessions::NUMERIC
      END DESC NULLS LAST,
      r_username ASC
    LIMIT v_limit;
END;
$get_friend_leaderboard$;
