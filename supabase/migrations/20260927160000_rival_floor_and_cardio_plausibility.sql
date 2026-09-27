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
--
-- 3. created_at was client-writable on workout_logs and cardio_logs, and every
--    Rival scorer windows on it, so old sessions could be moved into a live
--    match and back out after it paid. It is now pinned for client roles.
--
-- 4. The gym score only honoured the per-`date` flag and never bounded the
--    bodyweight term, so huge-rep bodyweight sets scored without limit. Each
--    created_at day is now capped at the flag's own modelled ceiling.
--
-- 5. One malformed set (an 11-digit rep count) made past_you_settle throw,
--    and since it settled every user in one transaction, and Start called it,
--    that one row stopped settlement and Start for everyone. Each race now
--    settles on its own and Start settles only the caller's.
--
-- 6. The win notification now states the XP and coins that actually landed.

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
       AND (s->>'reps') ~ '^[0-9]{1,4}$' AND (s->>'reps')::int > 0
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

-- Races already running keep the target they were created with. Lift any
-- below the floor now, or they pay out once more on the old number.
UPDATE public.past_you_matches
   SET baseline = CASE WHEN rival_type = 'cardio' THEN 2500 ELSE 5000 END,
       target   = round(CASE WHEN rival_type = 'cardio' THEN 2500 ELSE 5000 END * (1 + 0.04 * (level - 1)))
 WHERE status = 'active'
   AND baseline < CASE WHEN rival_type = 'cardio' THEN 2500 ELSE 5000 END;

-- ── created_at belongs to the server ───────────────────────────────────────
-- Every Rival scorer windows on created_at, and a client could PATCH it: move
-- last month's sessions into this week's match, win without training, move
-- them back. The implausibility trigger never saw it, because it groups by
-- `date`. The app never sends created_at on either table, so a client value
-- is replaced with now() on insert and kept as it was on update. Server code
-- (SECURITY DEFINER functions, service_role, migrations) is not a client and
-- is left alone.

CREATE OR REPLACE FUNCTION public.pin_client_created_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  ELSE
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a_pin_created_at ON public.workout_logs;
CREATE TRIGGER a_pin_created_at BEFORE INSERT OR UPDATE ON public.workout_logs
  FOR EACH ROW EXECUTE FUNCTION public.pin_client_created_at();
DROP TRIGGER IF EXISTS a_pin_created_at ON public.cardio_logs;
CREATE TRIGGER a_pin_created_at BEFORE INSERT OR UPDATE ON public.cardio_logs
  FOR EACH ROW EXECUTE FUNCTION public.pin_client_created_at();

-- ── Gym volume: a day can only score what a day can hold ────────────────────
-- The implausibility flag sums weight x reps per `date`. The scorer windows on
-- created_at and also adds bodyweight x load factor x reps, which the flag
-- never counts, so a bodyweight set with enormous reps scored without limit.
-- Reps are now bounded before the cast (an unbounded digit string also threw
-- "integer out of range" elsewhere) and each created_at day is capped at the
-- same modelled ceiling the flag uses.

