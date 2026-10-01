-- Matchmaking audit fixes (follows 20261001030000_skill_matchmaking).
--
-- An audit of the live matchmaking on 2026-10-01 found five defects. Each
-- section below says what it was and what changes for users.
--
--   1. Gym/Cardio Rival could pair you with someone who blocked you, or whom
--      you blocked. Since the skill migration a waiting player is matched
--      PRE-ACCEPTED and notified "Found you a Gym Rival: @x", so a blocked
--      person could be pushed straight at the person who blocked them. The
--      Duels list already excluded blocks; the roll did not.
--   2. Rival could auto-assign a private profile. Duels already skipped
--      private profiles; the roll now does too.
--   3. Players placed from onboarding (a league but no Strength Score yet)
--      were ranked as strength 0 when picking which 300 (Rival) or 200
--      (Duels) candidates to look at. The matching itself used their
--      mid-band stand-in, but in a big pool a provisional Gold could be cut
--      before ever being compared. The pre-filter now uses the same
--      stand-in as the matching, from one helper.
--   4. A waiting player matched pre-accepted lost their place silently when
--      the other side rerolled or declined: the match went to 'reassigned'
--      and they were neither told nor put back in the queue. They are now
--      re-queued for 48 hours and told they are still first in line.
--   5. Two rolls at the same moment could both pick the same waiting player
--      and create two pending matches for one person. Rolls now take a
--      transaction lock so they run one at a time.

