-- Running goals from onboarding complete on ONE run of the full distance.
--
-- Onboarding turns "I'm training for a marathon" into a cardio_distance goal
-- with period 'lifetime', and goal_is_met SUMS every run since the goal was
-- made. So "Run a Marathon" was met after about 42 km of runs added together,
-- a few weeks of 5Ks, and paid its XP for something the person had not done.
-- Kegan's call (2026-09-30, onboarding thread): a race goal completes only
-- when a single run covers the distance.
--
--   • goals.single_session: when true, a cardio_distance goal takes the
--     LONGEST qualifying run rather than the sum. Default false, so every
--     goal made in the Goals form keeps its meaning.
--   • The two production goals onboarding made ("Run a 5K" x2, both active,
--     notes 'Set from onboarding') are moved to the new rule. Neither has
--     completed, so nothing already paid changes.
--   • goals_guard_write pins the flag after insert, so a single-run goal
--     cannot be turned back into a summed one to finish it early.
--
-- goal_xp is unchanged: the same distance pays the same XP either way.

ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS single_session boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.goals.single_session IS
  'cardio_distance only: met by one run of the full distance (MAX), not the total of all runs (SUM). Fixed at insert.';

-- Before the guard below pins the column.
UPDATE public.goals
   SET single_session = true
 WHERE goal_type = 'cardio_distance'
   AND cardio_activity = 'running'
   AND status = 'active'
   AND notes LIKE '%Set from onboarding%';

-- ── The guard also pins single_session ──────────────────────────────────
-- The installed body (pg_get_functiondef, 2026-09-30) plus one line.
CREATE OR REPLACE FUNCTION public.goals_guard_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rpc boolean := COALESCE(current_setting('flexyn.goal_complete', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A goal starts now and starts active, whatever the client sent.
    NEW.created_date := now();
    NEW.completed_at := NULL;
    NEW.period_met_start := NULL;
    IF NEW.status IS DISTINCT FROM 'archived' THEN
      NEW.status := 'active';
    END IF;
    RETURN NEW;
  END IF;

  NEW.created_date := OLD.created_date;
  -- Chosen when the goal is made. Clearing it would turn "one run of 42 km"
  -- into "42 km in total" and complete the goal early.
  NEW.single_session := OLD.single_session;
  IF v_rpc THEN
    RETURN NEW;
  END IF;

  NEW.completed_at := OLD.completed_at;
  -- Marking a period met is complete_goal's job too, or a client could
  -- clear it and be paid for the same week twice.
  NEW.period_met_start := OLD.period_met_start;
  -- Completing is complete_goal's job; un-completing is nobody's.
  IF OLD.status = 'completed' THEN
    NEW.status := 'completed';
  ELSIF NEW.status = 'completed' THEN
    NEW.status := OLD.status;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── Met: the longest run for a single-run goal ──────────────────────────
-- The installed body (pg_get_functiondef, 2026-09-30); only the aggregate
-- changed, MAX instead of SUM when single_session is set.
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
               WHEN 'cardio_distance' THEN COALESCE(c.distance_meters, 0)
               WHEN 'cardio_duration' THEN COALESCE(c.duration_seconds, 0)
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
-- Three 2 km runs against a 5 km single-run goal: not met (the old SUM rule
-- would say met). Add one 5.1 km run: met. The same three runs against a
-- summed goal: still met, so ordinary goals keep their meaning. A run too
-- fast to be real does not count toward a single-run goal.
DO $check$
DECLARE
  v_uid uuid;
  g_single public.goals;
  g_sum    public.goals;
BEGIN
  SELECT id INTO v_uid FROM auth.users LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE 'single_run_goals check skipped: no users';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.goals (user_id, created_by, title, goal_type, cardio_activity, target_distance_meters, period, single_session)
    VALUES (v_uid, 'migration-check', 'check single', 'cardio_distance', 'running', 5000, 'lifetime', true)
    RETURNING * INTO g_single;
    INSERT INTO public.goals (user_id, created_by, title, goal_type, cardio_activity, target_distance_meters, period, single_session)
    VALUES (v_uid, 'migration-check', 'check sum', 'cardio_distance', 'running', 5000, 'lifetime', false)
    RETURNING * INTO g_sum;

    INSERT INTO public.cardio_logs (user_id, created_by, type, distance_meters, duration_seconds, date, created_date)
    SELECT v_uid, 'migration-check', 'running_outside', 2000, 720, current_date, now() + interval '1 second'
      FROM generate_series(1, 3);

    IF public.goal_is_met(g_single, v_uid) THEN
      RAISE EXCEPTION 'single-run goal met by three 2 km runs';
    END IF;
    IF NOT public.goal_is_met(g_sum, v_uid) THEN
      RAISE EXCEPTION 'summed goal not met by 6 km in total';
    END IF;

    INSERT INTO public.cardio_logs (user_id, created_by, type, distance_meters, duration_seconds, date, created_date)
    VALUES (v_uid, 'migration-check', 'running_outside', 5100, 1800, current_date, now() + interval '1 second');
    IF NOT public.goal_is_met(g_single, v_uid) THEN
      RAISE EXCEPTION 'single-run goal not met by one 5.1 km run';
    END IF;

    -- A 6 km run typed with a 60 second duration is not credited.
    INSERT INTO public.goals (user_id, created_by, title, goal_type, cardio_activity, target_distance_meters, period, single_session)
    VALUES (v_uid, 'migration-check', 'check forged', 'cardio_distance', 'running', 6000, 'lifetime', true)
    RETURNING * INTO g_sum;
    INSERT INTO public.cardio_logs (user_id, created_by, type, distance_meters, duration_seconds, date, created_date)
    VALUES (v_uid, 'migration-check', 'running_outside', 6000, 60, current_date, now() + interval '1 second');
    IF public.goal_is_met(g_sum, v_uid) THEN
      RAISE EXCEPTION 'single-run goal met by a 6 km run in 60 seconds';
    END IF;

    -- A client update cannot clear the flag.
    UPDATE public.goals SET single_session = false WHERE id = g_single.id;
    IF NOT (SELECT single_session FROM public.goals WHERE id = g_single.id) THEN
      RAISE EXCEPTION 'single_session was cleared by an update';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'single_run_goals_check_ok';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'single_run_goals_check_ok' THEN RAISE; END IF;
  END;
END
$check$;
