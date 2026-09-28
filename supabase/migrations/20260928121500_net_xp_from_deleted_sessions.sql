-- Delete and re-log a session no longer pays its XP twice (2026-09-28).
--
-- Found by the Codebase and Infrastructure Cleanup thread with a probe guest:
-- one surviving workout log had been paid 224 XP at 04:31 and 224 again at
-- 12:15. grant_workout_xp keys its receipt (xp_session_credits) on the log id,
-- a re-inserted log gets a new id, and nothing reverses XP on delete. So
-- save, delete, save again paid every time, up to the 4,000 a day
-- workout_completed cap. grant_cardio_xp has the same shape.
--
-- The fix does not take XP back on delete. People delete a wrong or duplicate
-- log and log it again, and taking XP away at the delete would read as a
-- penalty for fixing a mistake. Instead the XP a deleted log was paid stays
-- with the user as credit, and the next session of the same kind within 24
-- hours spends that credit first. A corrected re-log therefore pays only the
-- difference, and an identical one pays nothing.
--
-- The receipt of a log that was paid from credit records the credit it used
-- as well as the XP paid (xp = paid + netted). Without that, deleting the
-- re-log would leave a receipt worth 0 and the third save would pay in full.
--
-- netted_xp counts how much of a deleted log's receipt has been spent, so a
-- large deleted session can cover several smaller re-logs. The 24 hour window
-- matches the 24 hour limit both grant functions already put on a log's age.

ALTER TABLE public.xp_session_credits
  ADD COLUMN IF NOT EXISTS netted_xp integer NOT NULL DEFAULT 0;

