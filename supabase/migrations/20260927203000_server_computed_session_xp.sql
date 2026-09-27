-- The server decides how much XP a workout or cardio session is worth.
--
-- Until now the app computed a session's XP itself and sent the number to
-- grant_action_xp(action, amount). The only thing standing between a crafted
-- request and a league standing was the per-action daily cap: 4,000 a day as
-- 'workout_completed', 400 as 'daily_quest' and so on, about 8,000 XP a day
-- with no workout, quest or anything else behind it. Every one of those
-- amounts is a number the client typed.
--
-- After this migration:
--
--   grant_workout_xp(log_id) and grant_cardio_xp(log_id) score a SAVED log
--   row on the server, once per row (xp_session_credits is the receipt), and
--   refuse a log that is not the caller's, is older than a day, or is flagged
--   implausible. The workout formula is src/lib/xpSystem.js
--   calculateWorkoutXp ported line for line, plus the 1.2x gym check-in bonus
--   and the 200 XP comeback bonus, both decided here now: the check-in from
--   gym_checkins, the comeback from the caller's own previous session being
--   more than 72 hours older than this one (useComebackProtocol's threshold).
--
--   grant_action_xp keeps working for the small fixed rewards, but the amount
--   is the server's own constant and the client's number is ignored: water 3,
--   meal 5, recipe 25, regimen 60. Goal completion is clamped to 100, the
--   ceiling calculateGoalXp already applies; the Goals thread is moving it to
--   complete_goal. Every other action (sessions, comeback, quests, crew fuel,
--   perfect day) returns 0 when called from the client.
--
--   grant_action_xp_internal is the same ledger logic with no allow-list. It
--   is not callable by clients. claim_quest_atomic, claim_crew_xp_fuel and
--   claim_perfect_day_bonus, which pay XP from their own server-side values,
--   are switched to it below by rewriting their INSTALLED bodies, so nothing
--   in them is retyped.
--
-- Cardio has never paid XP. All three cardio screens sent 0 and computed the
-- real amount only to hand it to the league sync, which reads the ledger and
-- so saw nothing: production's action_xp_ledger holds no cardio row at all.
-- grant_cardio_xp is the first thing that pays it, with the same formula as
-- calculateCardioXp and the existing 2,400 a day cap.

-- ── Receipt: one XP payment per saved session ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.xp_session_credits (
  kind        text        NOT NULL CHECK (kind IN ('workout', 'cardio')),
  log_id      uuid        NOT NULL,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  xp          integer     NOT NULL DEFAULT 0,
  bonus_xp    integer     NOT NULL DEFAULT 0,
  credited_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, log_id)
);
ALTER TABLE public.xp_session_credits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.xp_session_credits FROM anon, authenticated;

-- ── Internal ledger grant (no allow-list, not client-callable) ─────────────

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
    WHEN 'goal_completed'    THEN 500
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

REVOKE EXECUTE ON FUNCTION public.grant_action_xp_internal(text, integer) FROM PUBLIC, anon, authenticated;

