-- Reward economy audit, part three (2026-09-28). Found by the Duels
-- thread's round-four audit and handed to this thread.
--
-- The plausibility flag judges a day by VOLUME (weight x reps). A set of
-- 100000 lb x 0 reps adds zero volume, so the row is never flagged, and a
-- 100000 x 1 set can hide inside a day that is otherwise empty. Several
-- readers use the WEIGHT on its own: bounty single_lift_weight,
-- _best_1rm_from_exercises (reps <= 1 means e1RM = weight), and the Past
-- You PR count. So one fake set was a plausible PR and a winning bounty
-- lift.
--
-- Two changes:
--   1. Any set heavier than 2,500 lb flags the whole log implausible. The
--      heaviest real lifts are a ~1,100 lb deadlift and leg press sleds in
--      the low thousands, so no honest set comes near it. Flagged logs are
--      already dropped by every competitive or credited reader (360-362,
--      375), and the log itself still saves.
--   2. _best_1rm_from_exercises ignores sets with no reps or no weight. A
--      set of zero reps is not a lift.
--
-- Negative sets are handled by the Duels thread's 20260928060000, which
-- makes _duel_calc_volume count positive sets only.

CREATE OR REPLACE FUNCTION public.workout_logs_flag_implausible()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  c_max_set_weight CONSTANT numeric := 2500;
  v_user uuid; v_email text; v_ceiling numeric;
  v_this numeric; v_same_day numeric; v_total numeric;
BEGIN
  v_user := NEW.user_id;
  IF v_user IS NULL AND NEW.created_by IS NOT NULL THEN
    SELECT id INTO v_user FROM public.user_profiles
     WHERE lower(email) = lower(NEW.created_by) LIMIT 1;
  END IF;

  IF v_user IS NULL THEN
    NEW.implausible := FALSE; NEW.implausible_ratio := NULL;
    RETURN NEW;
  END IF;

  -- One impossible set condemns the log, whatever its volume.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.exercises) = 'array'
                                     THEN NEW.exercises ELSE '[]'::jsonb END) ex,
           jsonb_array_elements(CASE WHEN jsonb_typeof(ex->'sets') = 'array'
                                     THEN ex->'sets' ELSE '[]'::jsonb END) s
     WHERE (s->>'weight') ~ '^-?[0-9]+(\.[0-9]+)?$'
       AND abs((s->>'weight')::numeric) > c_max_set_weight
  ) THEN
    NEW.implausible := TRUE;
    NEW.implausible_ratio := NULL;
    RETURN NEW;
  END IF;

  v_ceiling := public.user_daily_volume_ceiling(v_user);
  v_this    := COALESCE(public._duel_calc_volume(NEW.exercises), 0);

  SELECT lower(email) INTO v_email FROM public.user_profiles WHERE id = v_user;

  SELECT COALESCE(SUM(public._duel_calc_volume(exercises)), 0)
    INTO v_same_day
    FROM public.workout_logs
   WHERE (user_id = v_user OR (v_email IS NOT NULL AND lower(created_by) = v_email))
     AND "date" = NEW."date"
     AND NOT (id = NEW.id);

  v_total := v_this + COALESCE(v_same_day, 0);

  IF v_ceiling = LEAST(v_ceiling, 0) THEN
    NEW.implausible := FALSE; NEW.implausible_ratio := NULL;
  ELSE
    NEW.implausible_ratio := ROUND(v_total / v_ceiling, 3);
    NEW.implausible       := NOT (v_total = LEAST(v_total, v_ceiling));
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public._best_1rm_from_exercises(p_exercises jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_ex        jsonb;
  v_set       jsonb;
  v_w         numeric;
  v_r         numeric;
  v_e1rm      numeric;
  v_best_e1rm numeric := NULL;
  v_best      jsonb   := NULL;
  v_name      text;
BEGIN
  IF p_exercises IS NULL OR jsonb_typeof(p_exercises) <> 'array' THEN
    RETURN NULL;
  END IF;

  FOR v_ex IN SELECT * FROM jsonb_array_elements(p_exercises) LOOP
    v_name := v_ex->>'name';
    IF jsonb_typeof(v_ex->'sets') = 'array' THEN
      FOR v_set IN SELECT * FROM jsonb_array_elements(v_ex->'sets') LOOP
        v_w := COALESCE((v_set->>'weight')::numeric, 0);
        v_r := COALESCE((v_set->>'reps')::numeric, 0);
        -- A set with no reps or no weight is not a lift.
        CONTINUE WHEN v_w <= 0 OR v_r < 1;
        IF v_r > 1 THEN
          v_e1rm := v_w * (1 + v_r / 30);
        ELSE
          v_e1rm := v_w;
        END IF;
        IF v_best_e1rm IS NULL OR v_e1rm > v_best_e1rm THEN
          v_best_e1rm := v_e1rm;
          v_best := jsonb_build_object(
            'exercise', v_name,
            'weight',   v_w,
            'reps',     v_r,
            'e1rm',     v_e1rm
          );
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_best;
END;
$function$;

-- Probe, rolled back. P0003 is the success signal.
DO $probe$
DECLARE
  u    uuid := gen_random_uuid();
  mail text := 'guest_' || u || '@flexyn.guest';
  flag boolean;
  best jsonb;
BEGIN
  INSERT INTO auth.users (id, aud, role, is_anonymous) VALUES (u, 'authenticated', 'authenticated', TRUE);
  INSERT INTO public.user_profiles (id, email) VALUES (u, mail) ON CONFLICT (id) DO NOTHING;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', u, 'role', 'authenticated', 'is_anonymous', TRUE)::text, TRUE);
  SET LOCAL ROLE authenticated;

  -- 100000 x 0 adds no volume but is flagged.
  INSERT INTO public.workout_logs (user_id, created_by, "date", exercises)
  VALUES (u, mail, current_date, '[{"name":"Bench Press","sets":[{"weight":100000,"reps":0}]}]'::jsonb)
  RETURNING implausible INTO flag;
  IF NOT flag THEN RAISE EXCEPTION 'probe: 100000 x 0 set was not flagged'; END IF;

  -- An honest heavy session still saves clean.
  INSERT INTO public.workout_logs (user_id, created_by, "date", exercises)
  VALUES (u, mail, current_date - 1, '[{"name":"Deadlift","sets":[{"weight":600,"reps":3}]}]'::jsonb)
  RETURNING implausible INTO flag;
  IF flag THEN RAISE EXCEPTION 'probe: a 600 lb deadlift was flagged'; END IF;
  RESET ROLE;

  best := public._best_1rm_from_exercises(
    '[{"name":"Bench Press","sets":[{"weight":900,"reps":0},{"weight":200,"reps":5}]}]'::jsonb);
  IF (best->>'weight')::numeric <> 200 THEN
    RAISE EXCEPTION 'probe: best 1RM took a zero-rep set: %', best;
  END IF;

  RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'probe ok';
EXCEPTION WHEN SQLSTATE 'P0003' THEN
  RAISE NOTICE 'single set weight probe passed';
END
$probe$;
