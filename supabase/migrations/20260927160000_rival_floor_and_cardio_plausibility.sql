-- Rival: two holes the third audit found, both of them paid.
--
-- 1. Past You could be sandbagged. The ghost's baseline is the mean of the
--    last four scored weeks with no floor, so a lifter who logs one set of
--    45 lb a week races a 45 lb ghost and wins 1,000 XP, 100 coins and a
--    capsule for it, every week. Deleting old logs did the same thing. The
--    baseline now floors at half the starter (5,000 lb or 2.5 km), roughly
--    one light real session, so a beginner still gets a reachable ghost and
--    a farmer has to train.
--
-- 2. Cardio was scored on whatever distance the client sent. cardio_logs has
--    no server check at all (the owner policy is FOR ALL with no bounds), so
--    one row of 1,000 km won a human cardio week (5,000 XP) or any Past You
--    cardio week. Rival now counts a row only when it passes the same bounds
--    the client already enforces in src/lib/cardioLimits.js: at most 250 km,
--    at most 12 hours, and under the activity's top speed when a duration is
--    given. Counted distance is also capped at 250 km per day, so a pile of
--    rows cannot add up to what one row may not. Like the gym side, this
--    FILTERS rather than refuses: the log stays in the user's history, it
--    just does not score a contest.
--
--    Personal history and streak readers are deliberately left alone, the
--    same line migration 361 drew for workout_logs.

-- ── Cardio plausibility ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cardio_log_is_plausible(p_type text, p_distance numeric, p_duration integer)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT COALESCE(p_distance, 0) > 0
     AND p_distance <= 250000
     AND COALESCE(p_duration, 0) <= 43200
     AND (COALESCE(p_duration, 0) <= 0
          OR (p_distance / 1000.0) / (p_duration / 3600.0) <=
             CASE
               WHEN p_type LIKE 'walking%'            THEN 14
               WHEN p_type LIKE 'running%'            THEN 28
               WHEN p_type = 'biking_outside'         THEN 75
               WHEN p_type LIKE 'biking%'             THEN 60
               WHEN p_type = 'swimming_pool'          THEN 9
               WHEN p_type LIKE 'swimming%'           THEN 8
               ELSE 75
             END);
$$;

-- Plausible metres in a window, capped at 250 km a day. p_to NULL means open.
CREATE OR REPLACE FUNCTION public.gym_rival_cardio_meters(p_uid uuid, p_from timestamptz, p_to timestamptz)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT COALESCE(SUM(day_m), 0) FROM (
    SELECT LEAST(250000, SUM(distance_meters)) AS day_m
      FROM public.cardio_logs
     WHERE user_id = p_uid
       AND created_at >= p_from
       AND (p_to IS NULL OR created_at < p_to)
       AND public.cardio_log_is_plausible(COALESCE(type, activity_type), distance_meters, duration_seconds)
     GROUP BY created_at::date
  ) d;
$$;

