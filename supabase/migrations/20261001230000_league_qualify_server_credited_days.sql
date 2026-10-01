-- The weekly bracket's "2 training days to qualify" counts only days the
-- server itself paid workout or cardio XP for.
--
-- Same hole as the league quests (20261001220000, PR #310), in the bracket's
-- own rule. league_active_days counted distinct `date` values on any
-- workout_logs or cardio_logs row, and both columns are client-written. Two
-- empty workouts saved with two back-dated dates qualified a lifter for the
-- week's ranking, promotions and Lead Lifter trophy without lifting anything.
--
-- It now counts distinct days with 'workout_completed' or 'cardio_completed'
-- in action_xp_ledger, exactly what the train_2 / train_4 quests count, so
-- the bracket and the quests agree on what a training day is.
-- grant_workout_xp / grant_cardio_xp write those rows only for a session
-- saved in the last 24h, not flagged implausible, and worth XP (an empty
-- session is worth none). The day is the day it was saved, so a week cannot
-- be back-filled in one sitting.
--
-- Callers are unchanged: sync_my_weekly_league and
-- resolve_league_bracket_internal still call this with the same signature.
-- No user data changes.

CREATE OR REPLACE FUNCTION public.league_active_days(p_user_id uuid, p_from date, p_to date)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_days INTEGER;
BEGIN
  SELECT count(DISTINCT day) INTO v_days FROM public.action_xp_ledger
   WHERE user_id = p_user_id
     AND action_type IN ('workout_completed', 'cardio_completed')
     AND day BETWEEN p_from AND p_to
     AND amount > 0;
  RETURN COALESCE(v_days, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.league_active_days(uuid, date, date) FROM PUBLIC, anon, authenticated;

------------------------------------------------------------------------------
-- Probe: forge training days as a real authenticated user, then roll back
------------------------------------------------------------------------------
DO $probe$
DECLARE
  u     uuid := gen_random_uuid();
  mail  text;
  wk    date := (date_trunc('week', CURRENT_DATE))::date;
  other date;
  n     integer;
BEGIN
  other := CASE WHEN CURRENT_DATE > wk THEN CURRENT_DATE - 1 ELSE CURRENT_DATE + 1 END;
  BEGIN
    mail := 'league-qualify-probe-' || u || '@example.invalid';
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    VALUES (u, mail, 'authenticated', 'authenticated', FALSE);
    INSERT INTO public.user_profiles (id, email) VALUES (u, mail) ON CONFLICT (id) DO NOTHING;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', u, 'role', 'authenticated', 'email', mail)::text, true);
    SET LOCAL ROLE authenticated;

    -- Forgery: empty workouts and uncredited cardio on two dates this week.
    INSERT INTO public.workout_logs (created_by, user_id, date, exercises)
    VALUES (mail, u, CURRENT_DATE, '[]'::jsonb), (mail, u, other, '[]'::jsonb);
    INSERT INTO public.cardio_logs (created_by, user_id, date, duration_seconds)
    VALUES (mail, u, CURRENT_DATE, 3600), (mail, u, other, 3600);

    RESET ROLE;
    n := public.league_active_days(u, wk, wk + 6);
    IF n <> 0 THEN RAISE EXCEPTION 'probe: forged rows counted as % training days', n; END IF;

    -- What the server writes still counts: workout XP one day, cardio XP another.
    INSERT INTO public.action_xp_ledger (user_id, day, action_type, amount)
    VALUES (u, CURRENT_DATE, 'workout_completed', 40), (u, other, 'cardio_completed', 30),
           (u, CURRENT_DATE, 'cardio_completed', 25);
    n := public.league_active_days(u, wk, wk + 6);
    IF n <> 2 THEN RAISE EXCEPTION 'probe: credited training gave % days, expected 2', n; END IF;

    -- Other XP (a meal, water) is not a training day, and nor is a zero row.
    INSERT INTO public.action_xp_ledger (user_id, day, action_type, amount)
    VALUES (u, wk + 6, 'water_goal_met', 20), (u, wk + 5, 'workout_completed', 0);
    n := public.league_active_days(u, wk, wk + 6);
    IF n <> 2 THEN RAISE EXCEPTION 'probe: non-training XP changed the count to %', n; END IF;

    -- The client cannot call it directly.
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.league_active_days(u, wk, wk + 6);
      RAISE EXCEPTION 'probe: authenticated could call league_active_days';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    RAISE EXCEPTION 'probe passed' USING ERRCODE = 'P0003';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN
    NULL;
  END;
END;
$probe$;
