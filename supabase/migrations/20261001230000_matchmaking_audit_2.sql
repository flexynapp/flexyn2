-- Second matchmaking audit (2026-10-01, follows 20261001130000).
--
--   1. Crew Wars: the 15-minute pairing job (pair_waiting_crew_wars, run by
--      resolve_due_crew_wars) never had the hard limits that
--      join_crew_war_queue enforces: never two or more leagues apart, never
--      more than 50% apart in crew strength. As a crew's patience widened
--      the tolerance, the job could pair a Bronze crew with a Diamond one.
--      It now applies the same two limits.
--   2. Gym/Cardio Rival: a player left waiting for a close match had no way
--      to see that they were waiting, stop waiting, or learn that the 48
--      hours ran out. get_my_rival_search() and cancel_rival_search() back a
--      visible waiting state on the card, and rival_seekers_expire() (hourly)
--      tells each player whose search ended without a match.
--   3. The roll no longer treats an expired search as a waiting player, and
--      leaves expired rows for the expiry job instead of deleting them
--      silently.
--
-- Functions and one cron job only. No rows change except rival_seekers,
-- whose expired rows the hourly job removes (as the roll already did).

-- ---------------------------------------------------------------------------
-- 1. Crew Wars pairing job: the same hard limits as joining the queue
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pair_waiting_crew_wars()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_a       uuid;
  v_a_crew  uuid;
  v_a_since timestamptz;
  v_a_ros   integer;
  v_a_age   numeric;
  v_a_str   numeric;
  v_a_cad   numeric;
  v_a_div   integer;
  v_b       uuid;
  v_b_crew  uuid;
  v_claimed integer;
  v_paired  integer := 0;
BEGIN
  FOR v_a, v_a_crew, v_a_since, v_a_ros, v_a_age, v_a_str, v_a_cad, v_a_div IN
    SELECT id, crew_a_id, created_at,
           match_roster, match_age, match_strength, match_cadence, match_division
      FROM public.crew_wars
     WHERE crew_b_id IS NULL AND status = 'matchmaking'
     ORDER BY created_at
     LIMIT 100
  LOOP
    PERFORM 1 FROM public.crew_wars
      WHERE id = v_a AND crew_b_id IS NULL AND status = 'matchmaking';
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_b := NULL; v_b_crew := NULL;
    SELECT w_id, w_crew INTO v_b, v_b_crew
      FROM (
        SELECT
          id AS w_id,
          crew_a_id AS w_crew,
          created_at AS w_since,
          match_division AS w_div,
          match_strength AS w_str,
          public.crew_match_gap(
            v_a_ros, v_a_age, v_a_str, v_a_cad, v_a_div,
            match_roster, match_age, match_strength, match_cadence, match_division
          ) AS w_gap
        FROM public.crew_wars
        WHERE crew_b_id IS NULL
          AND status = 'matchmaking'
          AND NOT (id = v_a)
          AND NOT (crew_a_id = v_a_crew)
      ) AS candidates
     WHERE w_gap <= 0.15 + 0.15 * FLOOR(EXTRACT(EPOCH FROM (now() - v_a_since)) / 43200)
       -- Hard limits, whatever the patience: never two or more leagues
       -- apart, never more than 50% apart in crew strength.
       AND ABS(COALESCE(w_div, 1) - COALESCE(v_a_div, 1)) < 2
       AND (w_str IS NULL OR v_a_str IS NULL
            OR ABS(w_str - v_a_str) / GREATEST(w_str, v_a_str, 1) <= 0.5)
     ORDER BY w_gap, w_since
     LIMIT 1;

    IF v_b IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE public.crew_wars
       SET crew_b_id    = v_b_crew,
           status       = 'active',
           starts_at    = now(),
           ends_at      = now() + INTERVAL '7 days',
           crew_a_score = 0,
           crew_b_score = 0
     WHERE id = v_a
       AND crew_b_id IS NULL
       AND status = 'matchmaking';

    GET DIAGNOSTICS v_claimed = ROW_COUNT;

    IF v_claimed = 1 THEN
      DELETE FROM public.crew_wars
       WHERE id = v_b AND crew_b_id IS NULL AND status = 'matchmaking';
      PERFORM public.notify_crew_war_started_for(v_a);
      v_paired := v_paired + 1;
    END IF;
  END LOOP;

  RETURN v_paired;