REVOKE ALL ON FUNCTION public.gym_rival_cardio_meters(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gym_rival_cardio_meters(uuid, timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.gym_rival_score(p_uid uuid, p_type text, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v NUMERIC := 0;
BEGIN
  IF p_type = 'cardio' THEN
    v := public.gym_rival_cardio_meters(p_uid, p_from, p_to);
  ELSE
    v := public.gym_rival_volume_lbs(p_uid, p_from, p_to);
  END IF;
  RETURN COALESCE(v, 0);
END;
$function$;

-- Kept on its `date` window as before; only the row filter and day cap change.
CREATE OR REPLACE FUNCTION public.gym_rival_net_rating(p_uid uuid, p_since timestamp with time zone, p_type text DEFAULT 'gym'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_volume NUMERIC := 0; v_distance NUMERIC := 0;
BEGIN
  IF p_type = 'cardio' THEN
    SELECT COALESCE(SUM(day_m), 0) INTO v_distance FROM (
      SELECT LEAST(250000, SUM(distance_meters)) AS day_m
        FROM public.cardio_logs
       WHERE user_id = p_uid AND date >= p_since::date
         AND public.cardio_log_is_plausible(COALESCE(type, activity_type), distance_meters, duration_seconds)
       GROUP BY date
    ) d;
    RETURN round((v_distance / 1000) * 20);
  ELSE
    v_volume := public.gym_rival_volume_lbs(p_uid, p_since, NULL);
    RETURN round(v_volume / 100);
  END IF;
END;
$function$;

-- A cardio "PR" is a longer plausible session than any plausible one before.
CREATE OR REPLACE FUNCTION public.past_you_pr_count(p_uid uuid, p_type text, p_from timestamptz, p_to timestamptz)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE v INTEGER := 0; v_new NUMERIC; v_old NUMERIC;
BEGIN
  IF p_type = 'cardio' THEN
    SELECT MAX(distance_meters) INTO v_new FROM public.cardio_logs
     WHERE user_id = p_uid AND created_at >= p_from AND created_at < p_to
       AND public.cardio_log_is_plausible(COALESCE(type, activity_type), distance_meters, duration_seconds);
    SELECT MAX(distance_meters) INTO v_old FROM public.cardio_logs
     WHERE user_id = p_uid AND created_at < p_from
       AND public.cardio_log_is_plausible(COALESCE(type, activity_type), distance_meters, duration_seconds);
    RETURN CASE WHEN COALESCE(v_old, 0) > 0 AND COALESCE(v_new, 0) > v_old THEN 1 ELSE 0 END;
  END IF;

  WITH sets AS (
    SELECT lower(trim(ex->>'name')) AS name,
           wl.created_at >= p_from AS in_window,
           NULLIF(s->>'weight', '')::numeric * (1 + (s->>'reps')::numeric / 30) AS e1rm
      FROM public.workout_logs wl,
           jsonb_array_elements(COALESCE(wl.exercises, '[]'::jsonb)) AS ex,
           jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
     WHERE wl.user_id = p_uid
       AND wl.created_at < p_to
       AND NOT COALESCE(wl.implausible, FALSE)
       AND COALESCE(trim(ex->>'name'), '') <> ''
       AND (s->>'reps') ~ '^[0-9]+$' AND (s->>'reps')::int > 0
       AND (s->>'weight') ~ '^[0-9]+(\.[0-9]+)?$' AND (s->>'weight')::numeric > 0
  ), per AS (
    SELECT name,
           MAX(e1rm) FILTER (WHERE in_window)     AS best_new,
           MAX(e1rm) FILTER (WHERE NOT in_window) AS best_old
      FROM sets GROUP BY name
  )
  SELECT count(*) INTO v FROM per WHERE best_old > 0 AND best_new > best_old;
  RETURN COALESCE(v, 0);
END;
$function$;

-- ── Past You baseline floor ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.past_you_plan(p_uid uuid, p_type text, p_at timestamptz DEFAULT now())
RETURNS TABLE (level integer, baseline numeric, baseline_weeks integer, target numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE v_level INTEGER; v_sum NUMERIC := 0; v_n INTEGER := 0; v_w NUMERIC; k INTEGER;
        v_starter NUMERIC := CASE WHEN p_type = 'cardio' THEN 5000 ELSE 10000 END;
BEGIN
  SELECT m.next_level INTO v_level FROM public.past_you_matches m
   WHERE m.user_id = p_uid AND m.rival_type = p_type AND m.status = 'completed'
   ORDER BY m.settled_at DESC NULLS LAST LIMIT 1;
  v_level := LEAST(20, GREATEST(1, COALESCE(v_level, 1)));

  FOR k IN 1..4 LOOP
    v_w := public.gym_rival_score(p_uid, p_type, p_at - (k * interval '7 days'), p_at - ((k - 1) * interval '7 days'));
    IF v_w > 0 THEN v_sum := v_sum + v_w; v_n := v_n + 1; END IF;
  END LOOP;

  level := v_level;
  baseline_weeks := v_n;
  baseline := CASE WHEN v_n > 0 THEN GREATEST(round(v_sum / v_n), v_starter / 2)
                   ELSE v_starter END;
  target := round(baseline * (1 + 0.04 * (v_level - 1)));
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.past_you_plan(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.past_you_plan(uuid, text, timestamptz) TO service_role;

-- ── Attempt it ─────────────────────────────────────────────────────────────
-- Rolled back by the closing RAISE. Asserts both directions: the cheat does
-- not score, and an honest session still does.

DO $$
DECLARE
  a UUID := gen_random_uuid();
  s RECORD;
  v NUMERIC;
  tiny JSONB := '[{"name":"Curl","sets":[{"weight":"45","reps":"1"}]}]';
  big  JSONB := '[{"name":"Squat","sets":[{"weight":"300","reps":"10"}]},{"name":"Bench","sets":[{"weight":"250","reps":"10"}]}]';
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    VALUES (a, 'rivalfloor-probe-' || a || '@example.invalid', 'authenticated', 'authenticated', FALSE);

    -- Sandbag: one 45 lb set a week for four weeks.
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    SELECT 'probe', a, tiny, now() - (k * interval '7 days') + interval '1 hour' FROM generate_series(1, 4) k;
    SELECT * INTO s FROM public.past_you_plan(a, 'gym', now());
    IF s.baseline <> 5000 OR s.target <> 5000 THEN
      RAISE EXCEPTION 'probe: sandbagged gym baseline % target %', s.baseline, s.target;
    END IF;

    -- A real lifter above the floor keeps their own average.
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    SELECT 'probe', a, big, now() - (k * interval '7 days') + interval '2 hours' FROM generate_series(1, 4) k;
    SELECT * INTO s FROM public.past_you_plan(a, 'gym', now());
    -- 45 + 3,000 + 2,500 a week.
    IF s.baseline <> 5545 OR s.baseline_weeks <> 4 THEN
      RAISE EXCEPTION 'probe: honest gym baseline % over % weeks', s.baseline, s.baseline_weeks;
    END IF;

    -- Cardio: an impossible row does not score, an honest run does.
    INSERT INTO public.cardio_logs (created_by, user_id, type, distance_meters, duration_seconds, created_at)
    VALUES ('probe', a, 'running_outside', 1000000000, NULL, now() - interval '1 hour'),   -- 1,000,000 km
           ('probe', a, 'running_outside', 50000, 600, now() - interval '1 hour'),         -- 300 km/h
           ('probe', a, 'running_outside', 5000, 1800, now() - interval '1 hour');         -- honest 5 km
    v := public.gym_rival_score(a, 'cardio', now() - interval '1 day', now());
    IF v <> 5000 THEN RAISE EXCEPTION 'probe: cardio scored % (want 5000)', v; END IF;

    -- Many plausible rows in one day still cap at 250 km.
    INSERT INTO public.cardio_logs (created_by, user_id, type, distance_meters, duration_seconds, created_at)
    SELECT 'probe', a, 'walking_outside', 200000, NULL, now() - interval '2 hours' FROM generate_series(1, 5);
    v := public.gym_rival_score(a, 'cardio', now() - interval '1 day', now());
    -- 250 km for the walking day plus the honest 5 km, which may fall on either side of midnight.
    IF v > 255000 OR v < 250000 THEN RAISE EXCEPTION 'probe: capped day scored % m', v; END IF;

    -- A cardio beginner below the floor races 2.5 km.
    DELETE FROM public.cardio_logs WHERE user_id = a;
    INSERT INTO public.cardio_logs (created_by, user_id, type, distance_meters, duration_seconds, created_at)
    VALUES ('probe', a, 'walking_outside', 100, 120, now() - interval '8 days');
    SELECT * INTO s FROM public.past_you_plan(a, 'cardio', now());
    IF s.baseline <> 2500 THEN RAISE EXCEPTION 'probe: cardio floor %', s.baseline; END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'probe passed';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
END;
$$;
