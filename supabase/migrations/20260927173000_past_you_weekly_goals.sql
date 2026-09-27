-- Past You: three weekly goals on top of the race.
--
-- The race is one number over seven days, which leaves nothing to do between
-- Monday and Sunday and pays nothing to a lifter who shows up but loses.
-- Each race now carries three small goals, checked by the server from the
-- same logs the race scores:
--
--   days   train on 3 different days (a real gym session or cardio session)
--   pr     beat one of your bests (a lift's e1RM, or your longest cardio)
--   cross  do the other kind once (cardio in a gym race, lifting in a cardio race)
--
-- Each goal met pays 150 XP and 15 coins at settlement, win or lose, so even a
-- lost week rewards the habits the app exists to build. Nothing is stored
-- while the race runs; the goals are recomputed from the logs every read, and
-- written onto the match once when it settles.
--
-- What counts as a session, so a goal cannot be met by an empty row:
--   gym     a workout_log not flagged implausible with at least 3 sets of
--           1 or more reps
--   cardio  a plausible row of at least 1 km, or a distance-free row (bike,
--           rower) of 10 minutes to 12 hours
-- Days are the lifter's local days (user_profiles.timezone_offset_minutes),
-- and created_at is server-pinned (20260927160000), so nothing is backdated.

ALTER TABLE public.past_you_matches ADD COLUMN IF NOT EXISTS objectives jsonb;

CREATE OR REPLACE FUNCTION public.past_you_objectives(p_uid uuid, p_type text, p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_off INTEGER; v_days INTEGER; v_gym INTEGER; v_cardio INTEGER; v_prs INTEGER; v_cross INTEGER;
BEGIN
  SELECT COALESCE(timezone_offset_minutes, 0) INTO v_off FROM public.user_profiles WHERE id = p_uid;
  v_off := COALESCE(v_off, 0);

  WITH gym AS (
    SELECT ((wl.created_at + make_interval(mins => v_off)) AT TIME ZONE 'UTC')::date AS d
      FROM public.workout_logs wl
     WHERE wl.user_id = p_uid AND wl.created_at >= p_from AND wl.created_at < p_to
       AND NOT COALESCE(wl.implausible, FALSE)
       AND (SELECT count(*)
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(wl.exercises) = 'array' THEN wl.exercises ELSE '[]'::jsonb END) ex,
                   jsonb_array_elements(CASE WHEN jsonb_typeof(ex->'sets') = 'array' THEN ex->'sets' ELSE '[]'::jsonb END) s
             WHERE (s->>'reps') ~ '^[0-9]{1,4}$' AND (s->>'reps')::int > 0) >= 3
  ), cardio AS (
    SELECT ((c.created_at + make_interval(mins => v_off)) AT TIME ZONE 'UTC')::date AS d
      FROM public.cardio_logs c
     WHERE c.user_id = p_uid AND c.created_at >= p_from AND c.created_at < p_to
       AND ((public.cardio_log_is_plausible(COALESCE(c.type, c.activity_type), c.distance_meters, c.duration_seconds)
             AND c.distance_meters >= 1000)
            OR (COALESCE(c.distance_meters, 0) = 0 AND c.duration_seconds BETWEEN 600 AND 43200))
  )
  SELECT (SELECT count(DISTINCT d) FROM (SELECT d FROM gym UNION SELECT d FROM cardio) u),
         (SELECT count(*) FROM gym),
         (SELECT count(*) FROM cardio)
    INTO v_days, v_gym, v_cardio;

  v_prs   := public.past_you_pr_count(p_uid, p_type, p_from, p_to);
  v_cross := CASE WHEN p_type = 'cardio' THEN v_gym ELSE v_cardio END;

  RETURN jsonb_build_array(
    jsonb_build_object('key', 'days',  'progress', LEAST(v_days, 3),  'goal', 3, 'done', v_days >= 3),
    jsonb_build_object('key', 'pr',    'progress', LEAST(v_prs, 1),   'goal', 1, 'done', v_prs >= 1),
    jsonb_build_object('key', 'cross', 'progress', LEAST(v_cross, 1), 'goal', 1, 'done', v_cross >= 1));
END;
$$;

REVOKE ALL ON FUNCTION public.past_you_objectives(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.past_you_objectives(uuid, text, timestamptz, timestamptz) TO service_role;

-- The client door: your own race only. A settled race returns what was
-- written at settlement, so the result screen matches what was paid.
CREATE OR REPLACE FUNCTION public.past_you_goals(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE m public.past_you_matches%ROWTYPE;
BEGIN
  SELECT * INTO m FROM public.past_you_matches WHERE id = p_id AND user_id = auth.uid();
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF m.status = 'completed' THEN RETURN m.objectives; END IF;
  RETURN public.past_you_objectives(m.user_id, m.rival_type, m.started_at, LEAST(now(), m.ends_at));
END;
$$;

REVOKE ALL ON FUNCTION public.past_you_goals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.past_you_goals(uuid) TO authenticated, service_role;

-- Settlement pays the race and the goals together and says what landed.
CREATE OR REPLACE FUNCTION public.past_you_settle_match(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  m public.past_you_matches%ROWTYPE;
  v_score NUMERIC; v_won BOOLEAN; v_prs INTEGER; v_next INTEGER; v_goals JSONB; v_met INTEGER;
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
  v_goals := public.past_you_objectives(m.user_id, m.rival_type, m.started_at, m.ends_at);
  SELECT count(*) INTO v_met FROM jsonb_array_elements(v_goals) g WHERE (g->>'done')::boolean;
  IF m.rival_type = 'cardio' THEN
    v_you := to_char(v_score / 1000, 'FM999,990.0') || ' km'; v_goal := to_char(m.target / 1000, 'FM999,990.0') || ' km';
  ELSE
    v_you := to_char(v_score, 'FM999,999,990') || ' lb'; v_goal := to_char(m.target, 'FM999,999,990') || ' lb';
  END IF;

  UPDATE public.past_you_matches
     SET status = 'completed', final_score = v_score, won = v_won, prs = v_prs,
         next_level = v_next, objectives = v_goals, settled_at = now()
   WHERE id = m.id;

  SELECT email INTO v_email FROM auth.users WHERE id = m.user_id;

  IF v_won OR v_met > 0 THEN
    SELECT COALESCE(total_xp, 0), COALESCE(flex_coins, 0) INTO v_xp0, v_c0
      FROM public.user_profiles WHERE id = m.user_id;
    PERFORM public.award_xp_internal(m.user_id, CASE WHEN v_won THEN 1000 ELSE 0 END + 150 * v_met);
    UPDATE public.user_profiles
       SET flex_coins = COALESCE(flex_coins, 0) + CASE WHEN v_won THEN 100 ELSE 0 END + 15 * v_met
     WHERE id = m.user_id;
    IF v_won THEN
      INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
      VALUES (m.user_id, v_email, 'standard');
    END IF;
    SELECT COALESCE(total_xp, 0), COALESCE(flex_coins, 0) INTO v_xp1, v_c1
      FROM public.user_profiles WHERE id = m.user_id;
    v_paid := concat_ws(', ',
      CASE WHEN v_xp1 - v_xp0 > 0 THEN '+' || (v_xp1 - v_xp0) || ' XP' END,
      CASE WHEN v_c1 - v_c0 > 0 THEN '+' || round(v_c1 - v_c0) || ' coins' END,
      CASE WHEN v_won THEN '1 capsule' END);
    v_paid := CASE WHEN v_paid = '' THEN NULL ELSE v_paid || '. ' END;
  END IF;

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (m.user_id, v_email, 'nemesis_overthrown',
    CASE WHEN v_won THEN '🏆 You beat Past You' ELSE 'Past You held on this week' END,
    'You logged ' || v_you || ' against a target of ' || v_goal || '. '
      || v_met || ' of 3 weekly goals met. '
      || COALESCE(v_paid, '')
      || 'Past You is level ' || v_next || ' next week.',
    CASE WHEN v_won THEN '🏆' ELSE '👻' END, '/workout',
    jsonb_build_object('past_you_id', m.id, 'result', CASE WHEN v_won THEN 'past_you_win' ELSE 'past_you_loss' END,
                       'prs', v_prs, 'next_level', v_next, 'goals_met', v_met));
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.past_you_settle_match(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.past_you_settle_match(uuid) TO service_role;

-- ── Attempt it ─────────────────────────────────────────────────────────────
-- Rolled back by the closing RAISE. Both directions: empty or fake sessions
-- meet nothing, real ones meet the goals, a lost week still pays them, and
-- another user cannot read your goals.

DO $$
DECLARE
  a UUID := gen_random_uuid();
  b UUID := gen_random_uuid();
  v_mid UUID;
  g JSONB;
  v_body TEXT;
  v_xp0 BIGINT; v_xp1 BIGINT;
  two  JSONB := '[{"name":"Curl","sets":[{"weight":"20","reps":"10"},{"weight":"20","reps":"10"}]}]';
  real JSONB := '[{"name":"Bench Press","sets":[{"weight":"100","reps":"5"},{"weight":"100","reps":"5"},{"weight":"100","reps":"5"}]}]';
  best JSONB := '[{"name":"Bench Press","sets":[{"weight":"120","reps":"5"},{"weight":"100","reps":"5"},{"weight":"100","reps":"5"}]}]';
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    VALUES (a, 'goals-probe-a-' || a || '@example.invalid', 'authenticated', 'authenticated', FALSE),
           (b, 'goals-probe-b-' || b || '@example.invalid', 'authenticated', 'authenticated', FALSE);
    INSERT INTO public.user_profiles (id, email) VALUES (a, 'goals-probe-a-' || a || '@example.invalid')
    ON CONFLICT (id) DO NOTHING;

    -- History before the race: a bench of 100 x 5.
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, real, now() - interval '20 days');

    INSERT INTO public.past_you_matches (user_id, rival_type, level, baseline, baseline_weeks, target, started_at, ends_at)
    VALUES (a, 'gym', 1, 5000, 1, 1000000, now() - interval '8 days', now() - interval '1 day')
    RETURNING id INTO v_mid;

    -- Thin rows meet nothing: two sets, and a 200 m walk.
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, two, now() - interval '7 days'),
           ('probe', a, two, now() - interval '6 days'),
           ('probe', a, two, now() - interval '5 days');
    INSERT INTO public.cardio_logs (created_by, user_id, type, distance_meters, duration_seconds, created_at)
    VALUES ('probe', a, 'walking_outside', 200, 180, now() - interval '5 days');
    g := public.past_you_objectives(a, 'gym', now() - interval '8 days', now() - interval '1 day');
    IF (SELECT count(*) FROM jsonb_array_elements(g) x WHERE (x->>'done')::boolean) <> 0 THEN
      RAISE EXCEPTION 'probe: thin sessions met goals: %', g;
    END IF;

    -- Real sessions on three days, one of them a bench best, plus a 2 km run.
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, real, now() - interval '7 days'),
           ('probe', a, best, now() - interval '5 days');
    INSERT INTO public.cardio_logs (created_by, user_id, type, distance_meters, duration_seconds, created_at)
    VALUES ('probe', a, 'running_outside', 2000, 720, now() - interval '3 days');
    g := public.past_you_objectives(a, 'gym', now() - interval '8 days', now() - interval '1 day');
    IF (SELECT count(*) FROM jsonb_array_elements(g) x WHERE (x->>'done')::boolean) <> 3 THEN
      RAISE EXCEPTION 'probe: real week met % goals: %', (SELECT count(*) FROM jsonb_array_elements(g) x WHERE (x->>'done')::boolean), g;
    END IF;

    -- Only the owner can read them.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    IF public.past_you_goals(v_mid) IS NOT NULL THEN RAISE EXCEPTION 'probe: another user read the goals'; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    IF public.past_you_goals(v_mid) IS NULL THEN RAISE EXCEPTION 'probe: owner could not read the goals'; END IF;

    -- A lost race (target out of reach) still pays three goals: 450 XP.
    SELECT COALESCE(total_xp, 0) INTO v_xp0 FROM public.user_profiles WHERE id = a;
    IF NOT public.past_you_settle_match(v_mid) THEN RAISE EXCEPTION 'probe: race did not settle'; END IF;
    SELECT COALESCE(total_xp, 0) INTO v_xp1 FROM public.user_profiles WHERE id = a;
    IF v_xp1 - v_xp0 <> 450 THEN RAISE EXCEPTION 'probe: lost week paid % XP (want 450)', v_xp1 - v_xp0; END IF;
    IF (SELECT won FROM public.past_you_matches WHERE id = v_mid) THEN RAISE EXCEPTION 'probe: race should be lost'; END IF;
    SELECT body INTO v_body FROM public.notifications WHERE user_id = a AND metadata->>'past_you_id' = v_mid::text;
    IF v_body NOT LIKE '%3 of 3 weekly goals met%' OR v_body NOT LIKE '%+450 XP%' THEN
      RAISE EXCEPTION 'probe: notice read "%"', v_body;
    END IF;
    IF public.past_you_goals(v_mid) IS DISTINCT FROM (SELECT objectives FROM public.past_you_matches WHERE id = v_mid) THEN
      RAISE EXCEPTION 'probe: settled race does not return its stored goals';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'probe passed';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
END;
$$;