CREATE OR REPLACE FUNCTION public.gym_rival_volume_lbs(p_uid uuid, p_from timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE v_bw NUMERIC; v_ceiling NUMERIC; v_vol NUMERIC := 0;
BEGIN
  SELECT weight_lbs INTO v_bw FROM public.user_profiles WHERE id = p_uid;
  IF v_bw IS NULL OR v_bw <= 0 THEN v_bw := 0; END IF;
  v_ceiling := public.user_daily_volume_ceiling(p_uid);

  SELECT COALESCE(SUM(CASE WHEN COALESCE(v_ceiling, 0) > 0 THEN LEAST(day_vol, v_ceiling) ELSE day_vol END), 0)
    INTO v_vol
    FROM (
      SELECT created_at::date AS d,
             SUM((COALESCE(v_bw * public.bodyweight_load_factor(ex->>'name'), 0)
                  + COALESCE(NULLIF(s->>'weight','')::numeric, 0))
                 * (s->>'reps')::numeric) AS day_vol
        FROM public.workout_logs,
             jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
             jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
       WHERE user_id = p_uid
         AND created_at >= p_from
         AND (p_to IS NULL OR created_at < p_to)
         AND NOT COALESCE(implausible, FALSE)
         AND (s->>'reps') ~ '^[0-9]{1,4}$'
         AND (s->>'weight' IS NULL OR s->>'weight' = '' OR (s->>'weight') ~ '^[0-9]{1,5}(\.[0-9]+)?$')
       GROUP BY 1
    ) days;

  RETURN COALESCE(v_vol, 0);
END;
$function$;

-- ── Settlement: one bad race cannot stop the rest ───────────────────────────
-- past_you_settle was one loop in one transaction, and past_you_start called
-- it for EVERYONE. Any error in one match (the reps cast above was one) rolled
-- back every user's settlement every hour and failed every user's Start. Each
-- match now settles on its own, a failure is skipped and logged, and Start
-- settles only the caller's own race.
--
-- The notification also said "+1000 XP, +100 coins" whatever landed, while
-- award_xp_internal and the coin ledger both clamp at their daily caps. It now
-- reports what the balances actually moved by, as 20260927081000 did for
-- streaks.

CREATE OR REPLACE FUNCTION public.past_you_settle_match(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  m public.past_you_matches%ROWTYPE;
  v_score NUMERIC; v_won BOOLEAN; v_prs INTEGER; v_next INTEGER;
  v_you TEXT; v_goal TEXT; v_email TEXT; v_paid TEXT;
  v_xp0 BIGINT; v_xp1 BIGINT; v_c0 NUMERIC; v_c1 NUMERIC;
BEGIN
  SELECT * INTO m FROM public.past_you_matches
   WHERE id = p_id AND status = 'active' AND ends_at <= now()
   FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  v_score := public.gym_rival_score(m.user_id, m.rival_type, m.started_at, m.ends_at);
  v_won   := v_score >= m.target;
  v_prs   := public.past_you_pr_count(m.user_id, m.rival_type, m.started_at, m.ends_at);
  v_next  := LEAST(20, GREATEST(1, m.level + CASE WHEN v_won THEN 1 ELSE -1 END + LEAST(v_prs, 2)));
  IF m.rival_type = 'cardio' THEN
    v_you := to_char(v_score / 1000, 'FM999,990.0') || ' km'; v_goal := to_char(m.target / 1000, 'FM999,990.0') || ' km';
  ELSE
    v_you := to_char(v_score, 'FM999,999,990') || ' lb'; v_goal := to_char(m.target, 'FM999,999,990') || ' lb';
  END IF;

  UPDATE public.past_you_matches
     SET status = 'completed', final_score = v_score, won = v_won, prs = v_prs,
         next_level = v_next, settled_at = now()
   WHERE id = m.id;

  SELECT email INTO v_email FROM auth.users WHERE id = m.user_id;

  IF v_won THEN
    SELECT COALESCE(total_xp, 0), COALESCE(flex_coins, 0) INTO v_xp0, v_c0
      FROM public.user_profiles WHERE id = m.user_id;
    PERFORM public.award_xp_internal(m.user_id, 1000);
    UPDATE public.user_profiles SET flex_coins = COALESCE(flex_coins, 0) + 100 WHERE id = m.user_id;
    INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
    VALUES (m.user_id, v_email, 'standard');
    SELECT COALESCE(total_xp, 0), COALESCE(flex_coins, 0) INTO v_xp1, v_c1
      FROM public.user_profiles WHERE id = m.user_id;
    v_paid := concat_ws(', ',
      CASE WHEN v_xp1 - v_xp0 > 0 THEN '+' || (v_xp1 - v_xp0) || ' XP' END,
      CASE WHEN v_c1 - v_c0 > 0 THEN '+' || round(v_c1 - v_c0) || ' coins' END,
      '1 capsule') || '.';
  END IF;

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (m.user_id, v_email, 'nemesis_overthrown',
    CASE WHEN v_won THEN '🏆 You beat Past You' ELSE 'Past You held on this week' END,
    'You logged ' || v_you || ' against a target of ' || v_goal || '. '
      || CASE WHEN v_won THEN v_paid || ' ' ELSE '' END
      || 'Past You is level ' || v_next || ' next week.',
    CASE WHEN v_won THEN '🏆' ELSE '👻' END, '/workout',
    jsonb_build_object('past_you_id', m.id, 'result', CASE WHEN v_won THEN 'past_you_win' ELSE 'past_you_loss' END,
                       'prs', v_prs, 'next_level', v_next));
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.past_you_settle()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE v_id UUID; v_n INTEGER := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM public.past_you_matches WHERE status = 'active' AND ends_at <= now() ORDER BY ends_at
  LOOP
    BEGIN
      IF public.past_you_settle_match(v_id) THEN v_n := v_n + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'past_you_settle: match % skipped: %', v_id, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.past_you_settle_match(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.past_you_settle_match(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.past_you_settle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.past_you_settle() TO service_role;

-- Start: settle only the caller's own finished race, and serialise two taps
-- so the second one gets the live match back instead of a unique violation.
CREATE OR REPLACE FUNCTION public.past_you_start(p_type text DEFAULT 'gym')
RETURNS SETOF public.past_you_matches
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_type TEXT := CASE WHEN p_type = 'cardio' THEN 'cardio' ELSE 'gym' END;
  v_plan RECORD; v_id UUID; v_due UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid AND is_anonymous) THEN
    RAISE EXCEPTION 'guest_account' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('past_you_start:' || v_uid::text));

  FOR v_due IN
    SELECT id FROM public.past_you_matches WHERE user_id = v_uid AND status = 'active' AND ends_at <= now()
  LOOP
    BEGIN
      PERFORM public.past_you_settle_match(v_due);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'past_you_start: settling % failed: %', v_due, SQLERRM;
    END;
  END LOOP;

  -- Already racing: hand back the live match rather than stacking a second.
  IF EXISTS (SELECT 1 FROM public.past_you_matches WHERE user_id = v_uid AND status = 'active') THEN
    RETURN QUERY SELECT * FROM public.past_you_matches WHERE user_id = v_uid AND status = 'active';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.gym_rival_assignments
              WHERE status IN ('pending', 'active') AND (user_id = v_uid OR rival_id = v_uid)) THEN
    RAISE EXCEPTION 'rival_in_progress' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_plan FROM public.past_you_plan(v_uid, v_type, now());

  BEGIN
    INSERT INTO public.past_you_matches (user_id, rival_type, level, baseline, baseline_weeks, target, started_at, ends_at)
    VALUES (v_uid, v_type, v_plan.level, v_plan.baseline, v_plan.baseline_weeks, v_plan.target, now(), now() + interval '7 days')
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT * FROM public.past_you_matches WHERE user_id = v_uid AND status = 'active';
    RETURN;
  END;

  RETURN QUERY SELECT * FROM public.past_you_matches WHERE id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.past_you_start(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.past_you_start(text) TO authenticated, service_role;

-- ── Attempt it ─────────────────────────────────────────────────────────────
-- Rolled back by the closing RAISE. Asserts both directions: the cheat does
-- not score, and an honest session still does.

DO $$
DECLARE
  a UUID := gen_random_uuid();
  s RECORD;
  v NUMERIC;
  v_log UUID; v_mid UUID; v_ts TIMESTAMPTZ; v_body TEXT;
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

    -- A client cannot place a session in the past, or move one later.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated',
      'email', 'rivalfloor-probe-' || a || '@example.invalid')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('rivalfloor-probe-' || a || '@example.invalid', a, tiny, now() - interval '30 days') RETURNING id INTO v_log;
    UPDATE public.workout_logs SET created_at = now() - interval '60 days' WHERE id = v_log;
    RESET ROLE;
    SELECT created_at INTO v_ts FROM public.workout_logs WHERE id = v_log;
    IF v_ts <> now() THEN RAISE EXCEPTION 'probe: client set created_at to %', v_ts; END IF;
    DELETE FROM public.workout_logs WHERE id = v_log;

    -- A bodyweight set with enormous reps scores no more than a day can hold,
    -- and an 11-digit rep count is ignored rather than thrown on.
    INSERT INTO public.user_profiles (id, email, weight_lbs)
    VALUES (a, 'rivalfloor-probe-' || a || '@example.invalid', 1500)
    ON CONFLICT (id) DO UPDATE SET weight_lbs = 1500;
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, '[{"name":"Pull Up","sets":[{"weight":"0","reps":"9999"}]}]', now() - interval '3 hours'),
           ('probe', a, '[{"name":"Curl","sets":[{"weight":"0","reps":"99999999999"}]}]', now() - interval '3 hours');
    v := public.gym_rival_volume_lbs(a, now() - interval '1 day', now());
    IF v > public.user_daily_volume_ceiling(a) THEN
      RAISE EXCEPTION 'probe: one day scored % against a ceiling of %', v, public.user_daily_volume_ceiling(a);
    END IF;
    PERFORM public.past_you_pr_count(a, 'gym', now() - interval '1 day', now());

    -- A finished race settles on its own and reports what it paid.
    INSERT INTO public.past_you_matches (user_id, rival_type, level, baseline, baseline_weeks, target, started_at, ends_at)
    VALUES (a, 'gym', 1, 5000, 0, 5000, now() - interval '8 days', now() - interval '1 day')
    RETURNING id INTO v_mid;
    IF NOT public.past_you_settle_match(v_mid) THEN RAISE EXCEPTION 'probe: race did not settle'; END IF;
    IF public.past_you_settle_match(v_mid) THEN RAISE EXCEPTION 'probe: race settled twice'; END IF;
    SELECT body INTO v_body FROM public.notifications
     WHERE user_id = a AND metadata->>'past_you_id' = v_mid::text;
    IF v_body NOT LIKE '%target of 5,000 lb%' OR v_body NOT LIKE '%+1000 XP%' THEN
      RAISE EXCEPTION 'probe: settle notice read "%"', v_body;
    END IF;

    -- Start still works after all of that, and a second tap returns the same race.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    SELECT id INTO v_mid FROM public.past_you_start('gym');
    IF (SELECT id FROM public.past_you_start('gym')) <> v_mid THEN
      RAISE EXCEPTION 'probe: a second tap started a second race';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'probe passed';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
END;
$$;
