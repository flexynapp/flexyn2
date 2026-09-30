-- Daily quest rewards are paid only when the server can see the work.
--
-- user_daily_quests.progress and completed_at are written by the client
-- (recordActions), and claim_quest_atomic paid any row with completed_at
-- set. The insert guard pins the reward to the difficulty, but not the
-- target, so a signed-in user could insert a row with target 1, set
-- completed_at themselves and claim coins and XP for every difficulty on
-- every open quest day without doing anything.
--
-- This migration:
-- * _quest_def(quest_id): a server copy of QUEST_CATALOG in
--   src/lib/questCatalog.js (action type, target, difficulty). The insert
--   guard now refuses an unknown quest id or a difficulty that disagrees
--   with the catalog, and pins target to the catalog value.
-- * quest_server_progress(user, action, day): recounts the action from the
--   rows the app saves, over the user's local day (timezone_offset_minutes,
--   with three hours of slack either side so a device clock or a trip does
--   not refuse an honest claim).
-- * claim_quest_atomic pays only when that recount reaches the target. On a
--   shortfall it pays nothing and returns reason 'not_met' with the server's
--   count, so the client can show the real progress.
--
-- Counting rules, and why each is what the client credits today:
-- * Rows the app inserts per action (meals, water, workouts, cardio, body
--   metrics, posts, comments, crew messages) count by created_at in the
--   window, because the client credits the quest on the day of the save
--   even when the row carries an earlier date.
-- * Upserted day rows (sleep, mood, steps) count by their date column.
-- * PRs are computed on the device and stored nowhere, so a PR quest needs a
--   cardio session saved that day, the only way the app awards one.
-- * A goal completion counts from goals.completed_at or, for recurring
--   goals that keep no timestamp, the goal_completed XP ledger row.
-- * A progress photo counts from its upload in the progress-photos bucket.
--
-- Rows already claimed are untouched. Nothing is deleted.

CREATE OR REPLACE FUNCTION public._quest_def(p_quest_id text)
 RETURNS TABLE(action_type text, target integer, difficulty text)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT v.action_type, v.target, v.difficulty
    FROM (VALUES
      ('log_meal',         'meal_logged',          1,     'easy'),
      ('drink_water_4',    'water_logged',         4,     'easy'),
      ('workout_15min',    'workout_minutes',      15,    'easy'),
      ('cardio_10min',     'cardio_seconds',       600,   'easy'),
      ('hub_post',         'hub_post_created',     1,     'easy'),
      ('cardio_session',   'cardio_completed',     1,     'easy'),
      ('log_sleep',        'sleep_logged',         1,     'easy'),
      ('log_mood',         'mood_logged',          1,     'easy'),
      ('steps_5k',         'steps_logged',         5000,  'easy'),
      ('hub_react_3',      'hub_reaction_given',   3,     'easy'),
      ('log_body_metric',  'body_metric_logged',   1,     'easy'),
      ('workout_complete', 'workout_completed',    1,     'medium'),
      ('cardio_30min',     'cardio_seconds',       1800,  'medium'),
      ('log_3_meals',      'meal_logged',          3,     'medium'),
      ('drink_water_8',    'water_logged',         8,     'medium'),
      ('progress_photo',   'progress_photo_taken', 1,     'medium'),
      ('workout_30min',    'workout_minutes',      30,    'medium'),
      ('sets_20',          'sets_completed',       20,    'medium'),
      ('steps_10k',        'steps_logged',         10000, 'medium'),
      ('hub_comment_2',    'hub_comment_created',  2,     'medium'),
      ('cardio_double',    'cardio_completed',     2,     'medium'),
      ('volume_10k',       'workout_volume',       10000, 'medium'),
      ('workout_45min',    'workout_minutes',      45,    'hard'),
      ('workout_60min',    'workout_minutes',      60,    'hard'),
      ('cardio_45min',     'cardio_seconds',       2700,  'hard'),
      ('sets_40',          'sets_completed',       40,    'hard'),
      ('volume_25k',       'workout_volume',       25000, 'hard'),
      ('steps_15k',        'steps_logged',         15000, 'hard'),
      ('hit_pr',           'pr_achieved',          1,     'hard'),
      ('goal_complete',    'goal_completed',       1,     'hard'),
      ('crew_workout',     'workout_completed',    1,     'crew'),
      ('crew_cardio',      'cardio_completed',     1,     'crew'),
      ('crew_fuel_2',      'crew_fuel_sent',       2,     'crew'),
      ('crew_chat_3',      'crew_message_sent',    3,     'crew'),
      ('crew_steps_8k',    'steps_logged',         8000,  'crew'),
      ('crew_volume_15k',  'workout_volume',       15000, 'crew')
    ) AS v(quest_id, action_type, target, difficulty)
   WHERE v.quest_id = p_quest_id;