-- ── Client entry point: fixed rewards only, server amounts ─────────────────

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
    WHEN 'goal_completed'  THEN LEAST(p_xp, 100)
    ELSE NULL
  END;
  IF v_amount IS NULL THEN RETURN 0; END IF;

  RETURN public.grant_action_xp_internal(p_action_type, v_amount);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.grant_action_xp(text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.grant_action_xp(text, integer) TO authenticated;

-- ── Server-side callers move to the internal grant ─────────────────────────
-- Rewritten from pg_get_functiondef so the bodies are exactly what is
-- installed, with one call renamed. Each must contain the call exactly once.

DO $$
DECLARE
  fn   text;
  def  text;
  hits integer;
BEGIN
  FOREACH fn IN ARRAY ARRAY['claim_quest_atomic', 'claim_crew_xp_fuel', 'claim_perfect_day_bonus'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO def
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = fn;
    IF def IS NULL THEN RAISE EXCEPTION '% not found', fn; END IF;
    hits := (length(def) - length(replace(def, 'public.grant_action_xp(', ''))) / length('public.grant_action_xp(');
    IF hits <> 1 THEN RAISE EXCEPTION '% calls grant_action_xp % times, expected 1', fn, hits; END IF;
    EXECUTE replace(def, 'public.grant_action_xp(', 'public.grant_action_xp_internal(');
  END LOOP;
END;
$$;

-- ── Scoring (ports of src/lib/xpSystem.js) ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.xp_safe_num(p_text text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  -- JavaScript's Number(x) || 0 for the shapes set fields actually hold.
  SELECT CASE WHEN p_text ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' THEN trim(p_text)::numeric ELSE 0 END;
$function$;

CREATE OR REPLACE FUNCTION public.workout_xp_for(p_exercises jsonb, p_duration_min numeric)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_ex     jsonb;
  v_set    jsonb;
  v_w      numeric;
  v_r      numeric;
  v_rep_xp numeric := 0;
  v_volume numeric := 0;
  v_sets   integer := 0;
  v_mult   numeric;
  v_dur    numeric := LEAST(GREATEST(COALESCE(p_duration_min, 0), 0), 600);
BEGIN
  IF p_exercises IS NULL OR jsonb_typeof(p_exercises) <> 'array'
     OR jsonb_array_length(p_exercises) = 0 THEN
    RETURN 0;
  END IF;
  FOR v_ex IN SELECT * FROM jsonb_array_elements(p_exercises) LOOP
    IF jsonb_typeof(v_ex->'sets') <> 'array' THEN CONTINUE; END IF;
    FOR v_set IN SELECT * FROM jsonb_array_elements(v_ex->'sets') LOOP
      v_sets := v_sets + 1;
      v_w := public.xp_safe_num(v_set->>'weight');
      v_r := public.xp_safe_num(v_set->>'reps');
      v_volume := v_volume + v_w * v_r;
      IF v_w > 0 AND v_r > 0 THEN
        v_mult := CASE
          WHEN v_w < 25  THEN 0.6
          WHEN v_w < 50  THEN 0.8
          WHEN v_w < 95  THEN 1.0
          WHEN v_w < 135 THEN 1.3
          WHEN v_w < 185 THEN 1.7
          WHEN v_w < 225 THEN 2.1
          WHEN v_w < 275 THEN 2.6
          ELSE 3.2
        END;
        v_rep_xp := v_rep_xp + v_r * v_mult * 0.7;
      ELSIF v_r > 0 THEN
        v_rep_xp := v_rep_xp + LEAST(v_r * 0.5, 20);
      END IF;
    END LOOP;
  END LOOP;
  RETURN LEAST(round(v_sets * 12 + v_rep_xp + floor(GREATEST(v_volume, 0) / 400)
                     + floor(v_dur / 10) * 4)::integer, 1000);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cardio_xp_for(p_duration_seconds numeric, p_distance_meters numeric, p_calories numeric)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_min  numeric;
  v_dist numeric := GREATEST(COALESCE(p_distance_meters, 0), 0);
  v_cal  numeric := GREATEST(COALESCE(p_calories, 0), 0);
  v_raw  numeric;
BEGIN
  IF p_duration_seconds IS NULL OR p_duration_seconds <= 0 THEN RETURN 0; END IF;
  v_min := p_duration_seconds / 60.0;
  -- Calories are typed, so they count only up to 20 kcal a minute.
  v_cal := LEAST(v_cal, v_min * 20);
  v_raw := (v_min * 1.5 + v_dist / 200 + v_cal / 20)
           * CASE WHEN v_dist > 0 AND v_cal > 0 THEN 1.10 ELSE 1.0 END;
  RETURN LEAST(round(v_raw)::integer, 600);
END;
$function$;

-- ── Session grants ─────────────────────────────────────────────────────────

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
  v_credit := public.grant_action_xp_internal('workout_completed', v_xp);

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
      v_bonus := public.grant_action_xp_internal('comeback_bonus', 200);
    END IF;
  END IF;

  UPDATE public.xp_session_credits SET xp = v_credit, bonus_xp = v_bonus
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
  v_credit := public.grant_action_xp_internal('cardio_completed', v_xp);
  UPDATE public.xp_session_credits SET xp = v_credit
   WHERE kind = 'cardio' AND log_id = p_log_id;
  RETURN jsonb_build_object('xp_awarded', v_credit);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.grant_workout_xp(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.grant_cardio_xp(uuid)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.grant_workout_xp(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.grant_cardio_xp(uuid)  TO authenticated;

-- ── Probe: attempt it as a real authenticated user, then roll back ─────────

DO $$
DECLARE
  u     uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  mail  text;
  lg    uuid;
  lg_old uuid;
  lg_other uuid;
  cl    uuid;
  r     jsonb;
  n     integer;
  v_refused boolean;
BEGIN
  BEGIN
    mail := 'xp2-probe-' || u || '@example.invalid';
    INSERT INTO auth.users (id, email, aud, role, is_anonymous) VALUES
      (u, mail, 'authenticated', 'authenticated', FALSE),
      (other, 'xp2-probe-' || other || '@example.invalid', 'authenticated', 'authenticated', FALSE);
    INSERT INTO public.user_profiles (id, email) VALUES
      (u, mail), (other, 'xp2-probe-' || other || '@example.invalid')
    ON CONFLICT (id) DO NOTHING;

    -- The formulas match the client's on known inputs.
    -- 3 sets of 10 at 100 lb: 36 + 27.3 + 7 = 70.3 -> 70.
    n := public.workout_xp_for('[{"name":"Bench","sets":[{"weight":"100","reps":"10"},{"weight":100,"reps":10},{"weight":"100","reps":"10"}]}]', 0);
    IF n <> 70 THEN RAISE EXCEPTION 'probe: workout_xp_for gave %, expected 70', n; END IF;
    IF public.workout_xp_for('[{"sets":[{"weight":"","reps":"x"}]}]', 45) <> 28 THEN
      RAISE EXCEPTION 'probe: blank set fields not scored as zero';
    END IF;
    -- 30 min, 5 km, 300 kcal: (45 + 25 + 15) * 1.1 = 93.5 -> 94.
    n := public.cardio_xp_for(1800, 5000, 300);
    IF n <> 94 THEN RAISE EXCEPTION 'probe: cardio_xp_for gave %, expected 94', n; END IF;

    -- A log from 3 days ago so the new one is a comeback.
    INSERT INTO public.workout_logs (user_id, created_by, date, exercises, created_at)
    VALUES (u, mail, current_date - 3, '[{"name":"Row","sets":[{"weight":50,"reps":5}]}]', now() - interval '4 days')
    RETURNING id INTO lg_old;
    INSERT INTO public.workout_logs (user_id, created_by, date, exercises)
    VALUES (other, 'xp2-probe-' || other || '@example.invalid', current_date,
            '[{"name":"Row","sets":[{"weight":50,"reps":5}]}]')
    RETURNING id INTO lg_other;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    INSERT INTO public.workout_logs (user_id, created_by, date, exercises)
    VALUES (u, mail, current_date,
      '[{"name":"Bench","comeback":true,"sets":[{"weight":100,"reps":10},{"weight":100,"reps":10},{"weight":100,"reps":10}]}]')
    RETURNING id INTO lg;

    -- Honest session pays the server's number plus the comeback, once.
    r := public.grant_workout_xp(lg);
    IF (r->>'xp_awarded')::int <> 70 OR (r->>'comeback_xp')::int <> 200 THEN
      RAISE EXCEPTION 'probe: honest workout paid wrong: %', r;
    END IF;
    r := public.grant_workout_xp(lg);
    IF (r->>'xp_awarded')::int <> 0 OR NOT COALESCE((r->>'already_credited')::boolean, FALSE) THEN
      RAISE EXCEPTION 'probe: workout paid twice: %', r;
    END IF;

    -- Someone else's log is refused; an old log pays nothing.
    v_refused := FALSE;
    BEGIN PERFORM public.grant_workout_xp(lg_other);
    EXCEPTION WHEN insufficient_privilege THEN v_refused := TRUE; END;
    IF NOT v_refused THEN RAISE EXCEPTION 'probe: paid for another user''s log'; END IF;
    r := public.grant_workout_xp(lg_old);
    IF (r->>'xp_awarded')::int <> 0 THEN RAISE EXCEPTION 'probe: day-old log paid: %', r; END IF;

    -- Cardio pays, once.
    INSERT INTO public.cardio_logs (user_id, created_by, type, date, duration_seconds, distance_meters, calories)
    VALUES (u, mail, 'running_outside', current_date, 1800, 5000, 300) RETURNING id INTO cl;
    r := public.grant_cardio_xp(cl);
    IF (r->>'xp_awarded')::int <> 94 THEN RAISE EXCEPTION 'probe: cardio paid wrong: %', r; END IF;
    r := public.grant_cardio_xp(cl);
    IF (r->>'xp_awarded')::int <> 0 THEN RAISE EXCEPTION 'probe: cardio paid twice: %', r; END IF;

    -- The client's number is ignored, and session actions are closed.
    IF public.grant_action_xp('workout_completed', 4000) <> 0 THEN
      RAISE EXCEPTION 'probe: client still names a workout amount';
    END IF;
    IF public.grant_action_xp('daily_quest', 400) <> 0 THEN
      RAISE EXCEPTION 'probe: client can mint quest XP';
    END IF;
    IF public.grant_action_xp('meal_logged', 30) <> 5 THEN
      RAISE EXCEPTION 'probe: meal did not pay the server amount';
    END IF;

    v_refused := FALSE;
    BEGIN PERFORM public.grant_action_xp_internal('workout_completed', 4000);
    EXCEPTION WHEN insufficient_privilege THEN v_refused := TRUE; END;
    IF NOT v_refused THEN RAISE EXCEPTION 'probe: client can call grant_action_xp_internal'; END IF;

    v_refused := FALSE;
    BEGIN PERFORM count(*) FROM public.xp_session_credits;
    EXCEPTION WHEN insufficient_privilege THEN v_refused := TRUE; END;
    IF NOT v_refused THEN RAISE EXCEPTION 'probe: client can read xp_session_credits'; END IF;

    RESET ROLE;
    SELECT total_xp INTO n FROM public.user_profiles WHERE id = u;
    IF n <> 70 + 200 + 94 + 5 THEN RAISE EXCEPTION 'probe: total_xp %, expected 369', n; END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'probe passed';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
END;
$$;