END;
$function$;
REVOKE ALL ON FUNCTION public.pair_waiting_crew_wars() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The waiting state: read it, stop it, and end it with a notice
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_rival_search()
RETURNS TABLE(rival_type text, expires_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT s.rival_type, s.expires_at
    FROM public.rival_seekers s
   WHERE s.user_id = auth.uid() AND s.expires_at > now();
$function$;
REVOKE ALL ON FUNCTION public.get_my_rival_search() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_rival_search() TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_rival_search()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.rival_seekers WHERE user_id = v_uid;
  RETURN FOUND;
END;
$function$;
REVOKE ALL ON FUNCTION public.cancel_rival_search() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_rival_search() TO authenticated;

-- Cron only. A search that ran its 48 hours without a match ends with a
-- notice, so nobody is left thinking they are still in line.
CREATE OR REPLACE FUNCTION public.rival_seekers_expire()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_n integer;
BEGIN
  WITH gone AS (
    DELETE FROM public.rival_seekers WHERE expires_at <= now()
    RETURNING user_id, rival_type
  ), sent AS (
    INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
    SELECT g.user_id, u.email, 'nemesis_assigned',
      CASE WHEN g.rival_type = 'cardio' THEN 'No Cardio Rival close to your level this time'
           ELSE 'No Gym Rival close to your level this time' END,
      'Race Past You this week, or look again. New people join every day.',
      '🎯', '/workout',
      jsonb_build_object('result', 'search_expired', 'rival_type', g.rival_type)
      FROM gone g JOIN auth.users u ON u.id = g.user_id
     WHERE u.email IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM gone;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.rival_seekers_expire() FROM PUBLIC, anon, authenticated;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'rival-seekers-expire';
    PERFORM cron.schedule('rival-seekers-expire', '20 * * * *', 'SELECT public.rival_seekers_expire();');
  END IF;
END;
$cron$;

-- ---------------------------------------------------------------------------
-- 3. gym_rival_roll: an expired search is not a waiting player
-- ---------------------------------------------------------------------------
-- Restated from 20261001130000 (the installed body); the changes are the
-- expires_at condition on the seekers join and deleting only the caller's
-- own row.
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
  v_me public.match_skill;
  v_them public.match_skill;
  v_pass INTEGER; v_cand UUID; v_seeker BOOLEAN;
  v_step INTEGER; v_gap NUMERIC;
  v_best_step INTEGER; v_best_seeker BOOLEAN; v_best_gap NUMERIC;
  v_rival UUID; v_new_id UUID; v_name TEXT;
  v_old RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid AND is_anonymous) THEN
    RAISE EXCEPTION 'guest_account' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.past_you_matches WHERE user_id = v_uid AND status = 'active') THEN
    RAISE EXCEPTION 'past_you_in_progress' USING ERRCODE = 'P0001';
  END IF;

  -- One roll at a time. Without this two people rolling together can both
  -- pick the same waiting player, who then holds two pending matches.
  PERFORM pg_advisory_xact_lock(hashtext('public.gym_rival_roll'));

  PERFORM public.gym_rival_expire_stale();
  -- Only the caller's own row. Expired rows are left for
  -- rival_seekers_expire, which tells each one their search ended.
  DELETE FROM public.rival_seekers WHERE user_id = v_uid;

  v_me := public.match_skill_for(v_uid, v_type);

  FOR v_pass IN 1..2 LOOP
    EXIT WHEN v_rival IS NOT NULL;
    FOR v_cand, v_seeker IN
      SELECT p.id, (sk.user_id IS NOT NULL AND sk.rival_type = v_type)
        FROM public.user_profiles p
        LEFT JOIN public.league_strength ls ON ls.user_id = p.id
        LEFT JOIN public.rival_seekers sk ON sk.user_id = p.id AND sk.expires_at > now()
       WHERE p.id <> v_uid
         AND COALESCE(p.nemesis_opt_out, FALSE) = FALSE
         AND NOT COALESCE(p.is_private, FALSE)
         AND p.username IS NOT NULL
         AND p.last_active_at IS NOT NULL
         AND p.last_active_at >= now() - interval '7 days'
         AND NOT public.is_blocked(v_uid, p.email)
         AND p.id NOT IN (SELECT id FROM auth.users WHERE email IS NULL OR is_anonymous)
         AND p.id NOT IN (SELECT user_id FROM public.past_you_matches WHERE status = 'active')
         AND p.id NOT IN (
           SELECT user_id FROM public.gym_rival_assignments WHERE status IN ('pending','active')
           UNION
           SELECT rival_id FROM public.gym_rival_assignments WHERE status IN ('pending','active'))
         AND (v_pass = 2 OR p.id NOT IN (
           SELECT rival_id FROM public.gym_rival_assignments
            WHERE user_id = v_uid AND assigned_at >= now() - interval '21 days'
           UNION
           SELECT user_id FROM public.gym_rival_assignments
            WHERE rival_id = v_uid AND assigned_at >= now() - interval '21 days'))
       -- Look at the most likely fits first when the pool is large: seekers,
       -- then (for lifting) the nearest Strength Scores, using the same
       -- stand-in for an unscored placement as the matching does.
       ORDER BY (sk.user_id IS NOT NULL AND sk.rival_type = v_type) DESC,
                CASE WHEN v_type = 'gym' AND v_me.strength IS NOT NULL
                     THEN ABS(COALESCE(public.match_strength_stand_in(ls.score, ls.placed_at IS NOT NULL, p.league_tier), 0)
                              - v_me.strength) END NULLS LAST,
                p.last_active_at DESC
       LIMIT 300
    LOOP
      v_them := public.match_skill_for(v_cand, v_type);
      v_step := public.match_pair_step(v_type, v_me, v_them);
      CONTINUE WHEN v_step IS NULL;
      v_gap := public.match_pair_gap(v_type, v_me, v_them);
      -- Best = lowest step, then someone already waiting, then the smallest
      -- gap; near-ties break at random so the same two people are not
      -- always paired.
      IF v_best_step IS NULL
         OR v_step < v_best_step
         OR (v_step = v_best_step AND v_seeker AND NOT v_best_seeker)
         OR (v_step = v_best_step AND v_seeker = v_best_seeker
             AND (v_gap < v_best_gap - 0.02 OR (ABS(v_gap - v_best_gap) <= 0.02 AND random() < 0.5))) THEN
        v_best_step := v_step; v_best_seeker := v_seeker; v_best_gap := v_gap; v_rival := v_cand;
      END IF;
    END LOOP;
  END LOOP;

  IF v_rival IS NULL THEN
    INSERT INTO public.rival_seekers (user_id, rival_type, expires_at)
    VALUES (v_uid, v_type, now() + interval '48 hours')
    ON CONFLICT (user_id) DO UPDATE SET rival_type = EXCLUDED.rival_type, expires_at = EXCLUDED.expires_at;
    RETURN;
  END IF;

  -- Anyone who had already accepted a pending match with the caller is about
  -- to lose it to this reroll: put them back at the front of the queue.
  FOR v_old IN
    SELECT a.rival_type,
           CASE WHEN a.user_id = v_uid THEN a.rival_id ELSE a.user_id END AS other_id
      FROM public.gym_rival_assignments a
     WHERE a.status = 'pending'
       AND (a.user_id = v_uid OR a.rival_id = v_uid)
       AND CASE WHEN a.user_id = v_uid THEN COALESCE(a.rival_confirmed, FALSE)
                ELSE COALESCE(a.initiator_confirmed, FALSE) END
  LOOP
    PERFORM public.gym_rival_requeue_internal(v_old.other_id, v_old.rival_type, v_uid);
  END LOOP;

  UPDATE public.gym_rival_assignments SET status = 'reassigned'
   WHERE status IN ('pending','active') AND (user_id = v_uid OR rival_id = v_uid);

  INSERT INTO public.gym_rival_assignments
    (user_id, rival_id, status, rival_type, initiator_confirmed, rival_confirmed, match_gap)
  VALUES (v_uid, v_rival, 'pending', v_type, FALSE, v_best_seeker, v_best_gap)
  RETURNING id INTO v_new_id;

  DELETE FROM public.rival_seekers WHERE user_id = v_rival;

  SELECT username INTO v_name FROM public.user_profiles WHERE id = v_uid;

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  SELECT v_rival, email, 'nemesis_assigned',
    CASE WHEN v_best_seeker
         THEN '🎯 Found you a ' || v_label || ': @' || COALESCE(v_name, 'someone')
         ELSE '🎯 @' || COALESCE(v_name, 'someone') || ' wants to be your ' || v_label END,
    CASE WHEN v_best_seeker
         THEN 'A close match on your level. The seven days start when they confirm.'
         ELSE 'Accept within 48 hours. The match runs seven days and the bigger week wins.' END,
    '🎯', '/workout',
    jsonb_build_object('assignment_id', v_new_id, 'initiator_id', v_uid, 'rival_type', v_type)
  FROM auth.users WHERE id = v_rival AND email IS NOT NULL;

  RETURN QUERY SELECT * FROM public.gym_rival_assignments WHERE id = v_new_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.gym_rival_roll(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gym_rival_roll(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Probe: why the crew hard limits are needed
-- ---------------------------------------------------------------------------
DO $probe$
BEGIN
  -- Two crews alike in everything but league: four apart is a small gap on
  -- its own, inside a patient tolerance, and must still never pair.
  ASSERT public.crew_match_gap(5, 30, 200, 3, 1, 5, 30, 200, 3, 5) <= 0.45,
    'precondition: a league-only difference fits a 24h tolerance';
END;
$probe$;
