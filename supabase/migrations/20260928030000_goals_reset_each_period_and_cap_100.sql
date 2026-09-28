-- Goals: weekly and monthly goals reset every period; goal XP caps at 100 a day.
--
-- Two findings from the audit of the shipped Goals work (2026-09-28), both
-- Kegan's call, both built on the recommended option.
--
-- 1. A "this week" or "this month" cardio goal never reset. goal_is_met
--    counted every run since the period_start_date the form wrote on the
--    day the goal was made, and once met the goal was completed for good.
--    So "run 10 km a week" was really "run 10 km, starting the week I set
--    it", and the label was wrong from the second week on.
--
--    Now a week or month goal stays active and is met once per period:
--      • the period is the user's CURRENT week (Monday) or month (the 1st),
--        in their own timezone, via user_local_now;
--      • only runs dated inside that period count;
--      • meeting it records the period in goals.period_met_start and pays
--        goal_xp once for that period. Next Monday or the 1st it starts
--        over, with no reset job: the floor moves by itself.
--    Lifetime goals and strength goals are unchanged: met once, completed.
--    Production has no week or month goals today (3 goals, all lifetime),
--    so nothing existing changes meaning.
--
-- 2. The 'goal_completed' daily cap was 500. goal_is_met checks that a set
--    was logged, and the plausibility flag checks a day's VOLUME, so one
--    fake 1000 lb single clears a "Bench 1000 x 1" goal without tripping
--    anything. Five of those a day was 500 XP. The cap is now 100, one
--    goal's worth. A second goal the same day still completes and
--    celebrates; it pays what is left of the 100.

-- ── Where the current period started ────────────────────────────────────
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS period_met_start date;

COMMENT ON COLUMN public.goals.period_met_start IS
  'Week or month goals: the start of the last period the goal was met and paid in. Written only by complete_goal.';

