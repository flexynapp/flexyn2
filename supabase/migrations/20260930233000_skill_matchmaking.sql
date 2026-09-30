-- Skill-based matchmaking for Gym Rival, Cardio Rival, Duels and Crew Wars.
--
-- Kegan, 2026-09-30: "good skill based match making also based on league",
-- "mainly however on how much they can lift, run, etc". So every contest now
-- matches first on the ability it actually measures, and league is only a
-- guardrail:
--
--   Gym Rival, Duels  Strength Score (league_strength.score, DOTS)
--   Cardio Rival      run pace over the last 28 days
--   Crew Wars         mean member Strength Score
--
-- Before this, gym_rival_roll took the closest of 200 arbitrary active users
-- with no limit (a Legend could draw a first-week beginner), weighted app
-- level (XP, i.e. time in the app) and a rough "best e1RM / bodyweight" from
-- any single lift. Duels had no matchmaking at all. Crew Wars matched on crew
-- season division and the same rough strength, with a tolerance that grew
-- without a ceiling.
--
-- Matching widens in four steps and stops. A pair that fits no step is never
-- matched; the caller gets nothing and the client offers Past You or an
-- invite instead. See docs in the proposal:
-- /mnt/project-files/flexyn/audits/matchmaking-proposal-2026-09-30.md
--
-- This file CONSUMES league_strength and user_profiles.league_tier; it never
-- writes them. The Leagues thread owns placement (including the provisional
-- placement from onboarding), and whatever it writes flows in here.

-- ---------------------------------------------------------------------------
-- 1. One skill profile per person per contest kind
-- ---------------------------------------------------------------------------

DROP TYPE IF EXISTS public.match_skill CASCADE;
CREATE TYPE public.match_skill AS (
  strength   numeric,  -- Strength Score; NULL = unrated
  league     integer,  -- league_tier_rank, 1 bronze .. 6 legend
  days_week  numeric,  -- distinct training days per week, last 28 days
  output     numeric,  -- weekly volume (lb) or weekly distance (m)
  pace       numeric,  -- seconds per km over recent runs; NULL = none
  age        numeric
);

-- Strength: the stored score when there is one. A league above Bronze with
-- no score is a placement made some other way (the provisional placement
-- from onboarding), so it stands in at that league's floor plus a margin.
CREATE OR REPLACE FUNCTION public.match_skill_for(p_uid uuid, p_kind text)
RETURNS public.match_skill
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  r      public.match_skill;
  v_tier text;
  v_run  record;
BEGIN
  SELECT p.league_tier, p.age INTO v_tier, r.age
    FROM public.user_profiles p WHERE p.id = p_uid;

  r.league := public.league_tier_rank(COALESCE(v_tier, 'bronze'));

  SELECT s.score INTO r.strength
    FROM public.league_strength s
   WHERE s.user_id = p_uid AND s.score > 0;
  IF r.strength IS NULL AND COALESCE(v_tier, 'bronze') <> 'bronze' THEN
    r.strength := public.league_tier_floor(v_tier) + 25;
  END IF;

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

-- ---------------------------------------------------------------------------
-- 2. The rules: which step a pair first fits, and how close it is
-- ---------------------------------------------------------------------------

-- Smallest step (1..4) at which A and B may be matched, or NULL for never.
--
-- Gym (Gym Rival, Duels):
--   step              1     2     3     4
--   strength within   10%   20%   35%   50%
--   days/week within  1     2     any   any
--   and never three or more leagues apart.
--   Both unrated: days/week alone decides. One unrated: only from step 3,
--   and only against a rated lifter still below the Silver floor, so a
--   blank profile never draws a strong lifter.
--
-- Cardio (Cardio Rival):
--   pace within       8%    15%   25%   40%   (when both have run pace)
--   distance ratio    1.5x  2x    3x    3x
--   days/week within  1     2     any   any
CREATE OR REPLACE FUNCTION public.match_pair_step(p_kind text, a public.match_skill, b public.match_skill)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_days numeric := ABS(a.days_week - b.days_week);
  v_s    numeric;
  v_p    numeric;
  v_d    numeric;
  v_step integer;
