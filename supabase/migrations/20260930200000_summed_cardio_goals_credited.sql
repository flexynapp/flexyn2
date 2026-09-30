-- Summed cardio goals count what the server credits.
--
-- goal_is_met already reads distance_credited_m for single-run goals, but a
-- summed goal ("run 50 km this month") still added raw distance_meters and
-- duration_seconds. Those are whatever the client typed: a run logged inside
-- a workout has no caps on the form, so one entry of 5000 km with no time
-- finished any summed distance goal and paid its goal XP.
--
-- Now a summed distance goal adds distance_credited_m, the value the credit
-- trigger stores (zero with no duration or faster than 90 km/h, 200 km a
-- session, 500 km a day), and a summed duration goal counts at most 12 hours
-- a row, the Cardio form's own limit. Every run in production today has
-- distance_credited_m equal to distance_meters and is under 12 hours, so no
-- goal's progress moves.
--
-- The installed body (pg_get_functiondef, 2026-09-30) with those two lines
-- changed; nothing else.

CREATE OR REPLACE FUNCTION public.goal_is_met(p_goal public.goals, p_uid uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_name   text;
  v_tw     numeric := NULLIF(p_goal.target_weight, 0);
  v_tr     integer := NULLIF(p_goal.target_reps, 0);
  v_target numeric;
  v_total  numeric;
  v_floor  date;
  v_single boolean := p_goal.goal_type = 'cardio_distance' AND COALESCE(p_goal.single_session, false);
BEGIN
  IF p_uid IS NULL THEN RETURN false; END IF;

  IF p_goal.goal_type IN ('cardio_distance', 'cardio_duration', 'cardio_sessions') THEN
    v_target := CASE p_goal.goal_type
      WHEN 'cardio_distance' THEN p_goal.target_distance_meters
      WHEN 'cardio_duration' THEN p_goal.target_duration_seconds
      ELSE p_goal.target_sessions END;
    IF v_target IS NULL OR v_target <= 0 THEN RETURN false; END IF;

    -- NULL for lifetime (and anything that is not week or month).
    v_floor := public.goal_period_start(p_goal.period, p_uid);

    SELECT CASE WHEN v_single
             -- distance_credited_m, not distance_meters: the credit trigger
             -- zeroes a run with no duration or one faster than 90 km/h, so
             -- a typed 42 km in one minute cannot finish a marathon goal.
             THEN COALESCE(MAX(COALESCE(c.distance_credited_m, 0)), 0)
             ELSE COALESCE(SUM(CASE p_goal.goal_type
               -- Credited distance for summed goals too, and at most 12 h
               -- a row, so one typed run cannot finish a goal on its own.
               WHEN 'cardio_distance' THEN COALESCE(c.distance_credited_m, 0)
               WHEN 'cardio_duration' THEN LEAST(GREATEST(COALESCE(c.duration_seconds, 0), 0), 43200)
               ELSE 1 END), 0)
           END
      INTO v_total
      FROM public.cardio_logs c
     WHERE c.user_id = p_uid
       AND c.created_date >= p_goal.created_date
       AND (v_floor IS NULL OR c.date >= v_floor)
       AND (COALESCE(p_goal.cardio_activity, 'any') = 'any'
            OR c.type LIKE p_goal.cardio_activity || '\_%');
    RETURN v_total >= v_target;
  END IF;

  -- Strength: one set.
  v_name := lower(btrim(COALESCE(NULLIF(p_goal.exercise_canonical, ''), p_goal.exercise_name, '')));
  IF v_name = '' OR (v_tw IS NULL AND v_tr IS NULL) THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public.workout_logs w
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(w.exercises) = 'array' THEN w.exercises ELSE '[]'::jsonb END) ex
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(ex -> 'sets') = 'array' THEN ex -> 'sets' ELSE '[]'::jsonb END) s
     WHERE w.user_id = p_uid
       AND NOT COALESCE(w.implausible, false)
       AND w.created_date >= p_goal.created_date
       AND lower(btrim(ex ->> 'name')) = v_name
       AND (s ->> 'reps') ~ '^[0-9]+(\.[0-9]+)?$'
       AND (s ->> 'reps')::numeric > 0
       AND (v_tr IS NULL OR (s ->> 'reps')::numeric >= v_tr)
       AND (v_tw IS NULL OR ((s ->> 'weight') ~ '^[0-9]+(\.[0-9]+)?$'
                             AND (s ->> 'weight')::numeric >= v_tw))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.goal_is_met(public.goals, uuid) FROM PUBLIC, anon, authenticated;

-- ── Check it: attempt, both directions, rolled back ─────────────────────
-- Three honest 2 km runs still meet a 5 km summed goal. A 5000 km entry with
-- no time does not meet a 10 km summed goal, and a 100 hour entry does not
-- meet a 20 hour duration goal.
DO $check$
DECLARE
  v_uid uuid;
  g_sum  public.goals;
  g_dist public.goals;
  g_dur  public.goals;
BEGIN
  SELECT id INTO v_uid FROM auth.users LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE 'summed_cardio_goals check skipped: no users';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.goals (user_id, created_by, title, goal_type, cardio_activity, target_distance_meters, period)
    VALUES (v_uid, 'migration-check', 'check sum', 'cardio_distance', 'running', 5000, 'lifetime')
    RETURNING * INTO g_sum;
    INSERT INTO public.cardio_logs (user_id, created_by, type, distance_meters, duration_seconds, date, created_date)
    SELECT v_uid, 'migration-check', 'running_outside', 2000, 720, current_date, now() + interval '1 second'
      FROM generate_series(1, 3);
    IF NOT public.goal_is_met(g_sum, v_uid) THEN
      RAISE EXCEPTION 'summed goal not met by three honest 2 km runs';
    END IF;

    INSERT INTO public.goals (user_id, created_by, title, goal_type, cardio_activity, target_distance_meters, period)
    VALUES (v_uid, 'migration-check', 'check forged distance', 'cardio_distance', 'biking', 10000, 'lifetime')
    RETURNING * INTO g_dist;
    INSERT INTO public.cardio_logs (user_id, created_by, type, distance_meters, duration_seconds, date, created_date)
    VALUES (v_uid, 'migration-check', 'biking_outside', 5000000, NULL, current_date, now() + interval '1 second');
    IF public.goal_is_met(g_dist, v_uid) THEN
      RAISE EXCEPTION 'summed goal met by 5000 km with no time';
    END IF;

    INSERT INTO public.goals (user_id, created_by, title, goal_type, cardio_activity, target_duration_seconds, period)
    VALUES (v_uid, 'migration-check', 'check forged duration', 'cardio_duration', 'swimming', 72000, 'lifetime')
    RETURNING * INTO g_dur;
    INSERT INTO public.cardio_logs (user_id, created_by, type, distance_meters, duration_seconds, date, created_date)
    VALUES (v_uid, 'migration-check', 'swimming_pool', NULL, 360000, current_date, now() + interval '1 second');
    IF public.goal_is_met(g_dur, v_uid) THEN
      RAISE EXCEPTION 'duration goal met by one 100 hour entry';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'summed_cardio_goals_check_ok';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'summed_cardio_goals_check_ok' THEN RAISE; END IF;
  END;
END
$check$;