CREATE OR REPLACE FUNCTION public.goal_period_start(p_period text, p_uid uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- date_trunc('week') is ISO, so Monday, matching the app.
  SELECT CASE p_period
    WHEN 'week'  THEN date_trunc('week',  v.local_now)::date
    WHEN 'month' THEN date_trunc('month', v.local_now)::date
  END
  FROM (SELECT COALESCE(public.user_local_now(p_uid), now() AT TIME ZONE 'UTC') AS local_now) v;
$function$;

REVOKE ALL ON FUNCTION public.goal_period_start(text, uuid) FROM PUBLIC, anon, authenticated;

-- ── The guard also pins period_met_start ────────────────────────────────
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

-- ── Met in the current period ───────────────────────────────────────────
-- 20260927204000's body; only the cardio period floor changed, from the
-- stored period_start_date to the start of the current period.
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

    SELECT COALESCE(SUM(CASE p_goal.goal_type
             WHEN 'cardio_distance' THEN COALESCE(c.distance_meters, 0)
             WHEN 'cardio_duration' THEN COALESCE(c.duration_seconds, 0)
             ELSE 1 END), 0)
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

-- ── Complete, or meet this period, and pay ──────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_goal(p_goal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_email  text := NULLIF(public.current_user_email(), '');
  v_goal   public.goals;
  v_period date;
  v_xp     integer;
  v_credit integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF p_goal_id IS NULL THEN RAISE EXCEPTION 'goal_id required' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_goal FROM public.goals
   WHERE id = p_goal_id
     -- Same ownership test as the version this replaces, which keyed on
     -- created_by; user_id is nullable on this table.
     AND (user_id = v_uid OR (v_email IS NOT NULL AND created_by = v_email))
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'goal not found' USING ERRCODE = '42501';
  END IF;
  IF v_goal.status = 'completed' THEN
    RETURN jsonb_build_object('completed', false, 'already', true, 'goal_id', p_goal_id);
  END IF;
  IF v_goal.status <> 'active' THEN
    RETURN jsonb_build_object('completed', false, 'reason', 'not_active', 'goal_id', p_goal_id);
  END IF;

  -- Week and month goals recur. Only cardio goals carry a period; the form
  -- writes 'lifetime' for strength, and a strength row with another value
  -- is treated as lifetime, as goal_is_met already does.
  IF v_goal.goal_type IN ('cardio_distance', 'cardio_duration', 'cardio_sessions') THEN
    v_period := public.goal_period_start(v_goal.period, v_uid);
  END IF;

  IF v_period IS NOT NULL AND v_goal.period_met_start IS NOT NULL
     AND v_goal.period_met_start >= v_period THEN
    RETURN jsonb_build_object('completed', false, 'already', true, 'goal_id', p_goal_id,
                              'period_start', v_period);
  END IF;
  IF NOT public.goal_is_met(v_goal, v_uid) THEN
    RETURN jsonb_build_object('completed', false, 'reason', 'not_met', 'goal_id', p_goal_id);
  END IF;

  PERFORM set_config('flexyn.goal_complete', 'on', true);
  IF v_period IS NOT NULL THEN
    -- Met for this period. It stays active and counts again from the next.
    UPDATE public.goals
       SET period_met_start = v_period, period_start_date = v_period
     WHERE id = p_goal_id AND status = 'active';
  ELSE
    -- achieved_* is what Hub posts show as "achieved / target". The client
    -- used to write it after completing; the target is what was met.
    UPDATE public.goals
       SET status = 'completed', completed_at = now(),
           achieved_weight = NULLIF(target_weight, 0),
           achieved_reps   = NULLIF(target_reps, 0)
     WHERE id = p_goal_id AND status = 'active';
  END IF;
  PERFORM set_config('flexyn.goal_complete', 'off', true);

  -- Paid through the internal ledger grant under the 'goal_completed' cap
  -- (100 a day since this migration), then increment_user_xp's 24h cap
  -- and xp_grant_log.
  v_xp := public.goal_xp(v_goal);
  IF v_xp > 0 THEN
    v_credit := COALESCE(public.grant_action_xp_internal('goal_completed', v_xp), 0);
  END IF;

  RETURN jsonb_build_object('completed', true, 'goal_id', p_goal_id, 'xp', v_credit,
                            'recurring', v_period IS NOT NULL, 'period_start', v_period);
END;
$function$;

REVOKE ALL ON FUNCTION public.goal_is_met(public.goals, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_goal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_goal(uuid) TO authenticated;

-- ── Goal XP: 100 a day ──────────────────────────────────────────────────
-- The installed body (pg_get_functiondef, 2026-09-28) with one number
-- changed: 'goal_completed' 500 → 100.
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

-- ── Probe: attempt it as a real authenticated user, then roll back ─────
DO $$
DECLARE
  u      uuid := gen_random_uuid();
  mail   text;
  gw     uuid;
  gs     uuid;
  gl     uuid;
  r      jsonb;
  st     text;
  wk     date := date_trunc('week', now() AT TIME ZONE 'UTC')::date;
  n      integer;
BEGIN
  BEGIN
    mail := 'goal-period-probe-' || u || '@example.invalid';
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    VALUES (u, mail, 'authenticated', 'authenticated', FALSE);
    INSERT INTO public.user_profiles (id, email) VALUES (u, mail) ON CONFLICT (id) DO NOTHING;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', u, 'role', 'authenticated', 'email', mail)::text, true);
    SET LOCAL ROLE authenticated;

    -- A weekly 5 km goal. A run dated last week does not count.
    INSERT INTO public.goals (user_id, created_by, goal_type, cardio_activity, period,
                              period_start_date, target_distance_meters, period_met_start)
    VALUES (u, mail, 'cardio_distance', 'running', 'week', wk - 7, 5000, wk)
    RETURNING id INTO gw;
    IF (SELECT period_met_start FROM public.goals WHERE id = gw) IS NOT NULL THEN
      RAISE EXCEPTION 'probe: goal was inserted already met';
    END IF;
    INSERT INTO public.cardio_logs (user_id, created_by, type, date, duration_seconds, distance_meters)
    VALUES (u, mail, 'running_outside', wk - 1, 1800, 5000);
    r := public.complete_goal(gw);
    IF r->>'reason' IS DISTINCT FROM 'not_met' THEN
      RAISE EXCEPTION 'probe: last week''s run met this week''s goal: %', r;
    END IF;

    -- A run this week meets it, pays 20, and the goal stays active.
    INSERT INTO public.cardio_logs (user_id, created_by, type, date, duration_seconds, distance_meters)
    VALUES (u, mail, 'running_outside', wk, 1800, 5000);
    r := public.complete_goal(gw);
    IF NOT (r->>'completed')::boolean OR NOT (r->>'recurring')::boolean OR (r->>'xp')::int <> 20 THEN
      RAISE EXCEPTION 'probe: weekly goal paid wrong: %', r;
    END IF;
    SELECT status INTO st FROM public.goals WHERE id = gw;
    IF st <> 'active' THEN RAISE EXCEPTION 'probe: weekly goal left active as %', st; END IF;

    -- Once per week: asking again pays nothing.
    r := public.complete_goal(gw);
    IF NOT COALESCE((r->>'already')::boolean, FALSE) THEN
      RAISE EXCEPTION 'probe: weekly goal paid twice in a week: %', r;
    END IF;

    -- The client cannot clear the mark to be paid again.
    UPDATE public.goals SET period_met_start = NULL WHERE id = gw;
    IF (SELECT period_met_start FROM public.goals WHERE id = gw) IS DISTINCT FROM wk THEN
      RAISE EXCEPTION 'probe: client cleared period_met_start';
    END IF;

    -- Goal XP stops at 100 a day: an 80 XP-worth strength goal gets what is left.
    INSERT INTO public.goals (user_id, created_by, goal_type, exercise_name, target_weight, target_reps)
    VALUES (u, mail, 'strength', 'Bench Press', 100, 10) RETURNING id INTO gs;
    INSERT INTO public.workout_logs (user_id, created_by, date, exercises)
    VALUES (u, mail, current_date, '[{"name":"Bench Press","sets":[{"weight":100,"reps":10}]}]');
    r := public.complete_goal(gs);
    IF NOT (r->>'completed')::boolean OR (r->>'xp')::int <> 80 OR (r->>'recurring')::boolean THEN
      RAISE EXCEPTION 'probe: strength goal under the cap paid wrong: %', r;
    END IF;
    SELECT status INTO st FROM public.goals WHERE id = gs;
    IF st <> 'completed' THEN RAISE EXCEPTION 'probe: lifetime goal not completed'; END IF;

    -- Past the cap, a goal still completes and pays nothing.
    INSERT INTO public.goals (user_id, created_by, goal_type, exercise_name, target_reps)
    VALUES (u, mail, 'strength', 'Pull-ups', 5) RETURNING id INTO gl;
    INSERT INTO public.workout_logs (user_id, created_by, date, exercises)
    VALUES (u, mail, current_date, '[{"name":"Pull-ups","sets":[{"weight":0,"reps":5}]}]');
    r := public.complete_goal(gl);
    IF NOT (r->>'completed')::boolean OR (r->>'xp')::int <> 0 THEN
      RAISE EXCEPTION 'probe: goal past the daily cap paid wrong: %', r;
    END IF;

    RESET ROLE;
    -- Next week: simulate by moving the mark back a week. It is met again
    -- by this week's run, and pays nothing because today's 100 is spent.
    PERFORM set_config('flexyn.goal_complete', 'on', true);
    UPDATE public.goals SET period_met_start = wk - 7 WHERE id = gw;
    PERFORM set_config('flexyn.goal_complete', 'off', true);
    SET LOCAL ROLE authenticated;
    r := public.complete_goal(gw);
    IF NOT (r->>'completed')::boolean OR (r->>'period_start')::date <> wk THEN
      RAISE EXCEPTION 'probe: weekly goal did not recur: %', r;
    END IF;

    RESET ROLE;
    SELECT total_xp INTO n FROM public.user_profiles WHERE id = u;
    IF n <> 100 THEN RAISE EXCEPTION 'probe: total_xp %, expected 100', n; END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'probe passed';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
END;
$$;