BEGIN
  IF p_kind = 'cardio' THEN
    -- Distance ratio, with a 500 m/week floor so two near-zero weeks compare as equal.
    v_d := GREATEST(a.output, b.output, 500) / GREATEST(LEAST(a.output, b.output), 500);
    IF a.pace IS NOT NULL AND b.pace IS NOT NULL THEN
      v_p := ABS(a.pace - b.pace) / GREATEST(a.pace, b.pace);
    END IF;
    FOR v_step IN 1..4 LOOP
      IF v_d <= (ARRAY[1.5, 2, 3, 3])[v_step]
         AND v_days <= (ARRAY[1, 2, 99, 99])[v_step]
         AND (v_p IS NULL OR v_p <= (ARRAY[0.08, 0.15, 0.25, 0.40])[v_step]) THEN
        RETURN v_step;
      END IF;
    END LOOP;
    RETURN NULL;
  END IF;

  IF ABS(COALESCE(a.league, 1) - COALESCE(b.league, 1)) >= 3 THEN
    RETURN NULL;
  END IF;

  IF a.strength IS NULL AND b.strength IS NULL THEN
    FOR v_step IN 1..4 LOOP
      IF v_days <= (ARRAY[1, 2, 99, 99])[v_step] THEN RETURN v_step; END IF;
    END LOOP;
  END IF;

  IF a.strength IS NULL OR b.strength IS NULL THEN
    IF COALESCE(a.strength, b.strength) < 150 THEN
      RETURN CASE WHEN v_days <= 2 THEN 3 ELSE 4 END;
    END IF;
    RETURN NULL;
  END IF;

  v_s := ABS(a.strength - b.strength) / GREATEST(a.strength, b.strength, 1);
  FOR v_step IN 1..4 LOOP
    IF v_s <= (ARRAY[0.10, 0.20, 0.35, 0.50])[v_step]
       AND v_days <= (ARRAY[1, 2, 99, 99])[v_step] THEN
      RETURN v_step;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$function$;

-- Closeness inside a step, 0 = identical .. 1 = far. Ability carries the
-- most weight; weekly output and days next; age only nudges. The result
-- lands on the same 0..1 scale matchQuality() in src/lib/data/gymRival.js
-- bands, so the Rival reveal keeps working.
CREATE OR REPLACE FUNCTION public.match_pair_gap(p_kind text, a public.match_skill, b public.match_skill)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH t AS (
    SELECT
      CASE WHEN p_kind = 'cardio'
           THEN CASE WHEN a.pace IS NOT NULL AND b.pace IS NOT NULL
                     THEN LEAST(1.0, (ABS(a.pace - b.pace) / GREATEST(a.pace, b.pace)) / 0.4) END
           ELSE CASE WHEN a.strength IS NOT NULL AND b.strength IS NOT NULL
                     THEN LEAST(1.0, (ABS(a.strength - b.strength) / GREATEST(a.strength, b.strength, 1)) / 0.5) END
      END AS ability,
      ABS(a.output - b.output) / GREATEST(a.output, b.output, 1) AS output,
      LEAST(1.0, ABS(a.days_week - b.days_week) / 4.0) AS days,
      CASE WHEN a.age IS NOT NULL AND b.age IS NOT NULL
           THEN LEAST(1.0, ABS(a.age - b.age) / 20.0) END AS age
  )
  SELECT (4.0 * COALESCE(ability, 0) + 1.5 * output + 1.5 * days + 0.5 * COALESCE(age, 0))
       / (CASE WHEN ability IS NULL THEN 0 ELSE 4.0 END + 3.0 + CASE WHEN age IS NULL THEN 0 ELSE 0.5 END)
    FROM t;
$function$;

