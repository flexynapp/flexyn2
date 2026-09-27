-- Goals complete and pay on the server.
--
-- Before this, completing a goal was two client calls: complete_goal()
-- flipped the status and paid nothing, then the app sent an XP amount it
-- had computed itself through grant_action_xp('goal_completed', n). So:
--   • the amount was whatever the client sent (capped at 500 a day),
--   • nothing checked the goal had been met: any signed-in user could
--     create "Bench 225 × 5", call complete_goal, and claim it,
--   • the owner-ALL policy let a client write status, completed_at and
--     created_date directly, so a completed goal could be set back to
--     active and paid again, and a goal could be backdated so old
--     sessions counted toward it,
--   • cardio goals paid 0, because the client formula only read weight
--     and reps.
--
-- After: complete_goal(uuid) checks the goal against the caller's own
-- logs, computes the XP, and pays it once, on the active → completed
-- flip, through the same per-day ledger (500/day) and increment_user_xp
-- (24h cap + xp_grant_log), via grant_action_xp_internal (20260927203000).
-- grant_action_xp no longer accepts 'goal_completed', so the old client
-- door is shut. A guard trigger pins
-- created_date, completed_at and the completed status against client
-- writes.
--
-- Progress rules match src/lib/goalProgress.js:
--   • strength is ONE set: weight >= target (if set) AND reps >= target
--     (if set), in a session logged after the goal was created. Flagged
--     (implausible) sessions do not count: a goal pays XP, so it is a
--     credited read (see CLAUDE.md, Plausibility).
--   • cardio sums distance / duration / sessions for the activity since
--     the goal was created, and since the period start for week/month.

-- ── Guard: the client cannot complete, un-complete or backdate a goal ──
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
  -- Completing is complete_goal's job; un-completing is nobody's.
  IF OLD.status = 'completed' THEN
    NEW.status := 'completed';
  ELSIF NEW.status = 'completed' THEN
    NEW.status := OLD.status;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS goals_guard_write ON public.goals;
CREATE TRIGGER goals_guard_write
  BEFORE INSERT OR UPDATE ON public.goals
  FOR EACH ROW EXECUTE FUNCTION public.goals_guard_write();

-- ── Is this goal met, from the owner's own logs? ────────────────────────
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
BEGIN
  IF p_uid IS NULL THEN RETURN false; END IF;

  IF p_goal.goal_type IN ('cardio_distance', 'cardio_duration', 'cardio_sessions') THEN
    v_target := CASE p_goal.goal_type
      WHEN 'cardio_distance' THEN p_goal.target_distance_meters
      WHEN 'cardio_duration' THEN p_goal.target_duration_seconds
      ELSE p_goal.target_sessions END;
    IF v_target IS NULL OR v_target <= 0 THEN RETURN false; END IF;

    SELECT COALESCE(SUM(CASE p_goal.goal_type
             WHEN 'cardio_distance' THEN COALESCE(c.distance_meters, 0)
             WHEN 'cardio_duration' THEN COALESCE(c.duration_seconds, 0)
             ELSE 1 END), 0)
      INTO v_total
      FROM public.cardio_logs c
     WHERE c.user_id = p_uid
       AND c.created_date >= p_goal.created_date
       AND (p_goal.period IS NULL OR p_goal.period = 'lifetime'
            OR p_goal.period_start_date IS NULL OR c.date >= p_goal.period_start_date)
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

-- ── What a goal pays ────────────────────────────────────────────────────
-- Strength is the client formula it replaces (xpSystem.calculateGoalXp).
-- Cardio is new: it paid nothing. Every goal caps at 100.
CREATE OR REPLACE FUNCTION public.goal_xp(p_goal public.goals)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT LEAST(100, GREATEST(0, floor(CASE
    WHEN p_goal.goal_type = 'cardio_distance' THEN COALESCE(p_goal.target_distance_meters, 0) / 1000.0 * 4
    WHEN p_goal.goal_type = 'cardio_duration' THEN COALESCE(p_goal.target_duration_seconds, 0) / 60.0 / 2
    WHEN p_goal.goal_type = 'cardio_sessions' THEN COALESCE(p_goal.target_sessions, 0) * 10
    WHEN COALESCE(p_goal.target_weight, 0) > 0 AND COALESCE(p_goal.target_reps, 0) > 0
      THEN p_goal.target_weight * 0.5 + p_goal.target_reps * 3
    WHEN COALESCE(p_goal.target_weight, 0) > 0 THEN p_goal.target_weight * 0.75
    ELSE COALESCE(p_goal.target_reps, 0) * 4
  END)))::integer;
