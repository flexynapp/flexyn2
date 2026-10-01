-- League points from logging, and weekly league quests.
--
-- "League points" are the weekly XP a bracket ranks on after training days
-- (sync_my_weekly_league sums xp_grant_log over the league week). Nothing
-- here touches the league TIER, which stays on the Strength Score.
--
-- Every new source is credited by the server from rows it can read, through
-- grant_action_xp_internal, so each one has a per-day cap in
-- action_xp_ledger and lands in xp_grant_log under increment_user_xp's 24h
-- cap. The client never names an amount.
--
-- Daily (user's local day), via sync_my_logging_points():
--   photo_meal      +15 per meal the AI scanner recognised, 2 a day (30)
--   barcode_meal    +10 per different scanned product, 2 a day (20)
--   water_goal_met  +20 once, when the day's water reaches the user's goal
-- On completion:
--   bounty_completed +100, once a day (complete_bounty_claim)
-- Weekly (league week, Monday to Sunday UTC), via claim_league_quest():
--   train_2 +100 · train_4 +200 · cardio_2 +100 · water_3 +50
--   scan_meals_3 +50 · bounty_1 +100     (600 a week at most)
--
-- Water stops paying per glass: grant_action_xp no longer accepts
-- 'water_logged', so an installed app that still sends it gets 0. Water
-- earns only when the goal is reached (Kegan, 2026-10-01).
--
-- What the server can and cannot see:
-- * A photo meal counts only with an uploaded image, ai_meta.source =
--   'photo_ai', and no more than the scanner calls recorded for the user
--   that day (recognize_meal_quota). The owner account skipped the quota
--   row entirely, so its scans now record a row too (still uncapped).
-- * A barcode cannot be verified. Only the cap and "different products"
--   stand behind it, which is why it pays least.
-- * Weekly water and meal quests count the days the DAILY reward was paid
--   (action_xp_ledger), so a week cannot be back-filled in one sitting.
--
-- Additive: one new table, new functions, three restated functions. No user
-- data is changed or deleted.

------------------------------------------------------------------------------
-- 1. Daily caps for the new sources
------------------------------------------------------------------------------
-- The installed body (pg_get_functiondef, 2026-10-01) with five caps added.
CREATE OR REPLACE FUNCTION public.grant_action_xp_internal(p_action_type text, p_xp integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid    := auth.uid();
  v_day    date;
  v_before integer;
  v_cap    integer;
  v_credit integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF p_xp IS NULL OR p_xp <= 0 THEN RETURN 0; END IF;

  v_cap := CASE p_action_type
    WHEN 'workout_completed' THEN 4000
    WHEN 'cardio_completed'  THEN 2400
    WHEN 'comeback_bonus'    THEN 200
    WHEN 'water_logged'      THEN 24
    WHEN 'meal_logged'       THEN 30
    WHEN 'recipe_created'    THEN 75
    WHEN 'regimen_created'   THEN 200
    WHEN 'goal_completed'    THEN 100
    WHEN 'crew_xp_fuel'      THEN 100
    WHEN 'daily_quest'       THEN 400
    WHEN 'quest_perfect_day' THEN 150
    WHEN 'photo_meal'        THEN 30
    WHEN 'barcode_meal'      THEN 20
    WHEN 'water_goal_met'    THEN 20
    WHEN 'bounty_completed'  THEN 100
    WHEN 'league_quest'      THEN 600
    ELSE NULL
  END;

  IF v_cap IS NULL THEN RETURN 0; END IF;

  v_day := (public.user_local_now(v_uid))::date;
  IF v_day IS NULL THEN
    v_day := (now() AT TIME ZONE 'utc')::date;
  END IF;

  SELECT COALESCE(amount, 0) INTO v_before
    FROM public.action_xp_ledger
   WHERE user_id = v_uid AND day = v_day AND action_type = p_action_type;
  v_before := COALESCE(v_before, 0);

  v_credit := LEAST(p_xp, GREATEST(0, v_cap - v_before));
  IF v_credit <= 0 THEN RETURN 0; END IF;

  INSERT INTO public.action_xp_ledger (user_id, day, action_type, amount)
  VALUES (v_uid, v_day, p_action_type, v_credit)
  ON CONFLICT (user_id, day, action_type)
  DO UPDATE SET amount = public.action_xp_ledger.amount + v_credit;

  PERFORM public.increment_user_xp(v_uid, v_credit);
  RETURN v_credit;
END;
$function$;

------------------------------------------------------------------------------
-- 2. Water no longer pays per glass
------------------------------------------------------------------------------
-- The installed body with the 'water_logged' line removed.
CREATE OR REPLACE FUNCTION public.grant_action_xp(p_action_type text, p_xp integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_amount integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF p_xp IS NULL OR p_xp <= 0 THEN RETURN 0; END IF;

  -- The client says THAT it did something, never how much it was worth.
  -- Water pays only at the daily goal (sync_my_logging_points).
  v_amount := CASE p_action_type
    WHEN 'meal_logged'     THEN 5
    WHEN 'recipe_created'  THEN 25
    WHEN 'regimen_created' THEN 60
    ELSE NULL
  END;
  IF v_amount IS NULL THEN RETURN 0; END IF;

  RETURN public.grant_action_xp_internal(p_action_type, v_amount);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.grant_action_xp(text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.grant_action_xp(text, integer) TO authenticated;

------------------------------------------------------------------------------
-- 3. The daily water goal, a copy of src/lib/waterGoal.js
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.water_goal_oz_for(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_weight numeric;
  v_female boolean;
  v_bday   date;
  v_age    integer;
  v_today  date;
  v_base   numeric;
BEGIN
  SELECT weight_lbs, COALESCE(gender, 'male') = 'female', birthday, age
    INTO v_weight, v_female, v_bday, v_age
    FROM public.user_profiles WHERE id = p_user_id;

  v_today := COALESCE((public.user_local_now(p_user_id))::date, CURRENT_DATE);
  IF v_bday IS NOT NULL THEN
    v_age := date_part('year', age(v_today, v_bday))::integer;
  END IF;
  v_age := COALESCE(v_age, 30);

  v_base := CASE WHEN v_female THEN 73 ELSE 100 END;
  IF v_weight IS NOT NULL AND v_weight > 0 THEN
    v_base := round(v_base * LEAST(GREATEST(v_weight / CASE WHEN v_female THEN 125 ELSE 154 END, 0.7), 1.3));
  END IF;
  IF v_age < 18 THEN v_base := round(v_base * 0.9);
  ELSIF v_age > 55 THEN v_base := round(v_base * 0.95);
  END IF;
  RETURN (round(v_base / 8) * 8)::integer;
END;
$function$;

REVOKE ALL ON FUNCTION public.water_goal_oz_for(uuid) FROM PUBLIC, anon, authenticated;

------------------------------------------------------------------------------
-- 4. Daily logging points
------------------------------------------------------------------------------
-- Idempotent: works out what today's logs are worth and credits only the
-- part not yet in the ledger. Deleting and re-logging cannot pay twice,
-- because the ledger never goes down.
CREATE OR REPLACE FUNCTION public.sync_my_logging_points()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_off     integer;
  v_day     date;
  v_from    timestamptz;
  v_to      timestamptz;
  v_photos  integer;
  v_scans   integer;
  v_codes   integer;
  v_oz      numeric;
  v_goal    integer;
  v_paid    integer;
  v_photo_xp integer := 0;
  v_code_xp  integer := 0;
  v_water_xp integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(timezone_offset_minutes, 0) INTO v_off FROM public.user_profiles WHERE id = v_uid;
  v_off  := COALESCE(v_off, 0);
  v_day  := COALESCE((public.user_local_now(v_uid))::date, (now() AT TIME ZONE 'utc')::date);
  v_from := (v_day::timestamp - make_interval(mins => v_off)) AT TIME ZONE 'UTC';
  v_to   := v_from + interval '1 day';

  -- Photo meals: an uploaded image the scanner recognised, no more than the
  -- scanner calls recorded for the UTC days this local day touches.
  SELECT count(*) INTO v_photos FROM public.nutrition_logs
   WHERE user_id = v_uid AND created_at >= v_from AND created_at < v_to
     AND ai_meta->>'source' = 'photo_ai'
     AND COALESCE(image_url, '') <> '';
  SELECT COALESCE(sum(call_count), 0) INTO v_scans FROM public.recognize_meal_quota
   WHERE user_id = v_uid
     AND day BETWEEN (v_from AT TIME ZONE 'UTC')::date AND (v_to AT TIME ZONE 'UTC')::date;
  v_photos := LEAST(v_photos, v_scans, 2);

  -- Barcode meals: different products only.
  SELECT count(DISTINCT ai_meta->>'barcode') INTO v_codes FROM public.nutrition_logs
   WHERE user_id = v_uid AND created_at >= v_from AND created_at < v_to
     AND ai_meta->>'source' = 'barcode'
     AND COALESCE(ai_meta->>'barcode', '') ~ '^[0-9]{8,14}$';
  v_codes := LEAST(v_codes, 2);

  -- Water: today's diary, logged today. 'Water' is one 8 oz glass,
  -- 'Water|N' is N oz (the encoding the app has always used).
  SELECT COALESCE(sum(CASE
           WHEN food_name = 'Water' THEN 8
           WHEN split_part(food_name, '|', 2) ~ '^[0-9]+(\.[0-9]+)?$'
             THEN split_part(food_name, '|', 2)::numeric
           ELSE 0 END), 0)
    INTO v_oz FROM public.nutrition_logs
   WHERE user_id = v_uid AND date = v_day
     AND created_at >= v_from AND created_at < v_to
     AND (food_name = 'Water' OR food_name LIKE 'Water|%');
  v_goal := public.water_goal_oz_for(v_uid);

  SELECT COALESCE(amount, 0) INTO v_paid FROM public.action_xp_ledger
   WHERE user_id = v_uid AND day = v_day AND action_type = 'photo_meal';
  IF v_photos * 15 > COALESCE(v_paid, 0) THEN
    v_photo_xp := public.grant_action_xp_internal('photo_meal', v_photos * 15 - COALESCE(v_paid, 0));
  END IF;

  v_paid := NULL;
  SELECT COALESCE(amount, 0) INTO v_paid FROM public.action_xp_ledger
   WHERE user_id = v_uid AND day = v_day AND action_type = 'barcode_meal';
  IF v_codes * 10 > COALESCE(v_paid, 0) THEN
    v_code_xp := public.grant_action_xp_internal('barcode_meal', v_codes * 10 - COALESCE(v_paid, 0));
  END IF;

  IF v_goal > 0 AND v_oz >= v_goal THEN
    v_water_xp := public.grant_action_xp_internal('water_goal_met', 20);
  END IF;

  IF v_photo_xp + v_code_xp + v_water_xp > 0 THEN
    PERFORM public.sync_my_weekly_league();
  END IF;

  RETURN jsonb_build_object(
    'photo_meal',     v_photo_xp,
    'barcode_meal',   v_code_xp,
    'water_goal_met', v_water_xp,
    'xp',             v_photo_xp + v_code_xp + v_water_xp,
    'water_oz',       v_oz,
    'water_goal_oz',  v_goal
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_my_logging_points() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_my_logging_points() TO authenticated;

------------------------------------------------------------------------------
-- 5. The owner account's scans leave a record too
------------------------------------------------------------------------------
-- The installed body with one change: the uncapped owner branch now records
-- the call, so their photo meals can count (section 4). Still uncapped.
CREATE OR REPLACE FUNCTION public.consume_recognize_meal_quota()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_global_cap constant integer := 500;
  v_cap        constant integer := 3;
  v_day        date := (now() AT TIME ZONE 'utc')::date;
  v_count      integer;
  v_total      integer;
  v_email      text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email = ANY (ARRAY['keganbergeron@gmail.com']) THEN
    INSERT INTO public.recognize_meal_quota (user_id, day, call_count)
    VALUES (auth.uid(), v_day, 1)
    ON CONFLICT (user_id, day)
    DO UPDATE SET call_count = public.recognize_meal_quota.call_count + 1;
    RETURN true;
  END IF;
  SELECT call_count INTO v_total FROM public.recognize_meal_daily_total WHERE day = v_day;
  IF COALESCE(v_total, 0) >= v_global_cap THEN
    RETURN false;
  END IF;
  SELECT call_count INTO v_count FROM public.recognize_meal_quota
   WHERE user_id = auth.uid() AND day = v_day;
  IF COALESCE(v_count, 0) >= v_cap THEN
    RETURN false;
  END IF;
  INSERT INTO public.recognize_meal_quota (user_id, day, call_count)
  VALUES (auth.uid(), v_day, 1)
  ON CONFLICT (user_id, day)
  DO UPDATE SET call_count = public.recognize_meal_quota.call_count + 1
  RETURNING call_count INTO v_count;
  INSERT INTO public.recognize_meal_daily_total (day, call_count)
  VALUES (v_day, 1)
  ON CONFLICT (day)
  DO UPDATE SET call_count = public.recognize_meal_daily_total.call_count + 1;
  RETURN v_count <= v_cap;
END;
$function$;

------------------------------------------------------------------------------
-- 6. Bounties pay league points
------------------------------------------------------------------------------
-- The installed body (pg_get_functiondef, 2026-10-01) with the XP grant and
-- league sync added after the coins.
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

  -- League points: 100, once a day (the 'bounty_completed' cap).
  IF public.grant_action_xp_internal('bounty_completed', 100) > 0 THEN
    PERFORM public.sync_my_weekly_league();
  END IF;
END;
$function$;

------------------------------------------------------------------------------
-- 7. Weekly league quests
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.league_quest_claims (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start date        NOT NULL,
  quest_id   text        NOT NULL,
  xp         integer     NOT NULL DEFAULT 0,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_start, quest_id)
);
ALTER TABLE public.league_quest_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.league_quest_claims FROM PUBLIC, anon, authenticated;
-- Read through get_my_league_quests only; writes through claim_league_quest.

CREATE OR REPLACE FUNCTION public._league_quest_def()
 RETURNS TABLE(quest_id text, target integer, xp integer, sort integer)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT * FROM (VALUES
    ('train_2',      2, 100, 1),
    ('train_4',      4, 200, 2),
    ('cardio_2',     2, 100, 3),
    ('water_3',      3,  50, 4),
    ('scan_meals_3', 3,  50, 5),
    ('bounty_1',     1, 100, 6)
  ) AS v(quest_id, target, xp, sort);
$function$;

REVOKE ALL ON FUNCTION public._league_quest_def() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.league_quest_progress_internal(
  p_user_id uuid, p_quest_id text, p_from date, p_to date)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer := 0;
BEGIN
  CASE p_quest_id
    WHEN 'train_2', 'train_4' THEN
      -- The same count that qualifies a lifter in the bracket.
      v_n := public.league_active_days(p_user_id, p_from, p_to);

    WHEN 'cardio_2' THEN
      -- Sessions of ten minutes or more saved this week.
      SELECT count(*) INTO v_n FROM public.cardio_logs
       WHERE user_id = p_user_id
         AND created_at >= p_from::timestamptz AND created_at < (p_to + 1)::timestamptz
         AND COALESCE(duration_seconds, 0) >= 600;

    WHEN 'water_3' THEN
      SELECT count(DISTINCT day) INTO v_n FROM public.action_xp_ledger
       WHERE user_id = p_user_id AND action_type = 'water_goal_met'
         AND day BETWEEN p_from AND p_to AND amount > 0;

    WHEN 'scan_meals_3' THEN
      SELECT count(DISTINCT day) INTO v_n FROM public.action_xp_ledger
       WHERE user_id = p_user_id AND action_type IN ('photo_meal', 'barcode_meal')
         AND day BETWEEN p_from AND p_to AND amount > 0;

    WHEN 'bounty_1' THEN
      SELECT count(*) INTO v_n FROM public.bounty_claims
       WHERE claimant_id = p_user_id AND status = 'completed'
         AND completed_at >= p_from::timestamptz AND completed_at < (p_to + 1)::timestamptz;

    ELSE
      v_n := 0;
  END CASE;
  RETURN COALESCE(v_n, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.league_quest_progress_internal(uuid, text, date, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_league_quests()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_from date := (date_trunc('week', CURRENT_DATE))::date;
  v_to   date := (date_trunc('week', CURRENT_DATE))::date + 6;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'week_start', v_from,
    'week_end',   v_to,
    'quests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'quest_id', d.quest_id,
               'target',   d.target,
               'xp',       d.xp,
               'progress', LEAST(d.target, public.league_quest_progress_internal(v_uid, d.quest_id, v_from, v_to)),
               'claimed',  c.quest_id IS NOT NULL,
               'xp_awarded', c.xp
             ) ORDER BY d.sort)
        FROM public._league_quest_def() d
        LEFT JOIN public.league_quest_claims c
          ON c.user_id = v_uid AND c.week_start = v_from AND c.quest_id = d.quest_id
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_league_quests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_league_quests() TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_league_quest(p_quest_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_from   date := (date_trunc('week', CURRENT_DATE))::date;
  v_to     date := (date_trunc('week', CURRENT_DATE))::date + 6;
  v_target integer;
  v_xp     integer;
  v_done   integer;
  v_credit integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT d.target, d.xp INTO v_target, v_xp FROM public._league_quest_def() d WHERE d.quest_id = p_quest_id;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'unknown quest' USING ERRCODE = '22023';
  END IF;

  -- League quests are for lifters in this week's league.
  IF NOT EXISTS (
    SELECT 1 FROM public.league_members m JOIN public.leagues l ON l.id = m.league_id
     WHERE m.user_id = v_uid AND l.week_start = v_from
  ) THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'no_league', 'xp_awarded', 0);
  END IF;

  v_done := public.league_quest_progress_internal(v_uid, p_quest_id, v_from, v_to);
  IF v_done < v_target THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'not_met',
                              'progress', v_done, 'target', v_target, 'xp_awarded', 0);
  END IF;

  INSERT INTO public.league_quest_claims (user_id, week_start, quest_id)
  VALUES (v_uid, v_from, p_quest_id)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'already_claimed', 'xp_awarded', 0);
  END IF;

  v_credit := COALESCE(public.grant_action_xp_internal('league_quest', v_xp), 0);
  UPDATE public.league_quest_claims SET xp = v_credit
   WHERE user_id = v_uid AND week_start = v_from AND quest_id = p_quest_id;

  IF v_credit > 0 THEN
    PERFORM public.sync_my_weekly_league();
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'xp_awarded', v_credit);
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_league_quest(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_league_quest(text) TO authenticated;

------------------------------------------------------------------------------
-- 8. Probe: attempt it as a real authenticated user, then roll back
------------------------------------------------------------------------------
DO $probe$
DECLARE
  u     uuid := gen_random_uuid();
  mail  text;
  wk    date := (date_trunc('week', CURRENT_DATE))::date;
  lg    uuid;
  r     jsonb;
  n     integer;
BEGIN
  BEGIN
    mail := 'league-points-probe-' || u || '@example.invalid';
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    VALUES (u, mail, 'authenticated', 'authenticated', FALSE);
    INSERT INTO public.user_profiles (id, email) VALUES (u, mail) ON CONFLICT (id) DO NOTHING;
    UPDATE public.user_profiles
       SET weight_lbs = 154, gender = 'male', age = 30, birthday = NULL, timezone_offset_minutes = 0
     WHERE id = u;

    -- Same answer as dailyWaterGoalOz for this profile: 100 oz, rounded to
    -- whole 8 oz glasses (12.5 -> 13) = 104.
    IF public.water_goal_oz_for(u) <> 104 THEN
      RAISE EXCEPTION 'probe: water goal % expected 104', public.water_goal_oz_for(u);
    END IF;

    INSERT INTO public.leagues (tier, week_start, week_end) VALUES ('bronze', wk, wk + 6) RETURNING id INTO lg;
    INSERT INTO public.league_members (league_id, user_id, user_email, tier) VALUES (lg, u, mail, 'bronze');

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', u, 'role', 'authenticated', 'email', mail)::text, true);
    SET LOCAL ROLE authenticated;

    -- The client can no longer be paid per glass.
    IF public.grant_action_xp('water_logged', 3) <> 0 THEN
      RAISE EXCEPTION 'probe: water still pays per glass';
    END IF;

    -- Half the goal pays nothing.
    INSERT INTO public.nutrition_logs (created_by, user_id, date, food_name, calories)
    VALUES (mail, u, (public.user_local_now(u))::date, 'Water|52', 0);
    r := public.sync_my_logging_points();
    IF (r->>'water_goal_met')::int <> 0 THEN RAISE EXCEPTION 'probe: water paid below goal: %', r; END IF;

    -- Reaching it pays 20 once.
    INSERT INTO public.nutrition_logs (created_by, user_id, date, food_name, calories)
    VALUES (mail, u, (public.user_local_now(u))::date, 'Water|52', 0);
    r := public.sync_my_logging_points();
    IF (r->>'water_goal_met')::int <> 20 THEN RAISE EXCEPTION 'probe: water goal paid wrong: %', r; END IF;
    r := public.sync_my_logging_points();
    IF (r->>'xp')::int <> 0 THEN RAISE EXCEPTION 'probe: sync paid twice: %', r; END IF;

    -- A forged photo meal with no scanner call pays nothing.
    INSERT INTO public.nutrition_logs (created_by, user_id, date, food_name, calories, image_url, ai_meta)
    VALUES (mail, u, current_date, 'Bowl', 500, 'https://x/y.jpg', '{"source":"photo_ai"}');
    r := public.sync_my_logging_points();
    IF (r->>'photo_meal')::int <> 0 THEN RAISE EXCEPTION 'probe: unscanned photo paid: %', r; END IF;

    -- Three scanned photo meals pay for two.
    RESET ROLE;
    INSERT INTO public.recognize_meal_quota (user_id, day, call_count)
    VALUES (u, (now() AT TIME ZONE 'utc')::date, 3);
    SET LOCAL ROLE authenticated;
    INSERT INTO public.nutrition_logs (created_by, user_id, date, food_name, calories, image_url, ai_meta)
    VALUES (mail, u, current_date, 'Bowl 2', 500, 'https://x/z.jpg', '{"source":"photo_ai"}'),
           (mail, u, current_date, 'Bowl 3', 500, 'https://x/w.jpg', '{"source":"photo_ai"}');
    r := public.sync_my_logging_points();
    IF (r->>'photo_meal')::int <> 30 THEN RAISE EXCEPTION 'probe: photo meals paid wrong: %', r; END IF;

    -- The same barcode twice is one product; a third product is past the cap.
    INSERT INTO public.nutrition_logs (created_by, user_id, date, food_name, calories, ai_meta)
    VALUES (mail, u, current_date, 'Bar', 200, '{"source":"barcode","barcode":"0123456789012"}'),
           (mail, u, current_date, 'Bar', 200, '{"source":"barcode","barcode":"0123456789012"}');
    r := public.sync_my_logging_points();
    IF (r->>'barcode_meal')::int <> 10 THEN RAISE EXCEPTION 'probe: barcode paid wrong: %', r; END IF;
    INSERT INTO public.nutrition_logs (created_by, user_id, date, food_name, calories, ai_meta)
    VALUES (mail, u, current_date, 'Chips', 200, '{"source":"barcode","barcode":"4006381333931"}'),
           (mail, u, current_date, 'Soda', 200, '{"source":"barcode","barcode":"5449000000996"}'),
           (mail, u, current_date, 'Fake', 200, '{"source":"barcode","barcode":"abc"}');
    r := public.sync_my_logging_points();
    IF (r->>'barcode_meal')::int <> 10 THEN RAISE EXCEPTION 'probe: barcode cap wrong: %', r; END IF;

    -- Weekly quests: the meal and water days count, training does not yet.
    r := public.get_my_league_quests();
    IF jsonb_array_length(r->'quests') <> 6 THEN RAISE EXCEPTION 'probe: quest list %', r; END IF;
    r := public.claim_league_quest('train_2');
    IF r->>'reason' IS DISTINCT FROM 'not_met' THEN RAISE EXCEPTION 'probe: unmet quest paid: %', r; END IF;

    INSERT INTO public.cardio_logs (user_id, created_by, type, date, duration_seconds, distance_meters)
    VALUES (u, mail, 'running_outside', current_date, 1800, 5000),
           (u, mail, 'running_outside',
            CASE WHEN current_date > wk THEN current_date - 1 ELSE current_date + 1 END, 1800, 5000);
    r := public.claim_league_quest('train_2');
    IF NOT (r->>'success')::boolean OR (r->>'xp_awarded')::int <> 100 THEN
      RAISE EXCEPTION 'probe: train_2 paid wrong: %', r;
    END IF;
    r := public.claim_league_quest('train_2');
    IF r->>'reason' IS DISTINCT FROM 'already_claimed' THEN RAISE EXCEPTION 'probe: quest paid twice: %', r; END IF;
    r := public.claim_league_quest('cardio_2');
    IF (r->>'xp_awarded')::int <> 100 THEN RAISE EXCEPTION 'probe: cardio_2 paid wrong: %', r; END IF;

    -- The client cannot write claims or reach the internals.
    BEGIN
      INSERT INTO public.league_quest_claims (user_id, week_start, quest_id) VALUES (u, wk, 'bounty_1');
      RAISE EXCEPTION 'probe: client wrote a quest claim';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    RESET ROLE;
    IF has_function_privilege('authenticated', 'public.league_quest_progress_internal(uuid, text, date, date)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.water_goal_oz_for(uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.sync_my_logging_points()', 'EXECUTE')
       OR has_function_privilege('anon', 'public.claim_league_quest(text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'probe: internals reachable by clients';
    END IF;
    IF pg_get_functiondef('public.complete_bounty_claim(uuid, uuid)'::regprocedure) NOT LIKE '%bounty_completed%' THEN
      RAISE EXCEPTION 'probe: bounty does not pay league points';
    END IF;

    -- The bracket sees it: 20 water + 30 photo + 10 barcode + 200 quests.
    SELECT weekly_xp INTO n FROM public.league_members WHERE league_id = lg AND user_id = u;
    IF n <> 260 THEN RAISE EXCEPTION 'probe: weekly_xp %, expected 260', n; END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'probe passed';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
END;
$probe$;