REVOKE ALL ON FUNCTION public.match_skill_for(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.match_pair_step(text, public.match_skill, public.match_skill) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.match_pair_gap(text, public.match_skill, public.match_skill) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Rival: people waiting for a rival
-- ---------------------------------------------------------------------------

-- A roll that finds nobody leaves the caller "looking" for 48 hours. The next
-- person in their band who rolls is matched to them with their side already
-- accepted, so the week starts as soon as the roller confirms. No client
-- policy: only the definer functions touch it.
CREATE TABLE IF NOT EXISTS public.rival_seekers (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  rival_type text NOT NULL CHECK (rival_type IN ('gym', 'cardio')),
  expires_at timestamptz NOT NULL
);
ALTER TABLE public.rival_seekers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rival_seekers FROM anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. gym_rival_roll on the new rules
-- ---------------------------------------------------------------------------
-- Everything outside the choice of opponent is carried over from the
-- installed body (guest and Past You refusals, expire_stale, the 21-day
-- no-rematch pass, reassigning the caller's old rows, the notification).

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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid AND is_anonymous) THEN
    RAISE EXCEPTION 'guest_account' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.past_you_matches WHERE user_id = v_uid AND status = 'active') THEN
    RAISE EXCEPTION 'past_you_in_progress' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.gym_rival_expire_stale();
  DELETE FROM public.rival_seekers WHERE user_id = v_uid OR expires_at <= now();

  v_me := public.match_skill_for(v_uid, v_type);

  FOR v_pass IN 1..2 LOOP
    EXIT WHEN v_rival IS NOT NULL;
    FOR v_cand, v_seeker IN
      SELECT p.id, (sk.user_id IS NOT NULL AND sk.rival_type = v_type)
        FROM public.user_profiles p
        LEFT JOIN public.league_strength ls ON ls.user_id = p.id AND ls.score > 0
        LEFT JOIN public.rival_seekers sk ON sk.user_id = p.id
       WHERE p.id <> v_uid
         AND COALESCE(p.nemesis_opt_out, FALSE) = FALSE
         AND p.username IS NOT NULL
         AND p.last_active_at IS NOT NULL
         AND p.last_active_at >= now() - interval '7 days'
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
       -- then (for lifting) the nearest Strength Scores.
       ORDER BY (sk.user_id IS NOT NULL AND sk.rival_type = v_type) DESC,
                CASE WHEN v_type = 'gym' AND v_me.strength IS NOT NULL
                     THEN ABS(COALESCE(ls.score, 0) - v_me.strength) END NULLS LAST,
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

-- Starting Past You ends the wait for a human (Past You and a human rival
-- are one-at-a-time). The roll already skips people racing Past You; this
-- keeps the table honest.
CREATE OR REPLACE FUNCTION public.rival_seekers_clear_on_past_you()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NEW.status = 'active' THEN
    DELETE FROM public.rival_seekers WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.rival_seekers_clear_on_past_you() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rival_seekers_clear_on_past_you ON public.past_you_matches;
CREATE TRIGGER trg_rival_seekers_clear_on_past_you
  AFTER INSERT ON public.past_you_matches
  FOR EACH ROW EXECUTE FUNCTION public.rival_seekers_clear_on_past_you();

-- ---------------------------------------------------------------------------
-- 5. Duels: opponents close to your strength
-- ---------------------------------------------------------------------------
-- Same visibility rules as duel_opponent_candidates (no guests, no blocked,
-- nobody hidden from search) plus: active in the last 7 days, and private
-- profiles are left out entirely because a suggestion list is not a search.
-- Returns the same columns so the Create Duel list renders it unchanged,
-- plus the step, for the "close match" label.
CREATE OR REPLACE FUNCTION public.duel_matched_opponents()
RETURNS TABLE (id uuid, username text, display_name text, avatar_url text,
               current_level integer, session_ok boolean, league_tier text, match_step integer)
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
            LEFT JOIN public.league_strength ls ON ls.user_id = p.id AND ls.score > 0
           WHERE p.id <> v_uid
             AND p.username IS NOT NULL
             AND NOT COALESCE(u.is_anonymous, FALSE) AND u.email IS NOT NULL
             AND NOT COALESCE(p.hide_from_search, FALSE)
             AND NOT COALESCE(p.is_private, FALSE)
             AND p.last_active_at >= now() - interval '7 days'
             AND NOT public.is_blocked(v_uid, p.email)
           ORDER BY CASE WHEN v_me.strength IS NOT NULL
                         THEN ABS(COALESCE(ls.score, 0) - v_me.strength) END NULLS LAST,
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