$function$;

-- ── Complete and pay ────────────────────────────────────────────────────
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
  IF NOT public.goal_is_met(v_goal, v_uid) THEN
    RETURN jsonb_build_object('completed', false, 'reason', 'not_met', 'goal_id', p_goal_id);
  END IF;

  PERFORM set_config('flexyn.goal_complete', 'on', true);
  -- achieved_* is what Hub posts show as "achieved / target". The client
  -- used to write it after completing; the target is what was met.
  UPDATE public.goals
     SET status = 'completed', completed_at = now(),
         achieved_weight = NULLIF(target_weight, 0),
         achieved_reps   = NULLIF(target_reps, 0)
   WHERE id = p_goal_id AND status = 'active';
  PERFORM set_config('flexyn.goal_complete', 'off', true);

  -- Paid through the internal ledger grant (20260927203000) under the
  -- existing 'goal_completed' cap of 500 a day, then increment_user_xp's
  -- 24h cap and xp_grant_log.
  v_xp := public.goal_xp(v_goal);
  IF v_xp > 0 THEN
    v_credit := COALESCE(public.grant_action_xp_internal('goal_completed', v_xp), 0);
  END IF;

  RETURN jsonb_build_object('completed', true, 'goal_id', p_goal_id, 'xp', v_credit);
END;
$function$;