-- Spends up to p_amount of the caller's unspent credit from deleted logs of
-- this kind, oldest first. Returns how much was spent.
CREATE OR REPLACE FUNCTION public._net_deleted_session_xp(
  p_kind text, p_uid uuid, p_log_id uuid, p_amount integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r      record;
  v_left integer := GREATEST(COALESCE(p_amount, 0), 0);
  v_take integer;
  v_used integer := 0;
BEGIN
  IF v_left = 0 THEN RETURN 0; END IF;

  FOR r IN
    SELECT c.log_id, c.xp + c.bonus_xp - c.netted_xp AS remaining
      FROM public.xp_session_credits c
     WHERE c.kind = p_kind
       AND c.user_id = p_uid
       AND c.log_id <> p_log_id
       AND c.credited_at > now() - interval '24 hours'
       AND c.xp + c.bonus_xp > c.netted_xp
       AND NOT EXISTS (
             SELECT 1 FROM public.workout_logs w
              WHERE p_kind = 'workout' AND w.id = c.log_id)
       AND NOT EXISTS (
             SELECT 1 FROM public.cardio_logs l
              WHERE p_kind = 'cardio' AND l.id = c.log_id)
     ORDER BY c.credited_at
     FOR UPDATE OF c
  LOOP
    EXIT WHEN v_left = 0;
    v_take := LEAST(v_left, r.remaining);
    UPDATE public.xp_session_credits
       SET netted_xp = netted_xp + v_take
     WHERE kind = p_kind AND log_id = r.log_id;
    v_left := v_left - v_take;
    v_used := v_used + v_take;
  END LOOP;

  RETURN v_used;
END;
$function$;

REVOKE ALL ON FUNCTION public._net_deleted_session_xp(text, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.grant_workout_xp(p_log_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_log       public.workout_logs%ROWTYPE;
  v_xp        integer;
  v_checkin   boolean := FALSE;
  v_comeback  boolean := FALSE;
  v_prev      timestamptz;
  v_credit    integer := 0;
  v_bonus     integer := 0;
  v_net       integer := 0;
  v_net_bonus integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_log FROM public.workout_logs WHERE id = p_log_id;
  IF NOT FOUND OR v_log.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'invalid_workout_log' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_log.implausible, FALSE) OR v_log.created_at < now() - interval '24 hours' THEN
    RETURN jsonb_build_object('xp_awarded', 0, 'comeback_xp', 0, 'check_in_bonus', FALSE, 'eligible', FALSE);
  END IF;

  INSERT INTO public.xp_session_credits (kind, log_id, user_id)
  VALUES ('workout', p_log_id, v_uid)
  ON CONFLICT (kind, log_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('xp_awarded', 0, 'comeback_xp', 0, 'check_in_bonus', FALSE, 'already_credited', TRUE);
  END IF;

  v_xp := public.workout_xp_for(v_log.exercises, v_log.duration_min);
  IF v_xp > 0 AND EXISTS (
       SELECT 1 FROM public.gym_checkins
        WHERE user_id = v_uid AND checkin_date = (now() AT TIME ZONE 'UTC')::date) THEN
    v_xp := round(v_xp * 1.2)::integer;
    v_checkin := TRUE;
  END IF;
  -- XP a deleted log already paid is spent before any new XP is granted.
  v_net := public._net_deleted_session_xp('workout', v_uid, p_log_id, v_xp);
  v_credit := public.grant_action_xp_internal('workout_completed', v_xp - v_net);

  -- Comeback: the client flags the exercises; the server checks the gap.
  IF jsonb_typeof(v_log.exercises) = 'array' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_log.exercises) e
        WHERE (e->>'comeback') = 'true') THEN
    SELECT max(created_at) INTO v_prev FROM public.workout_logs
     WHERE user_id = v_uid AND id <> p_log_id
       AND NOT COALESCE(implausible, FALSE)
       AND created_at < v_log.created_at;
    v_comeback := v_prev IS NOT NULL AND v_prev < v_log.created_at - interval '72 hours';
    IF v_comeback THEN
      v_net_bonus := public._net_deleted_session_xp('workout', v_uid, p_log_id, 200);
      v_bonus := public.grant_action_xp_internal('comeback_bonus', 200 - v_net_bonus);
    END IF;
  END IF;

  UPDATE public.xp_session_credits
     SET xp = v_credit + v_net, bonus_xp = v_bonus + v_net_bonus
   WHERE kind = 'workout' AND log_id = p_log_id;
  RETURN jsonb_build_object('xp_awarded', v_credit, 'comeback_xp', v_bonus, 'check_in_bonus', v_checkin);
END;
$function$;

CREATE OR REPLACE FUNCTION public.grant_cardio_xp(p_log_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_log    public.cardio_logs%ROWTYPE;
  v_secs   numeric;
  v_xp     integer;
  v_credit integer := 0;
  v_net    integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_log FROM public.cardio_logs WHERE id = p_log_id;
  IF NOT FOUND OR v_log.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'invalid_cardio_log' USING ERRCODE = '42501';
  END IF;
  v_secs := COALESCE(v_log.duration_seconds, v_log.duration_min * 60, 0);
  -- The rival scorer's bounds: 12 hours, 250 km, and a speed the activity
  -- can reach. A session with no distance is judged on duration alone.
  IF v_log.created_at < now() - interval '24 hours'
     OR v_secs > 43200
     OR (COALESCE(v_log.distance_meters, 0) > 0
         AND NOT public.cardio_log_is_plausible(COALESCE(v_log.type, v_log.activity_type),
                                                v_log.distance_meters, v_secs::integer)) THEN
    RETURN jsonb_build_object('xp_awarded', 0, 'eligible', FALSE);
  END IF;

  INSERT INTO public.xp_session_credits (kind, log_id, user_id)
  VALUES ('cardio', p_log_id, v_uid)
  ON CONFLICT (kind, log_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('xp_awarded', 0, 'already_credited', TRUE);
  END IF;

  v_xp := public.cardio_xp_for(v_secs, v_log.distance_meters, v_log.calories);
  -- XP a deleted log already paid is spent before any new XP is granted.
  v_net := public._net_deleted_session_xp('cardio', v_uid, p_log_id, v_xp);
  v_credit := public.grant_action_xp_internal('cardio_completed', v_xp - v_net);
  UPDATE public.xp_session_credits SET xp = v_credit + v_net
   WHERE kind = 'cardio' AND log_id = p_log_id;
  RETURN jsonb_build_object('xp_awarded', v_credit);
END;
$function$;

-- Probe, rolled back. P0003 is the success signal.
DO $probe$
DECLARE
  u     uuid := gen_random_uuid();
  mail  text := 'guest_' || u || '@flexyn.guest';
  small jsonb := '[{"name":"Bench Press","sets":[{"weight":135,"reps":8,"completed":true},{"weight":135,"reps":8,"completed":true}]}]'::jsonb;
  big   jsonb := '[{"name":"Bench Press","sets":[{"weight":135,"reps":8,"completed":true},{"weight":135,"reps":8,"completed":true},{"weight":135,"reps":8,"completed":true},{"weight":135,"reps":8,"completed":true}]}]'::jsonb;
  x_small integer := public.workout_xp_for(small, 30);
  x_big   integer := public.workout_xp_for(big, 30);
  c_xp    integer := public.cardio_xp_for(1800, 5000, 300);
  id1 uuid; id2 uuid; id3 uuid; id4 uuid; id5 uuid;
  paid integer;
BEGIN
  IF x_small <= 0 OR x_big <= x_small OR c_xp <= 0 THEN
    RAISE EXCEPTION 'probe: fixture XP is wrong (% % %)', x_small, x_big, c_xp;
  END IF;

  INSERT INTO auth.users (id, aud, role, is_anonymous) VALUES (u, 'authenticated', 'authenticated', TRUE);
  INSERT INTO public.user_profiles (id, email) VALUES (u, mail) ON CONFLICT (id) DO NOTHING;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', u, 'role', 'authenticated', 'is_anonymous', TRUE)::text, TRUE);
  SET LOCAL ROLE authenticated;

  -- First save pays in full.
  INSERT INTO public.workout_logs (user_id, created_by, "date", exercises, duration_min)
  VALUES (u, mail, current_date, small, 30) RETURNING id INTO id1;
  paid := (public.grant_workout_xp(id1)->>'xp_awarded')::int;
  IF paid <> x_small THEN RAISE EXCEPTION 'probe: first save paid % not %', paid, x_small; END IF;

  -- Delete and save the same session again: nothing.
  DELETE FROM public.workout_logs WHERE id = id1;
  INSERT INTO public.workout_logs (user_id, created_by, "date", exercises, duration_min)
  VALUES (u, mail, current_date, small, 30) RETURNING id INTO id2;
  paid := (public.grant_workout_xp(id2)->>'xp_awarded')::int;
  IF paid <> 0 THEN RAISE EXCEPTION 'probe: identical re-log paid %', paid; END IF;

  -- And a third time, after deleting the re-log: still nothing.
  DELETE FROM public.workout_logs WHERE id = id2;
  INSERT INTO public.workout_logs (user_id, created_by, "date", exercises, duration_min)
  VALUES (u, mail, current_date, small, 30) RETURNING id INTO id3;
  paid := (public.grant_workout_xp(id3)->>'xp_awarded')::int;
  IF paid <> 0 THEN RAISE EXCEPTION 'probe: second re-log paid %', paid; END IF;

  -- A corrected, bigger re-log pays only the difference.
  DELETE FROM public.workout_logs WHERE id = id3;
  INSERT INTO public.workout_logs (user_id, created_by, "date", exercises, duration_min)
  VALUES (u, mail, current_date, big, 30) RETURNING id INTO id4;
  paid := (public.grant_workout_xp(id4)->>'xp_awarded')::int;
  IF paid <> x_big - x_small THEN
    RAISE EXCEPTION 'probe: corrected re-log paid % not %', paid, x_big - x_small;
  END IF;

  -- A second, separate session (nothing deleted) pays in full.
  INSERT INTO public.workout_logs (user_id, created_by, "date", exercises, duration_min)
  VALUES (u, mail, current_date, small, 30) RETURNING id INTO id5;
  paid := (public.grant_workout_xp(id5)->>'xp_awarded')::int;
  IF paid <> x_small THEN RAISE EXCEPTION 'probe: a new session paid % not %', paid, x_small; END IF;

  -- Cardio: same shape.
  INSERT INTO public.cardio_logs (user_id, created_by, "date", type, distance_meters, duration_seconds, calories)
  VALUES (u, mail, current_date, 'run', 5000, 1800, 300) RETURNING id INTO id1;
  paid := (public.grant_cardio_xp(id1)->>'xp_awarded')::int;
  IF paid <> c_xp THEN RAISE EXCEPTION 'probe: first cardio paid % not %', paid, c_xp; END IF;
  DELETE FROM public.cardio_logs WHERE id = id1;
  INSERT INTO public.cardio_logs (user_id, created_by, "date", type, distance_meters, duration_seconds, calories)
  VALUES (u, mail, current_date, 'run', 5000, 1800, 300) RETURNING id INTO id2;
  paid := (public.grant_cardio_xp(id2)->>'xp_awarded')::int;
  IF paid <> 0 THEN RAISE EXCEPTION 'probe: identical cardio re-log paid %', paid; END IF;

  -- The netting helper is not callable by a client.
  BEGIN
    PERFORM public._net_deleted_session_xp('workout', u, id5, 100);
    RAISE EXCEPTION 'probe: client could call _net_deleted_session_xp';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'probe ok';
EXCEPTION WHEN SQLSTATE 'P0003' THEN
  RAISE NOTICE 'deleted session netting probe passed';
END
$probe$;