-- ---------------------------------------------------------------------------
-- 6. Crew Wars: mean member Strength Score first
-- ---------------------------------------------------------------------------

-- Mean Strength Score of the crew's rated members (same source as the
-- league), replacing the old mean of "best e1RM / bodyweight". NULL when no
-- member is rated. Relative differences are all crew_match_gap reads, so the
-- change of scale is safe; queued rows are recomputed below.
CREATE OR REPLACE FUNCTION public.crew_match_strength(p_crew_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT AVG((public.match_skill_for(m.user_id, 'gym')).strength)
    FROM (SELECT user_id FROM public.crew_members WHERE crew_id = p_crew_id LIMIT 40) m;
$function$;

-- Mean member league (1..6), rounded. Replaces crew season division in the
-- match_division snapshot: it is a guardrail now, not the main key.
CREATE OR REPLACE FUNCTION public.crew_match_league(p_crew_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT COALESCE(ROUND(AVG(public.league_tier_rank(COALESCE(p.league_tier, 'bronze'))))::integer, 1)
    FROM (SELECT user_id FROM public.crew_members WHERE crew_id = p_crew_id LIMIT 40) m
    JOIN public.user_profiles p ON p.id = m.user_id;
$function$;
REVOKE ALL ON FUNCTION public.crew_match_strength(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crew_match_league(uuid) FROM PUBLIC, anon, authenticated;

-- Weights re-balanced so strength leads: strength 3.0 (0.75 when the
-- smaller crew is the stronger one, the existing handicap logic), league
-- 1.0 (was division 3.0), roster 1.2, cadence 1.5, age 1.0. Signature and
-- the ::numeric on the roster term are unchanged.
CREATE OR REPLACE FUNCTION public.crew_match_gap(p_roster_a integer, p_age_a numeric, p_str_a numeric, p_cad_a numeric, p_div_a integer, p_roster_b integer, p_age_b numeric, p_str_b numeric, p_cad_b numeric, p_div_b integer)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  WITH t AS (
    SELECT
      (p_roster_a IS NOT NULL AND p_roster_b IS NOT NULL
        AND NOT (COALESCE(p_roster_a,0) = COALESCE(p_roster_b,0))) AS sizes_differ,
      CASE WHEN COALESCE(p_roster_a,0) = LEAST(COALESCE(p_roster_a,0), COALESCE(p_roster_b,0))
           THEN p_str_a ELSE p_str_b END AS str_small,
      CASE WHEN COALESCE(p_roster_a,0) = LEAST(COALESCE(p_roster_a,0), COALESCE(p_roster_b,0))
           THEN p_str_b ELSE p_str_a END AS str_big
  ), adv AS (
    SELECT CASE
      WHEN sizes_differ AND str_small IS NOT NULL AND str_big IS NOT NULL
      THEN GREATEST(0.0, LEAST(1.0, (str_small - str_big) / GREATEST(str_big, 0.01)))
      ELSE 0.0 END AS advantage
    FROM t
  ), w AS (
    SELECT advantage,
           CASE WHEN advantage > 0 THEN 0.75 ELSE 3.0 END AS str_weight
    FROM adv
  )
  SELECT (
      1.0 * LEAST(1.0, ABS(COALESCE(p_div_a, 1) - COALESCE(p_div_b, 1)) / 3.0)
    + 1.2 * (ABS(COALESCE(p_roster_a, 0) - COALESCE(p_roster_b, 0))::numeric
             / GREATEST(COALESCE(p_roster_a, 0), COALESCE(p_roster_b, 0), 1))
          * (1.0 - 0.75 * advantage)
    + 1.5 * LEAST(1.0, ABS(COALESCE(p_cad_a, 0) - COALESCE(p_cad_b, 0)) / 4.0)
    + CASE WHEN p_str_a IS NOT NULL AND p_str_b IS NOT NULL
           THEN str_weight * (ABS(p_str_a - p_str_b) / GREATEST(p_str_a, p_str_b, 1))
           ELSE 0.0 END
    + CASE WHEN p_age_a IS NOT NULL AND p_age_b IS NOT NULL
           THEN 1.0 * LEAST(1.0, ABS(p_age_a - p_age_b) / 20.0)
           ELSE 0.0 END
  ) / (
      3.7
    + CASE WHEN p_str_a IS NOT NULL AND p_str_b IS NOT NULL THEN str_weight ELSE 0.0 END
    + CASE WHEN p_age_a IS NOT NULL AND p_age_b IS NOT NULL THEN 1.0 ELSE 0.0 END
  )
  FROM w;
$function$;

-- The queue on the new snapshot, with a hard stop: crews two or more leagues
-- apart on average, or whose mean Strength Scores differ by more than half,
-- are never paired however long they have waited. Everything else is the
-- installed body.
CREATE OR REPLACE FUNCTION public.join_crew_war_queue(p_crew_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_rank      integer;
  v_members   integer;
  v_existing  uuid;
  v_opponent  uuid;
  v_my_div    integer;
  v_my_age    numeric;
  v_my_str    numeric;
  v_my_cad    numeric;
  v_claimed   integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_crew_id IS NULL THEN
    RAISE EXCEPTION 'crew_id required' USING ERRCODE = '22023';
  END IF;

  v_rank := public.crew_rank(p_crew_id, v_uid);

  IF NOT (v_rank = 3) THEN
    RAISE EXCEPTION 'only a crew leader can enter matchmaking'
      USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_members FROM public.crew_members WHERE crew_id = p_crew_id;
  IF v_members = LEAST(v_members, 1) THEN
    RAISE EXCEPTION 'crew needs at least two members to battle' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_existing
    FROM public.crew_wars
   WHERE status IN ('matchmaking', 'active')
     AND (crew_a_id = p_crew_id OR crew_b_id = p_crew_id)
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', TRUE, 'status', 'already_queued', 'war_id', v_existing);
  END IF;

  PERFORM public.ensure_crew_season_entry(p_crew_id);

  v_my_div := public.crew_match_league(p_crew_id);
  v_my_age := public.crew_match_age(p_crew_id);
  v_my_str := public.crew_match_strength(p_crew_id);
  v_my_cad := public.crew_match_cadence(p_crew_id);

  FOR v_opponent IN
    SELECT w_id FROM (
      SELECT id AS w_id, created_at AS w_since, match_division AS w_div, match_strength AS w_str,
        public.crew_match_gap(
          v_members, v_my_age, v_my_str, v_my_cad, v_my_div,
          match_roster, match_age, match_strength, match_cadence, match_division
        ) AS w_gap,
        FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 43200) AS w_patience
      FROM public.crew_wars
      WHERE crew_b_id IS NULL AND status = 'matchmaking'
        AND NOT (crew_a_id = p_crew_id)
      LIMIT 50
    ) AS candidates
    WHERE w_gap = LEAST(w_gap, 0.15 + 0.15 * w_patience)
      AND ABS(COALESCE(w_div, 1) - v_my_div) < 2
      AND (w_str IS NULL OR v_my_str IS NULL
           OR ABS(w_str - v_my_str) / GREATEST(w_str, v_my_str, 1) <= 0.5)
    ORDER BY w_gap, w_since
    LIMIT 5
  LOOP
    UPDATE public.crew_wars
       SET crew_b_id = p_crew_id, status = 'active', starts_at = now(),
           ends_at = now() + INTERVAL '7 days', crew_a_score = 0, crew_b_score = 0
     WHERE id = v_opponent AND crew_b_id IS NULL AND status = 'matchmaking';

    GET DIAGNOSTICS v_claimed = ROW_COUNT;

    IF v_claimed = 1 THEN
      PERFORM public.notify_crew_war_started_for(v_opponent);
      RETURN jsonb_build_object('ok', TRUE, 'status', 'matched', 'war_id', v_opponent);
    END IF;
  END LOOP;

  INSERT INTO public.crew_wars
    (crew_a_id, crew_b_id, status,
     match_roster, match_age, match_strength, match_cadence, match_division)
  VALUES
    (p_crew_id, NULL, 'matchmaking',
     v_members, v_my_age, v_my_str, v_my_cad, v_my_div)
  RETURNING id INTO v_existing;

  RETURN jsonb_build_object('ok', TRUE, 'status', 'queued', 'war_id', v_existing);
END;
$function$;

-- Crews already waiting carry the old-scale snapshot; restate it.
UPDATE public.crew_wars
   SET match_strength = public.crew_match_strength(crew_a_id),
       match_division = public.crew_match_league(crew_a_id)
 WHERE status = 'matchmaking' AND crew_b_id IS NULL;

-- ---------------------------------------------------------------------------
-- 7. Probe: attempt the rules, both directions
-- ---------------------------------------------------------------------------
DO $probe$
DECLARE
  beg  public.match_skill := ROW(NULL, 1, 1, 2000, NULL, 25)::public.match_skill;
  beg2 public.match_skill := ROW(NULL, 1, 2, 3000, NULL, 30)::public.match_skill;
  s200 public.match_skill := ROW(200, 2, 3, 20000, NULL, 30)::public.match_skill;
  s210 public.match_skill := ROW(210, 2, 3, 22000, NULL, 28)::public.match_skill;
  s260 public.match_skill := ROW(260, 3, 4, 30000, NULL, 30)::public.match_skill;
  s480 public.match_skill := ROW(480, 6, 5, 60000, NULL, 30)::public.match_skill;
  s120 public.match_skill := ROW(120, 1, 2, 8000, NULL, 30)::public.match_skill;
  r300 public.match_skill := ROW(NULL, 1, 3, 20000, 300, 30)::public.match_skill;
  r310 public.match_skill := ROW(NULL, 1, 3, 22000, 310, 30)::public.match_skill;
  r520 public.match_skill := ROW(NULL, 1, 3, 20000, 520, 30)::public.match_skill;
  rbig public.match_skill := ROW(NULL, 1, 3, 90000, NULL, 30)::public.match_skill;
BEGIN
  ASSERT public.match_pair_step('gym', s200, s210) = 1, 'close lifters match at step 1';
  ASSERT public.match_pair_step('gym', s200, s260) = 3, '200 vs 260 widens to step 3';
  ASSERT public.match_pair_step('gym', s200, s480) IS NULL, 'Silver never meets Legend';
  ASSERT public.match_pair_step('gym', beg, beg2) = 1, 'two unrated match on days';
  ASSERT public.match_pair_step('gym', beg, s200) IS NULL, 'unrated never draws a 200';
  ASSERT public.match_pair_step('gym', beg, s120) = 3, 'unrated may meet a sub-Silver lifter late';
  ASSERT public.match_pair_step('cardio', r300, r310) = 1, 'close pace matches';
  ASSERT public.match_pair_step('cardio', r300, r520) IS NULL, '5:00 vs 8:40 per km never';
  ASSERT public.match_pair_step('cardio', r300, rbig) IS NULL, '4.5x the distance never';
  ASSERT public.match_pair_gap('gym', s200, s210) < public.match_pair_gap('gym', s200, s260), 'gap orders by closeness';
  ASSERT public.match_pair_gap('gym', s200, s200) = 0, 'identical is 0';
  ASSERT public.crew_match_gap(5, 30, 200, 3, 3, 5, 30, 400, 3, 3)
       > public.crew_match_gap(5, 30, 200, 3, 3, 5, 30, 200, 3, 4), 'crew strength outweighs one league';
END;
$probe$;