$function$;

REVOKE ALL ON FUNCTION public._quest_def(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.quest_server_progress(p_user_id uuid, p_action text, p_day date)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_off   integer;
  v_from  timestamptz;
  v_to    timestamptz;
  v_n     bigint := 0;
BEGIN
  SELECT COALESCE(timezone_offset_minutes, 0) INTO v_off
    FROM public.user_profiles WHERE id = p_user_id;
  v_off  := COALESCE(v_off, 0);
  -- Local midnight of p_day in UTC, widened by three hours each side.
  v_from := ((p_day::timestamp - make_interval(mins => v_off)) AT TIME ZONE 'UTC') - interval '3 hours';
  v_to   := ((p_day::timestamp + interval '1 day' - make_interval(mins => v_off)) AT TIME ZONE 'UTC') + interval '3 hours';

  CASE p_action
    WHEN 'meal_logged' THEN
      SELECT count(*) INTO v_n FROM public.nutrition_logs
       WHERE user_id = p_user_id AND created_at >= v_from AND created_at < v_to
         AND COALESCE(food_name, '') <> 'Water' AND COALESCE(food_name, '') NOT LIKE 'Water|%';

    WHEN 'water_logged' THEN
      -- One per tap, as the client credits it, whatever the size.
      SELECT count(*) INTO v_n FROM public.nutrition_logs
       WHERE user_id = p_user_id AND created_at >= v_from AND created_at < v_to
         AND (food_name = 'Water' OR food_name LIKE 'Water|%');

    WHEN 'workout_completed' THEN
      -- A run-only workout is a cardio session, not a workout.
      SELECT count(*) INTO v_n FROM public.workout_logs w
       WHERE w.user_id = p_user_id AND w.created_at >= v_from AND w.created_at < v_to
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(w.exercises, '[]'::jsonb)) e
                      WHERE COALESCE(e->>'kind', '') <> 'cardio');

    WHEN 'workout_minutes' THEN
      -- duration minus the runs inside the workout, which count as cardio.
      SELECT COALESCE(sum(GREATEST(0, COALESCE(w.duration_min, 0) - round(COALESCE((
               SELECT sum(COALESCE((s->>'duration_s')::numeric, 0))
                 FROM jsonb_array_elements(COALESCE(w.exercises, '[]'::jsonb)) e
                 CROSS JOIN LATERAL jsonb_array_elements(
                   CASE WHEN jsonb_typeof(e->'segments') = 'array' THEN e->'segments' ELSE '[]'::jsonb END) s
                WHERE e->>'kind' = 'cardio'), 0) / 60.0))), 0)
        INTO v_n FROM public.workout_logs w
       WHERE w.user_id = p_user_id AND w.created_at >= v_from AND w.created_at < v_to;

    WHEN 'sets_completed' THEN
      SELECT count(*) INTO v_n FROM public.workout_logs w
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.exercises, '[]'::jsonb)) e
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(e->'sets') = 'array' THEN e->'sets' ELSE '[]'::jsonb END) s
       WHERE w.user_id = p_user_id AND w.created_at >= v_from AND w.created_at < v_to
         AND (CASE WHEN (s->>'reps') ~ '^[0-9]+(\.[0-9]+)?$' THEN (s->>'reps')::numeric ELSE 0 END) > 0;

    WHEN 'workout_volume' THEN
      SELECT COALESCE(round(sum(
               (CASE WHEN (s->>'weight') ~ '^[0-9]+(\.[0-9]+)?$' THEN (s->>'weight')::numeric ELSE 0 END)
             * (CASE WHEN (s->>'reps')   ~ '^[0-9]+(\.[0-9]+)?$' THEN (s->>'reps')::numeric   ELSE 0 END))), 0)
        INTO v_n FROM public.workout_logs w
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.exercises, '[]'::jsonb)) e
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(e->'sets') = 'array' THEN e->'sets' ELSE '[]'::jsonb END) s
       WHERE w.user_id = p_user_id AND w.created_at >= v_from AND w.created_at < v_to;

    WHEN 'cardio_completed' THEN
      SELECT count(*) INTO v_n FROM public.cardio_logs
       WHERE user_id = p_user_id AND created_at >= v_from AND created_at < v_to;

    WHEN 'cardio_seconds' THEN
      SELECT COALESCE(sum(GREATEST(0, COALESCE(duration_seconds, 0))), 0) INTO v_n FROM public.cardio_logs
       WHERE user_id = p_user_id AND created_at >= v_from AND created_at < v_to;

    WHEN 'pr_achieved' THEN
      SELECT count(*) INTO v_n FROM public.cardio_logs
       WHERE user_id = p_user_id AND created_at >= v_from AND created_at < v_to;

    WHEN 'progress_photo_taken' THEN
      SELECT count(*) INTO v_n FROM storage.objects
       WHERE bucket_id = 'progress-photos' AND name LIKE p_user_id::text || '/%'
         AND created_at >= v_from AND created_at < v_to;

    WHEN 'hub_post_created' THEN
      SELECT count(*) INTO v_n FROM public.hub_posts
       WHERE user_id = p_user_id AND created_at >= v_from AND created_at < v_to;

    WHEN 'hub_reaction_given' THEN
      SELECT count(DISTINCT post_id) INTO v_n FROM public.hub_reactions
       WHERE user_id = p_user_id AND created_at >= v_from AND created_at < v_to;

    WHEN 'hub_comment_created' THEN
      SELECT count(*) INTO v_n FROM public.hub_comments
       WHERE user_id = p_user_id AND created_at >= v_from AND created_at < v_to;

    WHEN 'goal_completed' THEN
      SELECT (SELECT count(*) FROM public.goals
               WHERE user_id = p_user_id AND completed_at >= v_from AND completed_at < v_to)
           + (SELECT count(*) FROM public.action_xp_ledger
               WHERE user_id = p_user_id AND action_type = 'goal_completed' AND day = p_day)
        INTO v_n;

    WHEN 'sleep_logged' THEN
      SELECT count(*) INTO v_n FROM public.sleep_logs WHERE user_id = p_user_id AND date = p_day;

    WHEN 'mood_logged' THEN
      SELECT count(*) INTO v_n FROM public.mood_logs WHERE user_id = p_user_id AND date = p_day;

    WHEN 'steps_logged' THEN
      SELECT COALESCE(max(steps), 0) INTO v_n FROM public.step_logs WHERE user_id = p_user_id AND date = p_day;

    WHEN 'body_metric_logged' THEN
      SELECT count(*) INTO v_n FROM public.body_metrics
       WHERE user_id = p_user_id AND created_at >= v_from AND created_at < v_to;

    WHEN 'crew_message_sent' THEN
      SELECT count(*) INTO v_n FROM public.crew_messages
       WHERE sender_id = p_user_id AND created_at >= v_from AND created_at < v_to
         AND message_type IN ('text', 'image_one_time', 'image_one_hour');

    WHEN 'crew_fuel_sent' THEN
      SELECT count(*) INTO v_n FROM public.crew_messages
       WHERE sender_id = p_user_id AND created_at >= v_from AND created_at < v_to
         AND message_type = 'xp_fuel';

    ELSE
      v_n := 0;
  END CASE;

  RETURN COALESCE(v_n, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.quest_server_progress(uuid, text, date) FROM PUBLIC, anon, authenticated;

-- Insert guard: a quest row must be a catalog quest, at its catalog
-- difficulty and target.
CREATE OR REPLACE FUNCTION public.user_daily_quests_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_server_today DATE := (now() AT TIME ZONE 'utc')::date;
  v_def_target   integer;
  v_def_diff     text;
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.quest_date IS NULL
       OR NEW.quest_date < v_server_today - 1
       OR NEW.quest_date > v_server_today + 1 THEN
      RAISE EXCEPTION 'quest_date out of range' USING ERRCODE = '22023';
    END IF;
    SELECT d.target, d.difficulty INTO v_def_target, v_def_diff
      FROM public._quest_def(NEW.quest_id) d;
    IF v_def_target IS NULL OR v_def_diff IS DISTINCT FROM NEW.difficulty THEN
      RAISE EXCEPTION 'unknown quest' USING ERRCODE = '22023';
    END IF;
    NEW.target := v_def_target;
    NEW.coin_reward := CASE NEW.difficulty
      WHEN 'easy' THEN 8 WHEN 'medium' THEN 20 WHEN 'hard' THEN 50
      WHEN 'crew' THEN 25 ELSE 0 END;
    NEW.xp_reward := CASE NEW.difficulty
      WHEN 'easy' THEN 20 WHEN 'medium' THEN 50 WHEN 'hard' THEN 120
      WHEN 'crew' THEN 60 ELSE 0 END;
    NEW.progress := 0;
    NEW.completed_at := NULL;
    NEW.claimed_at := NULL;
    RETURN NEW;
  END IF;
  IF NEW.coin_reward IS DISTINCT FROM OLD.coin_reward
     OR NEW.xp_reward  IS DISTINCT FROM OLD.xp_reward
     OR NEW.quest_date IS DISTINCT FROM OLD.quest_date
     OR NEW.difficulty IS DISTINCT FROM OLD.difficulty
     OR NEW.quest_id   IS DISTINCT FROM OLD.quest_id
     OR NEW.target     IS DISTINCT FROM OLD.target THEN
    RAISE EXCEPTION 'quest reward/identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.claimed_at IS DISTINCT FROM OLD.claimed_at THEN
    RAISE EXCEPTION 'claimed_at is RPC-only (use claim_quest_atomic)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_quest_atomic(p_quest_row_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_reward       integer;
  v_xp           integer;
  v_difficulty   text;
  v_new_balance  integer;
  v_xp_credited  integer := 0;
  v_crew_id      uuid;
  v_crew_xp      integer := 0;
  v_row          public.user_daily_quests%ROWTYPE;
  v_action       text;
  v_target       integer;
  v_done         bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_quest_row_id IS NULL THEN
    RAISE EXCEPTION 'quest_row_id required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.user_daily_quests
   WHERE id = p_quest_row_id AND user_id = v_uid
   FOR UPDATE;

  IF FOUND AND v_row.claimed_at IS NULL AND v_row.completed_at IS NOT NULL THEN
    SELECT d.action_type, d.target INTO v_action, v_target FROM public._quest_def(v_row.quest_id) d;
    v_done := CASE WHEN v_action IS NULL THEN 0
                   ELSE public.quest_server_progress(v_uid, v_action, v_row.quest_date) END;
    IF v_action IS NULL OR v_done < v_target THEN
      SELECT flex_coins INTO v_new_balance FROM public.user_profiles WHERE id = v_uid;
      RETURN jsonb_build_object(
        'success',         FALSE,
        'already_claimed', FALSE,
        'reason',          'not_met',
        'progress',        LEAST(v_done, COALESCE(v_target, 0)),
        'target',          COALESCE(v_target, v_row.target),
        'coins_awarded',   0,
        'xp_awarded',      0,
        'crew_xp_awarded', 0,
        'new_balance',     COALESCE(v_new_balance, 0)
      );
    END IF;
  END IF;

  UPDATE public.user_daily_quests
     SET claimed_at = now()
   WHERE id           = p_quest_row_id
     AND user_id      = v_uid
     AND completed_at IS NOT NULL
     AND claimed_at   IS NULL
  RETURNING coin_reward, xp_reward, difficulty
       INTO v_reward, v_xp, v_difficulty;
  IF v_reward IS NULL THEN
    SELECT flex_coins INTO v_new_balance
      FROM public.user_profiles
     WHERE id = v_uid;
    RETURN jsonb_build_object(
      'success',         FALSE,
      'already_claimed', TRUE,
      'coins_awarded',   0,
      'xp_awarded',      0,
      'crew_xp_awarded', 0,
      'new_balance',     COALESCE(v_new_balance, 0)
    );
  END IF;
  UPDATE public.user_profiles
     SET flex_coins = COALESCE(flex_coins, 0) + v_reward
   WHERE id = v_uid
  RETURNING flex_coins INTO v_new_balance;
  IF COALESCE(v_xp, 0) > 0 THEN
    v_xp_credited := public.grant_action_xp_internal('daily_quest', v_xp);
  END IF;
  IF v_xp_credited > 0 THEN
    v_crew_id := public.primary_crew_id(v_uid);
    IF v_crew_id IS NOT NULL THEN
      v_crew_xp := CASE
        WHEN v_difficulty = 'crew' THEN v_xp_credited
        ELSE CEIL(v_xp_credited * 0.25)::integer
      END;
      PERFORM public.award_crew_progress(v_crew_id, v_crew_xp, 0, 0, 'quest');
    END IF;
  END IF;
  INSERT INTO public.user_quest_stats
    (user_id, quests_claimed, coins_earned, xp_earned, crew_xp_earned, updated_at)
  VALUES (v_uid, 1, v_reward, v_xp_credited, v_crew_xp, now())
  ON CONFLICT (user_id) DO UPDATE SET
    quests_claimed = public.user_quest_stats.quests_claimed + 1,
    coins_earned   = public.user_quest_stats.coins_earned   + v_reward,
    xp_earned      = public.user_quest_stats.xp_earned      + v_xp_credited,
    crew_xp_earned = public.user_quest_stats.crew_xp_earned + v_crew_xp,
    updated_at     = now();
  RETURN jsonb_build_object(
    'success',         TRUE,
    'already_claimed', FALSE,
    'coins_awarded',   v_reward,
    'xp_awarded',      v_xp_credited,
    'crew_xp_awarded', v_crew_xp,
    'new_balance',     v_new_balance
  );
END;
$function$;

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.quest_server_progress(uuid, text, date)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._quest_def(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'quest helpers are callable by clients';
  END IF;
  IF (SELECT count(*) FROM public._quest_def('volume_25k')) <> 1 THEN
    RAISE EXCEPTION '_quest_def does not resolve a catalog quest';
  END IF;
END $$;