REVOKE ALL ON FUNCTION public.goal_is_met(public.goals, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.goal_xp(public.goals) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_goal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_goal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.goal_xp(public.goals) TO authenticated;

-- ── Shut the old door ───────────────────────────────────────────────────
-- 20260927203000's body with the 'goal_completed' line removed, so a
-- client can no longer name any goal XP. An action not listed pays 0.
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
  v_amount := CASE p_action_type
    WHEN 'water_logged'    THEN 3
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

-- ── Probe: attempt it as a real authenticated user, then roll back ─────
DO $$
DECLARE
  u      uuid := gen_random_uuid();
  other  uuid := gen_random_uuid();
  mail   text;
  omail  text;
  g      uuid;
  gc     uuid;
  g_other uuid;
  r      jsonb;
  st     text;
  n      integer;
  v_refused boolean;
BEGIN
  BEGIN
    mail  := 'goal-probe-' || u || '@example.invalid';
    omail := 'goal-probe-' || other || '@example.invalid';
    INSERT INTO auth.users (id, email, aud, role, is_anonymous) VALUES
      (u, mail, 'authenticated', 'authenticated', FALSE),
      (other, omail, 'authenticated', 'authenticated', FALSE);
    INSERT INTO public.user_profiles (id, email) VALUES (u, mail), (other, omail)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.goals (user_id, created_by, goal_type, exercise_name, target_reps)
    VALUES (other, omail, 'strength', 'Pull-ups', 1) RETURNING id INTO g_other;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', u, 'role', 'authenticated', 'email', mail)::text, true);
    SET LOCAL ROLE authenticated;

    -- A goal cannot be born completed or backdated.
    INSERT INTO public.goals (user_id, created_by, goal_type, exercise_name, target_weight, target_reps,
                              status, created_date, completed_at)
    VALUES (u, mail, 'strength', 'Bench Press', 225, 5, 'completed', now() - interval '1 year', now())
    RETURNING id INTO g;
    SELECT status INTO st FROM public.goals WHERE id = g;
    IF st <> 'active' THEN RAISE EXCEPTION 'probe: goal inserted as %', st; END IF;
    IF (SELECT created_date FROM public.goals WHERE id = g) < now() THEN
      RAISE EXCEPTION 'probe: goal was backdated';
    END IF;

    -- Not met: nothing changes, nothing pays.
    r := public.complete_goal(g);
    IF r->>'reason' IS DISTINCT FROM 'not_met' THEN RAISE EXCEPTION 'probe: unmet goal completed: %', r; END IF;

    -- A direct write cannot complete it either.
    UPDATE public.goals SET status = 'completed', completed_at = now() WHERE id = g;
    SELECT status INTO st FROM public.goals WHERE id = g;
    IF st <> 'active' THEN RAISE EXCEPTION 'probe: client completed a goal directly'; END IF;

    -- Five singles at 225 are not a set of five.
    INSERT INTO public.workout_logs (user_id, created_by, date, exercises)
    VALUES (u, mail, current_date, '[{"name":"Bench Press","sets":[{"weight":225,"reps":1},{"weight":225,"reps":1},{"weight":225,"reps":1},{"weight":225,"reps":1},{"weight":225,"reps":1}]}]');
    r := public.complete_goal(g);
    IF r->>'reason' IS DISTINCT FROM 'not_met' THEN RAISE EXCEPTION 'probe: singles completed a 5-rep goal: %', r; END IF;

    -- One set of 5 at 225 does, and pays the server's number once.
    INSERT INTO public.workout_logs (user_id, created_by, date, exercises)
    VALUES (u, mail, current_date, '[{"name":"bench press","sets":[{"weight":"225","reps":"5"}]}]');
    r := public.complete_goal(g);
    IF NOT (r->>'completed')::boolean OR (r->>'xp')::int <> 100 THEN
      RAISE EXCEPTION 'probe: met goal paid wrong: %', r;
    END IF;
    r := public.complete_goal(g);
    IF NOT COALESCE((r->>'already')::boolean, FALSE) THEN RAISE EXCEPTION 'probe: goal paid twice: %', r; END IF;

    -- It cannot be reopened to be paid again.
    UPDATE public.goals SET status = 'active', completed_at = NULL WHERE id = g;
    SELECT status INTO st FROM public.goals WHERE id = g;
    IF st <> 'completed' THEN RAISE EXCEPTION 'probe: client reopened a completed goal'; END IF;

    -- Cardio goals pay now: 5 km is 20 XP.
    INSERT INTO public.goals (user_id, created_by, goal_type, cardio_activity, period, target_distance_meters)
    VALUES (u, mail, 'cardio_distance', 'running', 'lifetime', 5000) RETURNING id INTO gc;
    INSERT INTO public.cardio_logs (user_id, created_by, type, date, duration_seconds, distance_meters)
    VALUES (u, mail, 'running_outside', current_date, 1800, 5000);
    r := public.complete_goal(gc);
    IF NOT (r->>'completed')::boolean OR (r->>'xp')::int <> 20 THEN
      RAISE EXCEPTION 'probe: cardio goal paid wrong: %', r;
    END IF;

    -- The client door is shut, and someone else's goal is refused.
    IF public.grant_action_xp('goal_completed', 100) <> 0 THEN
      RAISE EXCEPTION 'probe: client can still name goal XP';
    END IF;
    v_refused := FALSE;
    BEGIN PERFORM public.complete_goal(g_other);
    EXCEPTION WHEN insufficient_privilege THEN v_refused := TRUE; END;
    IF NOT v_refused THEN RAISE EXCEPTION 'probe: completed another user''s goal'; END IF;
    v_refused := FALSE;
    BEGIN PERFORM public.goal_is_met(NULL::public.goals, u);
    EXCEPTION WHEN insufficient_privilege THEN v_refused := TRUE; END;
    IF NOT v_refused THEN RAISE EXCEPTION 'probe: client can call goal_is_met'; END IF;

    RESET ROLE;
    SELECT total_xp INTO n FROM public.user_profiles WHERE id = u;
    IF n <> 120 THEN RAISE EXCEPTION 'probe: total_xp %, expected 120', n; END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'probe passed';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
END;
$$;
