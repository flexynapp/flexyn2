-- The workout streak only advances on a day you actually logged a session.
--
-- advance_workout_streak (173) took the client's date and advanced the
-- streak with no workout behind it, so calling it once a day from the
-- console built a streak, and the streak pays coins and elite capsules at
-- its milestones (2026-09-27 codebase audit, item 9).
--
-- It now needs a workout_logs or cardio_logs row of the caller's:
--   * dated p_today, the normal case, or
--   * dated the day before, only while that day has not already counted.
--     A live cardio session is dated by its START, so a run that crosses
--     midnight is dated yesterday while the client asks for today. Once
--     yesterday is credited, a log dated yesterday cannot credit today too.
-- A workout the plausibility trigger (360) flagged does not count, because
-- the streak is credited, not personal history; see CLAUDE.md.
--
-- With no qualifying log the call answers is_new_day FALSE and writes
-- nothing, the same shape as "already recorded today", so the client
-- shows no toast and pays nothing.
--
-- Behaviour change worth knowing: a manual cardio entry backdated to an
-- earlier day no longer advances today's streak. That is the correct
-- reading of "a day you trained".

CREATE OR REPLACE FUNCTION public.advance_workout_streak(p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          UUID := auth.uid();
  v_server_today DATE := (now() AT TIME ZONE 'UTC')::date;
  v_streak       INT;
  v_last         DATE;
  v_longest      INT;
  v_diff         INT;
  v_new_streak   INT;
  v_new_longest  INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_today IS NULL OR p_today < v_server_today - 2 OR p_today > v_server_today + 2 THEN
    RAISE EXCEPTION 'p_today out of range' USING ERRCODE = '22023';
  END IF;

  SELECT workout_streak, last_workout_date, longest_workout_streak
    INTO v_streak, v_last, v_longest
    FROM public.user_profiles
   WHERE id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = '22023';
  END IF;

  v_streak  := COALESCE(v_streak, 0);
  v_longest := COALESCE(v_longest, 0);

  IF v_last IS NOT NULL AND p_today <= v_last THEN
    RETURN jsonb_build_object(
      'is_new_day', FALSE,
      'streak', v_streak,
      'longest', v_longest
    );
  END IF;

  IF NOT (
       EXISTS (SELECT 1 FROM public.workout_logs
                WHERE user_id = v_uid
                  AND NOT COALESCE(implausible, FALSE)
                  AND (date = p_today
                       OR (date = p_today - 1 AND (v_last IS NULL OR date > v_last))))
    OR EXISTS (SELECT 1 FROM public.cardio_logs
                WHERE user_id = v_uid
                  AND (date = p_today
                       OR (date = p_today - 1 AND (v_last IS NULL OR date > v_last))))
  ) THEN
    RETURN jsonb_build_object(
      'is_new_day', FALSE,
      'streak', v_streak,
      'longest', v_longest
    );
  END IF;

  IF v_last IS NULL THEN
    v_new_streak := 1;
  ELSE
    v_diff := p_today - v_last;
    IF v_diff = 1 THEN
      v_new_streak := v_streak + 1;
    ELSE
      v_new_streak := 1;
    END IF;
  END IF;

  v_new_longest := GREATEST(v_longest, v_new_streak);

  UPDATE public.user_profiles
     SET workout_streak         = v_new_streak,
         last_workout_date      = p_today,
         longest_workout_streak = v_new_longest,
         updated_at             = now()
   WHERE id = v_uid;

  RETURN jsonb_build_object(
    'is_new_day', TRUE,
    'streak', v_new_streak,
    'longest', v_new_longest
  );
END;
$function$;

-- Prove it as a real signed-in user: no log, no streak; a log today
-- advances it; yesterday's log cannot pay twice.
DO $$
DECLARE
  a uuid := gen_random_uuid();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  r jsonb;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, aud, role)
    VALUES (a, 'probe_ws_' || a || '@probe.invalid', 'authenticated', 'authenticated');
    INSERT INTO public.user_profiles (id, email)
    VALUES (a, 'probe_ws_' || a || '@probe.invalid')
    ON CONFLICT (id) DO NOTHING;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', a, 'role', 'authenticated')::text, true);

    SET LOCAL ROLE authenticated;
    r := public.advance_workout_streak(v_today - 1);
    RESET ROLE;
    IF (r->>'is_new_day')::boolean THEN
      RAISE EXCEPTION 'streak advanced with no workout logged: %', r;
    END IF;

    INSERT INTO public.workout_logs (user_id, created_by, date)
    VALUES (a, 'probe_ws_' || a || '@probe.invalid', v_today - 1);

    SET LOCAL ROLE authenticated;
    r := public.advance_workout_streak(v_today - 1);
    RESET ROLE;
    IF NOT (r->>'is_new_day')::boolean OR (r->>'streak')::int <> 1 THEN
      RAISE EXCEPTION 'a logged workout did not advance the streak: %', r;
    END IF;

    -- Yesterday is credited, so its log cannot also credit today.
    SET LOCAL ROLE authenticated;
    r := public.advance_workout_streak(v_today);
    RESET ROLE;
    IF (r->>'is_new_day')::boolean THEN
      RAISE EXCEPTION 'one workout paid two streak days: %', r;
    END IF;

    -- A cardio session today counts.
    INSERT INTO public.cardio_logs (user_id, created_by, date)
    VALUES (a, 'probe_ws_' || a || '@probe.invalid', v_today);
    SET LOCAL ROLE authenticated;
    r := public.advance_workout_streak(v_today);
    RESET ROLE;
    IF NOT (r->>'is_new_day')::boolean OR (r->>'streak')::int <> 2 THEN
      RAISE EXCEPTION 'a cardio session did not advance the streak: %', r;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'probe_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'probe_rollback' THEN
      RAISE;
    END IF;
  END;
END;
$$;