-- ---------------------------------------------------------------------------
-- 1. One stand-in rule for unscored placements
-- ---------------------------------------------------------------------------
-- A real score wins. With none, a placed player (or anyone above Bronze)
-- stands in at the middle of their league's band. An unplaced Bronze stays
-- unrated (NULL). This is the rule match_skill_for already applied; it now
-- lives here so the pre-filters cannot drift from it.
CREATE OR REPLACE FUNCTION public.match_strength_stand_in(p_score numeric, p_placed boolean, p_tier text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT CASE
    WHEN p_score > 0 THEN p_score
    WHEN COALESCE(p_placed, FALSE) OR COALESCE(p_tier, 'bronze') <> 'bronze' THEN
      CASE COALESCE(p_tier, 'bronze')
        WHEN 'silver' THEN 200 WHEN 'gold' THEN 287 WHEN 'platinum' THEN 362
        WHEN 'diamond' THEN 437 WHEN 'legend' THEN 500 ELSE 100 END
  END::numeric;
$function$;
REVOKE ALL ON FUNCTION public.match_strength_stand_in(numeric, boolean, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.match_skill_for(p_uid uuid, p_kind text)
 RETURNS match_skill
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  r        public.match_skill;
  v_tier   text;
  v_score  numeric;
  v_placed boolean;
  v_run    record;
BEGIN
  SELECT p.league_tier, p.age INTO v_tier, r.age
    FROM public.user_profiles p WHERE p.id = p_uid;

  r.league := public.league_tier_rank(COALESCE(v_tier, 'bronze'));

  SELECT s.score, s.placed_at IS NOT NULL
    INTO v_score, v_placed
    FROM public.league_strength s
   WHERE s.user_id = p_uid;
  r.strength := public.match_strength_stand_in(v_score, v_placed, v_tier);

  IF p_kind = 'cardio' THEN
    r.output := public.gym_rival_cardio_meters(p_uid, now() - interval '28 days', NULL) / 4.0;
    SELECT COUNT(DISTINCT c.date)::numeric / 4.0 INTO r.days_week
      FROM public.cardio_logs c
     WHERE c.user_id = p_uid AND c.date >= (now() - interval '28 days')::date
       AND public.cardio_log_is_plausible(COALESCE(c.type, c.activity_type), c.distance_meters, c.duration_seconds);
    -- Pace from timed runs of at least 1 km only: walking, cycling and
    -- swimming paces are not comparable to each other or to running.
    SELECT SUM(c.duration_seconds)::numeric AS secs, SUM(c.distance_meters) AS m INTO v_run
      FROM public.cardio_logs c
     WHERE c.user_id = p_uid AND c.date >= (now() - interval '28 days')::date
       AND COALESCE(c.type, c.activity_type) LIKE 'running%'
       AND c.distance_meters >= 1000 AND c.duration_seconds > 0
       AND public.cardio_log_is_plausible(COALESCE(c.type, c.activity_type), c.distance_meters, c.duration_seconds);
    IF v_run.m IS NOT NULL AND v_run.m > 0 THEN
      r.pace := v_run.secs / (v_run.m / 1000.0);
    END IF;
  ELSE
    r.output := public.gym_rival_volume_lbs(p_uid, now() - interval '28 days', NULL) / 4.0;
    SELECT COUNT(DISTINCT w.created_at::date)::numeric / 4.0 INTO r.days_week
      FROM public.workout_logs w
     WHERE w.user_id = p_uid AND w.created_at >= now() - interval '28 days'
       AND NOT COALESCE(w.implausible, FALSE);
  END IF;

  r.output    := COALESCE(r.output, 0);
  r.days_week := COALESCE(r.days_week, 0);
  RETURN r;
END;
$function$;
REVOKE ALL ON FUNCTION public.match_skill_for(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Putting a pre-accepted player back in the queue
-- ---------------------------------------------------------------------------
-- Internal. Called when a match someone had already accepted is undone by
-- the other side before it starts. They go back to the front of the queue
-- for 48 hours and are told so, rather than finding the match gone.
CREATE OR REPLACE FUNCTION public.gym_rival_requeue_internal(p_uid uuid, p_type text, p_by uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_type text := CASE WHEN p_type = 'cardio' THEN 'cardio' ELSE 'gym' END;
  v_name text;
BEGIN
  IF p_uid IS NULL THEN RETURN; END IF;
  -- Racing Past You means they are not waiting for a human any more.
  IF EXISTS (SELECT 1 FROM public.past_you_matches WHERE user_id = p_uid AND status = 'active') THEN
    RETURN;
  END IF;

  INSERT INTO public.rival_seekers (user_id, rival_type, expires_at)
  VALUES (p_uid, v_type, now() + interval '48 hours')
  ON CONFLICT (user_id) DO UPDATE SET rival_type = EXCLUDED.rival_type, expires_at = EXCLUDED.expires_at;

  SELECT username INTO v_name FROM public.user_profiles WHERE id = p_by;
  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  SELECT p_uid, email, 'nemesis_assigned',
    '@' || COALESCE(v_name, 'Your rival') || ' backed out',
    'You''re still first in line for the next close match.',
    '🎯', '/workout',
    jsonb_build_object('result', 'requeued', 'rival_type', v_type)
  FROM auth.users WHERE id = p_uid AND email IS NOT NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.gym_rival_requeue_internal(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. gym_rival_roll: lock, blocks, private profiles, stand-in, re-queue
-- ---------------------------------------------------------------------------
-- Copied from the installed body (pg_get_functiondef, 2026-10-01); the
-- changes are the advisory lock, the two exclusions, the stand-in ordering
-- and the re-queue loop before the old match is reassigned.
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
  DELETE FROM public.rival_seekers WHERE user_id = v_uid OR expires_at <= now();

  v_me := public.match_skill_for(v_uid, v_type);

  FOR v_pass IN 1..2 LOOP
    EXIT WHEN v_rival IS NOT NULL;
    FOR v_cand, v_seeker IN
      SELECT p.id, (sk.user_id IS NOT NULL AND sk.rival_type = v_type)
        FROM public.user_profiles p
        LEFT JOIN public.league_strength ls ON ls.user_id = p.id
        LEFT JOIN public.rival_seekers sk ON sk.user_id = p.id
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

-- ---------------------------------------------------------------------------
-- 4. gym_rival_decline: re-queue the side that had already accepted
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gym_rival_decline(p_assignment_id uuid)
 RETURNS SETOF gym_rival_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid(); v_owner UUID; v_rival UUID; v_status TEXT; v_other UUID; v_name TEXT;
  v_type TEXT; v_other_ok BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  SELECT user_id, rival_id, status, rival_type,
         CASE WHEN v_uid = user_id THEN COALESCE(rival_confirmed, FALSE)
              ELSE COALESCE(initiator_confirmed, FALSE) END
    INTO v_owner, v_rival, v_status, v_type, v_other_ok
    FROM public.gym_rival_assignments WHERE id = p_assignment_id FOR UPDATE;

  IF v_owner IS NULL THEN RAISE EXCEPTION 'match_not_found' USING ERRCODE = '22023'; END IF;
  IF v_uid <> v_owner AND v_uid <> v_rival THEN RAISE EXCEPTION 'not_part_of_match' USING ERRCODE = '42501'; END IF;

  -- Locked once live — you can only bail before both accept.
  IF v_status <> 'pending' THEN
    RETURN QUERY SELECT * FROM public.gym_rival_assignments WHERE id = p_assignment_id;
    RETURN;
  END IF;

  UPDATE public.gym_rival_assignments SET status = 'reassigned' WHERE id = p_assignment_id;

  v_other := CASE WHEN v_uid = v_owner THEN v_rival ELSE v_owner END;

  IF v_other_ok THEN
    -- They had already said yes: back to the front of the queue, and the
    -- re-queue notice replaces the plain "declined" one.
    PERFORM public.gym_rival_requeue_internal(v_other, v_type, v_uid);
  ELSE
    SELECT username INTO v_name FROM public.user_profiles WHERE id = v_uid;
    INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
    SELECT v_other, email, 'nemesis_assigned',
      '@' || COALESCE(v_name, 'Your rival') || ' declined the challenge',
      'They backed out before the match started. Roll a new rival when you''re ready.',
      '🎯', '/workout',
      jsonb_build_object('assignment_id', p_assignment_id, 'result', 'declined')
    FROM auth.users WHERE id = v_other;
  END IF;

  RETURN QUERY SELECT * FROM public.gym_rival_assignments WHERE id = p_assignment_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. duel_matched_opponents: pre-filter on the stand-in too
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.duel_matched_opponents()
 RETURNS TABLE(id uuid, username text, display_name text, avatar_url text, current_level integer, session_ok boolean, league_tier text, match_step integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_me  public.match_skill;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  v_me := public.match_skill_for(v_uid, 'gym');

  RETURN QUERY
  SELECT r.id, r.username, r.display_name, r.avatar_url, r.current_level,
         public._duel_mirror_template(r.id) IS NOT NULL,
         r.league_tier, r.step
    FROM (
      SELECT c.*, public.match_pair_step('gym', v_me, c.skill) AS step,
             public.match_pair_gap('gym', v_me, c.skill) AS gap
        FROM (
          SELECT p.id, p.username, p.display_name, p.avatar_url, p.current_level, p.league_tier,
                 public.match_skill_for(p.id, 'gym') AS skill
            FROM public.user_profiles p
            JOIN auth.users u ON u.id = p.id
            LEFT JOIN public.league_strength ls ON ls.user_id = p.id
           WHERE p.id <> v_uid
             AND p.username IS NOT NULL
             AND NOT COALESCE(u.is_anonymous, FALSE) AND u.email IS NOT NULL
             AND NOT COALESCE(p.hide_from_search, FALSE)
             AND NOT COALESCE(p.is_private, FALSE)
             AND p.last_active_at >= now() - interval '7 days'
             AND NOT public.is_blocked(v_uid, p.email)
           ORDER BY CASE WHEN v_me.strength IS NOT NULL
                         THEN ABS(COALESCE(public.match_strength_stand_in(ls.score, ls.placed_at IS NOT NULL, p.league_tier), 0)
                                  - v_me.strength) END NULLS LAST,
                    p.last_active_at DESC
           LIMIT 200
        ) c
    ) r
   WHERE r.step IS NOT NULL
   ORDER BY r.step, r.gap, r.username
   LIMIT 8;
END;
$function$;
REVOKE ALL ON FUNCTION public.duel_matched_opponents() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duel_matched_opponents() TO authenticated;

REVOKE ALL ON FUNCTION public.gym_rival_roll(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gym_rival_roll(text) TO authenticated;
REVOKE ALL ON FUNCTION public.gym_rival_decline(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gym_rival_decline(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Probe
-- ---------------------------------------------------------------------------
DO $probe$
BEGIN
  ASSERT public.match_strength_stand_in(312, TRUE, 'gold') = 312, 'a real score wins';
  ASSERT public.match_strength_stand_in(NULL, TRUE, 'gold') = 287, 'placed gold, no lifts: mid band';
  ASSERT public.match_strength_stand_in(0, TRUE, 'silver') = 200, 'a zero score is not a score';
  ASSERT public.match_strength_stand_in(NULL, TRUE, 'bronze') = 100, 'placed bronze stands in at 100';
  ASSERT public.match_strength_stand_in(NULL, FALSE, 'silver') = 200, 'above bronze stands in even unplaced';
  ASSERT public.match_strength_stand_in(NULL, FALSE, 'bronze') IS NULL, 'unplaced bronze stays unrated';
  ASSERT public.match_strength_stand_in(NULL, NULL, NULL) IS NULL, 'no row at all stays unrated';
END;
$probe$;
