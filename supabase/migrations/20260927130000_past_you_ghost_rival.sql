-- Past You: a ghost rival built from the lifter's own logged history.
--
-- Kegan, 2026-09-27: when the human pool is empty, or when someone would
-- rather not race a stranger, they race "Past You". The ghost is honest by
-- construction: every number it holds came out of the user's own logs, so the
-- week is decided by what they actually did against what they have actually
-- done before.
--
-- How the ghost is built, per rival type (gym volume or cardio distance):
--   baseline = the mean score of the user's last four 7-day windows that had
--              any training, excluding flagged-implausible workouts (the same
--              scorer the human match uses, gym_rival_score)
--   target   = baseline x (1 + 4% per ghost level above 1), level 1..20
--   no history at all → a starter target (10,000 lb or 5 km)
--
-- How it gets harder: when the match settles, the next ghost level is
--   level + 1 if you beat the target, - 1 if you did not (never below 1),
--   + 1 for each personal record you set that week (at most 2).
-- So a PR makes Past You stronger next week, because you are.
--
-- Guests: Kegan's call is that guest accounts do not compete. Both past_you_start
-- and gym_rival_roll now refuse an anonymous caller with 42501 'guest_account';
-- the client shows a flyout asking them to connect an account first.
--
-- One rival at a time: a user in an active Past You match is left out of the
-- human pool, and starting Past You is refused while a human match is live.

-- ── Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.past_you_matches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rival_type     TEXT NOT NULL CHECK (rival_type IN ('gym', 'cardio')),
  level          INTEGER NOT NULL CHECK (level BETWEEN 1 AND 20),
  baseline       NUMERIC NOT NULL,
  baseline_weeks INTEGER NOT NULL,
  target         NUMERIC NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at        TIMESTAMPTZ NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  final_score    NUMERIC,
  won            BOOLEAN,
  prs            INTEGER,
  next_level     INTEGER,
  settled_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS past_you_one_active
  ON public.past_you_matches (user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS past_you_user_type
  ON public.past_you_matches (user_id, rival_type, started_at DESC);

ALTER TABLE public.past_you_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "past_you_own_read" ON public.past_you_matches;
CREATE POLICY "past_you_own_read" ON public.past_you_matches
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- Every write goes through the functions below; the table is read-only to
-- clients, the lesson of the human match's forgeable ALL policy.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.past_you_matches FROM anon, authenticated;
REVOKE ALL ON public.past_you_matches FROM anon;
GRANT SELECT ON public.past_you_matches TO authenticated;
GRANT ALL ON public.past_you_matches TO service_role;

-- ── Helpers ────────────────────────────────────────────────────────────────

-- Personal records set in [p_from, p_to): an exercise whose best Epley e1RM
-- in the window beats every earlier attempt at it (a first attempt is not a
-- record, matching detectPRsInWorkout on the client). Cardio counts one PR
-- when the longest session in the window beats the longest before it.
CREATE OR REPLACE FUNCTION public.past_you_pr_count(p_uid uuid, p_type text, p_from timestamptz, p_to timestamptz)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE v INTEGER := 0; v_new NUMERIC; v_old NUMERIC;
BEGIN
  IF p_type = 'cardio' THEN
    SELECT MAX(distance_meters) INTO v_new FROM public.cardio_logs
     WHERE user_id = p_uid AND created_at >= p_from AND created_at < p_to;
    SELECT MAX(distance_meters) INTO v_old FROM public.cardio_logs
     WHERE user_id = p_uid AND created_at < p_from;
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
$$;

-- What the ghost will be for a match starting at p_at: the level carried
-- over from the last settled match of this type, and the baseline from the
-- four weeks before p_at.
CREATE OR REPLACE FUNCTION public.past_you_plan(p_uid uuid, p_type text, p_at timestamptz DEFAULT now())
RETURNS TABLE (level integer, baseline numeric, baseline_weeks integer, target numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE v_level INTEGER; v_sum NUMERIC := 0; v_n INTEGER := 0; v_w NUMERIC; k INTEGER;
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
  baseline := CASE WHEN v_n > 0 THEN round(v_sum / v_n)
                   WHEN p_type = 'cardio' THEN 5000 ELSE 10000 END;
  target := round(baseline * (1 + 0.04 * (v_level - 1)));
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.past_you_pr_count(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.past_you_plan(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.past_you_pr_count(uuid, text, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.past_you_plan(uuid, text, timestamptz) TO service_role;

-- ── Client RPCs ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.past_you_start(p_type text DEFAULT 'gym')
RETURNS SETOF public.past_you_matches
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_type TEXT := CASE WHEN p_type = 'cardio' THEN 'cardio' ELSE 'gym' END;
  v_plan RECORD; v_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid AND is_anonymous) THEN
    RAISE EXCEPTION 'guest_account' USING ERRCODE = '42501';
  END IF;

  PERFORM public.past_you_settle();

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

  INSERT INTO public.past_you_matches (user_id, rival_type, level, baseline, baseline_weeks, target, started_at, ends_at)
  VALUES (v_uid, v_type, v_plan.level, v_plan.baseline, v_plan.baseline_weeks, v_plan.target, now(), now() + interval '7 days')
  RETURNING id INTO v_id;

  RETURN QUERY SELECT * FROM public.past_you_matches WHERE id = v_id;
END;
$$;

-- The live race. ghost_pace is where Past You would be right now if it
-- trained evenly across the week: the target times the share of the week
-- gone. It is the number to beat today, and it reaches the target at the end.
CREATE OR REPLACE FUNCTION public.past_you_state(p_id uuid)
RETURNS TABLE (you_score numeric, ghost_pace numeric, target numeric, level integer,
               baseline numeric, baseline_weeks integer, prs integer,
               started_at timestamptz, ends_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE m public.past_you_matches%ROWTYPE; v_to TIMESTAMPTZ; v_frac NUMERIC;
BEGIN
  SELECT * INTO m FROM public.past_you_matches WHERE id = p_id AND user_id = auth.uid();
  IF NOT FOUND THEN RETURN; END IF;

  v_to := LEAST(now(), m.ends_at);
  v_frac := GREATEST(0, LEAST(1,
    EXTRACT(EPOCH FROM (v_to - m.started_at)) / EXTRACT(EPOCH FROM (m.ends_at - m.started_at))));

  you_score := COALESCE(m.final_score, public.gym_rival_score(m.user_id, m.rival_type, m.started_at, m.ends_at));
  ghost_pace := round(m.target * v_frac);
  target := m.target;
  level := m.level;
  baseline := m.baseline;
  baseline_weeks := m.baseline_weeks;
  prs := COALESCE(m.prs, public.past_you_pr_count(m.user_id, m.rival_type, m.started_at, v_to));
  started_at := m.started_at;
  ends_at := m.ends_at;
  RETURN NEXT;
END;
$$;

-- Walk away from the race. Pays nothing and leaves the ghost's level where
-- it was, so quitting is never a way to make next week easier.
CREATE OR REPLACE FUNCTION public.past_you_abandon(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  UPDATE public.past_you_matches
     SET status = 'abandoned', settled_at = now()
   WHERE id = p_id AND user_id = auth.uid() AND status = 'active';
END;
$$;

-- ── Settlement (cron, and lazily from past_you_start) ───────────────────────

CREATE OR REPLACE FUNCTION public.past_you_settle()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  m public.past_you_matches%ROWTYPE;
  v_score NUMERIC; v_won BOOLEAN; v_prs INTEGER; v_next INTEGER;
  v_you TEXT; v_goal TEXT; v_email TEXT; v_n INTEGER := 0;
BEGIN
  FOR m IN
    SELECT * FROM public.past_you_matches
     WHERE status = 'active' AND ends_at <= now()
     FOR UPDATE SKIP LOCKED
  LOOP
    v_score := public.gym_rival_score(m.user_id, m.rival_type, m.started_at, m.ends_at);
    v_won   := v_score >= m.target;
    v_prs   := public.past_you_pr_count(m.user_id, m.rival_type, m.started_at, m.ends_at);
    v_next  := LEAST(20, GREATEST(1, m.level + CASE WHEN v_won THEN 1 ELSE -1 END + LEAST(v_prs, 2)));
    IF m.rival_type = 'cardio' THEN
      v_you := round(v_score / 1000, 1) || ' km'; v_goal := round(m.target / 1000, 1) || ' km';
    ELSE
      v_you := round(v_score) || ' lb'; v_goal := round(m.target) || ' lb';
    END IF;

    UPDATE public.past_you_matches
       SET status = 'completed', final_score = v_score, won = v_won, prs = v_prs,
           next_level = v_next, settled_at = now()
     WHERE id = m.id;

    SELECT email INTO v_email FROM auth.users WHERE id = m.user_id;

    IF v_won THEN
      PERFORM public.award_xp_internal(m.user_id, 1000);
      UPDATE public.user_profiles SET flex_coins = COALESCE(flex_coins, 0) + 100 WHERE id = m.user_id;
      INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
      VALUES (m.user_id, v_email, 'standard');
    END IF;

    INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES (m.user_id, v_email, 'nemesis_overthrown',
      CASE WHEN v_won THEN '🏆 You beat Past You' ELSE 'Past You held on this week' END,
      CASE WHEN v_won
        THEN 'You logged ' || v_you || ' against a target of ' || v_goal
             || '. +1000 XP, +100 coins, 1 capsule. Past You is level ' || v_next || ' next week.'
        ELSE 'You logged ' || v_you || ' against a target of ' || v_goal
             || '. Past You is level ' || v_next || ' next week.' END,
      CASE WHEN v_won THEN '🏆' ELSE '👻' END, '/workout',
      jsonb_build_object('past_you_id', m.id, 'result', CASE WHEN v_won THEN 'past_you_win' ELSE 'past_you_loss' END,
                         'prs', v_prs, 'next_level', v_next));

    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.past_you_start(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.past_you_state(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.past_you_abandon(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.past_you_settle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.past_you_start(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.past_you_state(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.past_you_abandon(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.past_you_settle() TO service_role;

SELECT cron.schedule('past-you-settle', '10 * * * *', $$SELECT public.past_you_settle()$$);

-- ── Human roll: no guests, and no one already racing Past You ──────────────
-- Restated from the installed body (pg_get_functiondef, 2026-09-27); the only
-- changes are the guest refusal, the Past You refusal and the pool filter.

CREATE OR REPLACE FUNCTION public.gym_rival_roll(p_type text DEFAULT 'gym'::text)
 RETURNS SETOF gym_rival_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_type TEXT := CASE WHEN p_type = 'cardio' THEN 'cardio' ELSE 'gym' END;
  v_label TEXT := CASE WHEN p_type = 'cardio' THEN 'Cardio Rival' ELSE 'Gym Rival' END;
  v_out_a NUMERIC; v_cad_a NUMERIC; v_str_a NUMERIC; v_age_a NUMERIC; v_lvl_a INTEGER;
  v_out_b NUMERIC; v_cad_b NUMERIC; v_str_b NUMERIC; v_age_b NUMERIC; v_lvl_b INTEGER;
  v_pass INTEGER; v_cand UUID; v_gap NUMERIC; v_best_gap NUMERIC;
  v_rival UUID; v_new_id UUID; v_name TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid AND is_anonymous) THEN
    RAISE EXCEPTION 'guest_account' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.past_you_matches WHERE user_id = v_uid AND status = 'active') THEN
    RAISE EXCEPTION 'past_you_in_progress' USING ERRCODE = 'P0001';
  END IF;

  -- Retire dead rows before searching: the caller's own stuck match must
  -- clear even when nobody is free, and a dead row elsewhere must not keep
  -- a real candidate out of the pool.
  PERFORM public.gym_rival_expire_stale();

  SELECT weekly_output, cadence, strength, lifter_age, lifter_level
    INTO v_out_a, v_cad_a, v_str_a, v_age_a, v_lvl_a
    FROM public.gym_rival_user_stats(v_uid, v_type);

  FOR v_pass IN 1..2 LOOP
    EXIT WHEN v_rival IS NOT NULL;
    FOR v_cand IN
      SELECT id FROM public.user_profiles
       WHERE id <> v_uid
         AND COALESCE(nemesis_opt_out, FALSE) = FALSE
         AND username IS NOT NULL
         AND last_active_at IS NOT NULL
         AND last_active_at >= now() - interval '7 days'
         AND id NOT IN (SELECT id FROM auth.users WHERE email IS NULL OR is_anonymous)
         AND id NOT IN (SELECT user_id FROM public.past_you_matches WHERE status = 'active')
         AND id NOT IN (
           SELECT user_id FROM public.gym_rival_assignments WHERE status IN ('pending','active')
           UNION
           SELECT rival_id FROM public.gym_rival_assignments WHERE status IN ('pending','active'))
         AND (v_pass = 2 OR id NOT IN (
           SELECT rival_id FROM public.gym_rival_assignments
            WHERE user_id = v_uid AND assigned_at >= now() - interval '21 days'
           UNION
           SELECT user_id FROM public.gym_rival_assignments
            WHERE rival_id = v_uid AND assigned_at >= now() - interval '21 days'))
       LIMIT 200
    LOOP
      SELECT weekly_output, cadence, strength, lifter_age, lifter_level
        INTO v_out_b, v_cad_b, v_str_b, v_age_b, v_lvl_b
        FROM public.gym_rival_user_stats(v_cand, v_type);
      v_gap := public.gym_rival_match_gap(v_out_a, v_cad_a, v_str_a, v_age_a, v_lvl_a,
                                          v_out_b, v_cad_b, v_str_b, v_age_b, v_lvl_b);
      IF v_best_gap IS NULL
         OR v_gap < v_best_gap - 0.02
         OR (ABS(v_gap - v_best_gap) <= 0.02 AND random() < 0.5) THEN
        v_best_gap := v_gap; v_rival := v_cand;
      END IF;
    END LOOP;
  END LOOP;

  IF v_rival IS NULL THEN RETURN; END IF;

  UPDATE public.gym_rival_assignments SET status = 'reassigned'
   WHERE status IN ('pending','active') AND (user_id = v_uid OR rival_id = v_uid);

  INSERT INTO public.gym_rival_assignments
    (user_id, rival_id, status, rival_type, initiator_confirmed, rival_confirmed, match_gap)
  VALUES (v_uid, v_rival, 'pending', v_type, FALSE, FALSE, v_best_gap)
  RETURNING id INTO v_new_id;

  SELECT username INTO v_name FROM public.user_profiles WHERE id = v_uid;

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  SELECT v_rival, email, 'nemesis_assigned',
    '🎯 @' || COALESCE(v_name, 'someone') || ' wants to be your ' || v_label,
    'Accept within 48 hours. The match runs seven days and the bigger week wins.',
    '🎯', '/workout',
    jsonb_build_object('assignment_id', v_new_id, 'initiator_id', v_uid, 'rival_type', v_type)
  FROM auth.users WHERE id = v_rival AND email IS NOT NULL;

  RETURN QUERY SELECT * FROM public.gym_rival_assignments WHERE id = v_new_id;
END;
$function$;

-- ── Attempt it ─────────────────────────────────────────────────────────────
-- Throwaway accounts, rolled back by the closing RAISE. The RPCs are called
-- with a real JWT claim so auth.uid() resolves exactly as it does for a client.

DO $$
DECLARE
  a UUID := gen_random_uuid();   -- a registered lifter with history
  g UUID := gen_random_uuid();   -- a guest
  m public.past_you_matches%ROWTYPE;
  s RECORD;
  v_failed BOOLEAN;
  set10 JSONB := '[{"name":"Bench Press","sets":[{"weight":"100","reps":"10"}]}]';
  pr    JSONB := '[{"name":"Bench Press","sets":[{"weight":"150","reps":"10"}]}]';
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    VALUES (a, 'pastyou-probe-' || a || '@example.invalid', 'authenticated', 'authenticated', FALSE),
           (g, NULL, 'authenticated', 'authenticated', TRUE);

    -- Two earlier weeks of 1,000 lb each: baseline 1,000.
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, set10, now() - interval '3 days'),
           ('probe', a, set10, now() - interval '10 days');

    -- A guest is refused, on both doors.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', g, 'role', 'authenticated')::text, true);
    v_failed := FALSE;
    BEGIN PERFORM public.past_you_start('gym'); EXCEPTION WHEN insufficient_privilege THEN v_failed := TRUE; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'probe: a guest started Past You'; END IF;
    v_failed := FALSE;
    BEGIN PERFORM public.gym_rival_roll('gym'); EXCEPTION WHEN insufficient_privilege THEN v_failed := TRUE; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'probe: a guest rolled a human rival'; END IF;

    -- A registered lifter starts at level 1 against their own average.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    SELECT * INTO m FROM public.past_you_start('gym');
    IF m.level <> 1 OR m.baseline <> 1000 OR m.baseline_weeks <> 2 OR m.target <> 1000 THEN
      RAISE EXCEPTION 'probe: plan was level % baseline % over % weeks target %',
        m.level, m.baseline, m.baseline_weeks, m.target;
    END IF;

    -- Starting again returns the same live match, not a second one.
    IF (SELECT id FROM public.past_you_start('cardio')) <> m.id THEN
      RAISE EXCEPTION 'probe: a second Past You match was created';
    END IF;

    -- Racing Past You keeps the lifter out of the human roll.
    v_failed := FALSE;
    BEGIN PERFORM public.gym_rival_roll('gym'); EXCEPTION WHEN raise_exception THEN v_failed := TRUE; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'probe: rolled a human while racing Past You'; END IF;

    -- Clients cannot write the table.
    SET LOCAL ROLE authenticated;
    v_failed := FALSE;
    BEGIN UPDATE public.past_you_matches SET target = 1 WHERE id = m.id;
    EXCEPTION WHEN insufficient_privilege THEN v_failed := TRUE; END;
    RESET ROLE;
    IF NOT v_failed THEN RAISE EXCEPTION 'probe: a client rewrote its ghost target'; END IF;

    -- Two days into the week, train: 1,000 lb plus a 1,500 lb bench record.
    UPDATE public.past_you_matches
       SET started_at = now() - interval '2 days', ends_at = now() + interval '5 days'
     WHERE id = m.id;
    INSERT INTO public.workout_logs (created_by, user_id, exercises, created_at)
    VALUES ('probe', a, set10, now() - interval '1 hour'), ('probe', a, pr, now() - interval '1 hour');

    SELECT * INTO s FROM public.past_you_state(m.id);
    IF s.you_score <> 2500 OR s.prs <> 1 OR s.ghost_pace <> round(1000 * 2.0 / 7) THEN
      RAISE EXCEPTION 'probe: live state score % prs % pace %', s.you_score, s.prs, s.ghost_pace;
    END IF;

    -- End the week and settle: a win plus one PR is level 3 next week.
    UPDATE public.past_you_matches SET ends_at = now() WHERE id = m.id;
    PERFORM public.past_you_settle();
    SELECT * INTO m FROM public.past_you_matches WHERE id = m.id;
    IF m.status <> 'completed' OR NOT m.won OR m.final_score <> 2500 OR m.prs <> 1 OR m.next_level <> 3 THEN
      RAISE EXCEPTION 'probe: settled % won % score % prs % next %', m.status, m.won, m.final_score, m.prs, m.next_level;
    END IF;

    -- The next ghost carries level 3: 8% above the new baseline.
    SELECT * INTO s FROM public.past_you_plan(a, 'gym', now() + interval '1 minute');
    IF s.level <> 3 OR s.target <> round(s.baseline * 1.08) THEN
      RAISE EXCEPTION 'probe: next plan level % target % baseline %', s.level, s.target, s.baseline;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'probe passed';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
END;
$$;
