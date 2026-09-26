-- 361_implausible_excluded_from_xp_and_gym_boards.sql
--
-- 360 flagged implausible logs and stopped them winning a crew war.
-- This extends the flag to the credited-volume path and the gym boards.
--
-- THE LINE, AND WHY IT IS NOT "FILTER EVERYWHERE"
--
-- 24 functions read `public.workout_logs`. They are not one kind of read
-- and must not get one kind of treatment:
--
--   COMPETITIVE OR CREDITED — the row is ranked against other people, or
--   converted into a balance. A forged row here takes something from
--   somebody else. These filter. That is this migration.
--
--   PERSONAL HISTORY — the row is shown back to the person who wrote it.
--   `generate_weekly_review_for` is the clearest case: hiding a session
--   from someone's own weekly review makes the app lie to them about
--   their own week, and if the flag is a false positive (a strong lifter
--   with a blank profile — weight_lbs is set on 27 of 60) it deletes real
--   history from the only place they would notice. These do NOT filter.
--
-- What changes here:
--
--   reconcile_my_workout_volume        credits user_profiles.total_volume_lbs
--   get_gym_consistency_leaderboard    ranks gym members against each other
--   get_gym_community_progress         the gym's "lbs moved" and active days
--   get_gym_public_preview             the public map-pin figures
--   get_gym_vs_gym_leaderboard         gym against gym
--   league_active_days                 drives league qualification and rank
--
-- NOT changed, deliberately, and each one is a real remaining surface —
-- see the note at the foot of this file rather than assuming they were
-- missed.
--
-- Every body below is the INSTALLED definition with one predicate added.
-- They were read with pg_get_functiondef rather than reconstructed from
-- the migration that created them, because a later migration redefining a
-- function from a stale template is how push notifications sat dead for
-- months (see the head of CLAUDE.md).
--
-- `NOT COALESCE(implausible, FALSE)` and never `implausible = FALSE`: a
-- row that somehow escaped 360's backfill is NULL, and NULL has to read
-- as "fine". Excluding unknown rows from a leaderboard would be a far
-- worse bug than including one bad one.
--
-- Paste-safe per repo convention.

-- ── Credited volume ──────────────────────────────────────────────────
--
-- The SELECT and the UPDATE carry the SAME predicate on purpose. Filter
-- only the sum and a flagged row is stamped `volume_credited_at` while
-- contributing nothing — silently spent, and uncreditable forever if the
-- flag were ever cleared. Filtering both leaves it untouched, and the
-- seven-day window means it drops out of the scan on its own rather than
-- being rescanned indefinitely.

CREATE OR REPLACE FUNCTION public.reconcile_my_workout_volume()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $reconcile_my_workout_volume$
DECLARE
  v_uid         UUID := auth.uid();
  v_total_delta NUMERIC := 0;
  v_count       INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(COALESCE(total_volume, 0)), 0)::NUMERIC, COUNT(*)
    INTO v_total_delta, v_count
    FROM public.workout_logs
   WHERE user_id = v_uid
     AND volume_credited_at IS NULL
     AND COALESCE(total_volume, 0) > 0
     AND NOT COALESCE(implausible, FALSE)
     AND created_at > now() - INTERVAL '7 days';

  IF v_count = 0 THEN
    RETURN jsonb_build_object('reconciled', 0, 'delta', 0);
  END IF;

  PERFORM public.increment_user_volume(v_total_delta);

  UPDATE public.workout_logs
     SET volume_credited_at = now()
   WHERE user_id = v_uid
     AND volume_credited_at IS NULL
     AND COALESCE(total_volume, 0) > 0
     AND NOT COALESCE(implausible, FALSE)
     AND created_at > now() - INTERVAL '7 days';

  RETURN jsonb_build_object(
    'reconciled', v_count,
    'delta',      v_total_delta
  );
END;
$reconcile_my_workout_volume$;

-- ── Gym boards ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_gym_consistency_leaderboard(p_gym_id uuid, p_limit integer DEFAULT 50)
RETURNS TABLE(user_id uuid, username text, avatar_url text, value numeric, rank integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $get_gym_consistency_leaderboard$
#variable_conflict use_column
BEGIN
  IF NOT public.is_gym_member_or_owner(p_gym_id, auth.uid()) THEN
    RAISE EXCEPTION 'not a member' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    WITH members AS (
      SELECT user_id AS m_user_id, joined_at AS m_joined_at
        FROM public.gym_members WHERE gym_id = p_gym_id
    ),
    active AS (
      SELECT user_id AS a_user_id, COUNT(DISTINCT date) AS a_days
        FROM public.workout_logs
       WHERE date >= CURRENT_DATE - 6
         AND NOT COALESCE(implausible, FALSE)
         AND user_id IN (SELECT m_user_id FROM members)
       GROUP BY user_id
    ),
    ranked AS (
      SELECT id AS lb_user_id, username AS lb_username, avatar_url AS lb_avatar_url,
             m_joined_at AS lb_joined_at, COALESCE(a_days, 0)::NUMERIC AS lb_value
      FROM public.user_profiles
      JOIN members ON m_user_id = id
      LEFT JOIN active ON a_user_id = id
    )
    SELECT lb_user_id, lb_username, lb_avatar_url, lb_value,
           RANK() OVER (ORDER BY lb_value DESC)::INT
      FROM ranked
     ORDER BY lb_value DESC, lb_joined_at ASC, lb_user_id ASC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$get_gym_consistency_leaderboard$;

CREATE OR REPLACE FUNCTION public.get_gym_community_progress(p_gym_id uuid)
RETURNS TABLE(member_count bigint, active_members bigint, workout_count bigint, total_volume numeric, active_days bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $get_gym_community_progress$
#variable_conflict use_column
BEGIN
  IF NOT public.is_gym_member_or_owner(p_gym_id, auth.uid()) THEN
    RAISE EXCEPTION 'not a member' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    WITH members AS (
      SELECT user_id AS m_user_id
        FROM public.gym_members
       WHERE gym_id = p_gym_id
    ),
    logs AS (
      SELECT user_id       AS w_user_id,
             date          AS w_date,
             total_volume  AS w_volume
        FROM public.workout_logs
       WHERE date >= CURRENT_DATE - 6
         AND NOT COALESCE(implausible, FALSE)
         AND user_id IN (SELECT m_user_id FROM members)
    )
    SELECT
      (SELECT count(*) FROM members),
      (SELECT count(DISTINCT w_user_id) FROM logs),
      (SELECT count(*) FROM logs),
      (SELECT COALESCE(sum(w_volume), 0)::NUMERIC FROM logs),
      (SELECT count(DISTINCT (w_user_id, w_date)) FROM logs);
END;
$get_gym_community_progress$;

CREATE OR REPLACE FUNCTION public.get_gym_public_preview(p_gym_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $get_gym_public_preview$
DECLARE
  v_min_members CONSTANT INTEGER := 5;
  v_members  INTEGER;
  v_active   INTEGER;
  v_sessions INTEGER;
  v_days     INTEGER;
  v_shape    INTEGER[];
BEGIN
  IF p_gym_id IS NULL THEN
    RETURN jsonb_build_object('member_count', 0, 'meets_threshold', FALSE);
  END IF;

  SELECT count(*) INTO v_members
    FROM public.gym_members WHERE gym_id = p_gym_id;

  -- LEAST form rather than a bare angle bracket, per the clipboard rule.
  -- v_members = LEAST(v_members, 4) is exactly "fewer than five".
  IF v_members IS NULL OR v_members = LEAST(v_members, v_min_members - 1) THEN
    RETURN jsonb_build_object(
      'member_count', COALESCE(v_members, 0),
      'meets_threshold', FALSE);
  END IF;

  WITH members AS (
    SELECT user_id AS m_user_id
      FROM public.gym_members
     WHERE gym_id = p_gym_id
  ),
  logs AS (
    SELECT user_id AS w_user_id,
           date    AS w_date
      FROM public.workout_logs
     WHERE date >= CURRENT_DATE - 6
       AND NOT COALESCE(implausible, FALSE)
       AND user_id IN (SELECT m_user_id FROM members)
  ),
  per_person AS (
    SELECT count(DISTINCT w_date) AS d
      FROM logs
     GROUP BY w_user_id
     ORDER BY count(DISTINCT w_date) DESC
     LIMIT 8
  )
  SELECT
    (SELECT count(DISTINCT w_user_id) FROM logs),
    (SELECT count(*) FROM logs),
    (SELECT count(DISTINCT (w_user_id, w_date)) FROM logs),
    (SELECT array_agg(d) FROM per_person)
  INTO v_active, v_sessions, v_days, v_shape;

  RETURN jsonb_build_object(
    'member_count',    v_members,
    'meets_threshold', TRUE,
    'active_members',  COALESCE(v_active, 0),
    'session_count',   COALESCE(v_sessions, 0),
    'active_days',     COALESCE(v_days, 0),
    'streak_shape',    COALESCE(to_jsonb(v_shape), '[]'::jsonb));
END;
$get_gym_public_preview$;

CREATE OR REPLACE FUNCTION public.get_gym_vs_gym_leaderboard(p_limit integer DEFAULT 20)
RETURNS TABLE(rank bigint, gym_id uuid, gym_name text, logo_url text, city text, state_code text, member_count bigint, active_members bigint, workout_count bigint, score numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $get_gym_vs_gym_leaderboard$
#variable_conflict use_column
DECLARE
  v_min_members CONSTANT INTEGER := 5;
BEGIN
  RETURN QUERY
  WITH member_map AS (
    SELECT gym_id AS m_gym_id, user_id AS m_user_id
      FROM public.gym_members
  ),
  member_totals AS (
    SELECT m_gym_id AS t_gym_id, COUNT(*) AS t_members
      FROM member_map
     GROUP BY m_gym_id
  ),
  recent_workouts AS (
    SELECT user_id AS w_user_id
      FROM public.workout_logs
     WHERE date >= CURRENT_DATE - 7
       AND NOT COALESCE(implausible, FALSE)
  ),
  member_workouts AS (
    SELECT m_gym_id, m_user_id
      FROM member_map
      JOIN recent_workouts ON w_user_id = m_user_id
  ),
  workout_window AS (
    SELECT
      m_gym_id                  AS ww_gym_id,
      COUNT(*)                  AS ww_workout_count,
      COUNT(DISTINCT m_user_id) AS ww_active_members
    FROM member_workouts
    GROUP BY m_gym_id
  ),
  scored AS (
    SELECT
      id                                       AS s_gym_id,
      name                                     AS s_gym_name,
      logo_url                                 AS s_logo_url,
      city                                     AS s_city,
      state_code                               AS s_state_code,
      COALESCE(t_members, 0)::BIGINT           AS s_member_count,
      COALESCE(ww_active_members, 0)::BIGINT   AS s_active_members,
      COALESCE(ww_workout_count,  0)::BIGINT   AS s_workout_count,
      ROUND(
        COALESCE(ww_workout_count, 0) *
        LOG(COALESCE(ww_active_members, 0) + 1)::NUMERIC,
        2
      )                                        AS s_score
    FROM public.gym_businesses
    LEFT JOIN workout_window ON ww_gym_id = id
    LEFT JOIN member_totals  ON t_gym_id  = id
    WHERE is_active = TRUE
      AND COALESCE(ww_workout_count, 0) > 0
      AND COALESCE(t_members, 0) >= v_min_members
  )
  SELECT
    ROW_NUMBER() OVER (ORDER BY s_score DESC, s_workout_count DESC),
    s_gym_id,
    s_gym_name,
    s_logo_url,
    s_city,
    s_state_code,
    s_member_count,
    s_active_members,
    s_workout_count,
    s_score
  FROM scored
  ORDER BY s_score DESC, s_workout_count DESC
  LIMIT p_limit;
END;
$get_gym_vs_gym_leaderboard$;

-- ── League qualification ─────────────────────────────────────────────
--
-- Only the workout_logs half of the UNION is filtered. `cardio_logs` has
-- no plausibility model and therefore no flag — inventing one here would
-- be guessing at a different sport's ceilings. A day that is cardio-only
-- still counts, which is correct.

CREATE OR REPLACE FUNCTION public.league_active_days(p_user_id uuid, p_from date, p_to date)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $league_active_days$
DECLARE
  v_days INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_days FROM (
    SELECT date FROM public.workout_logs
     WHERE user_id = p_user_id
       AND date BETWEEN p_from AND p_to
       AND NOT COALESCE(implausible, FALSE)
    UNION
    SELECT date FROM public.cardio_logs
     WHERE user_id = p_user_id AND date BETWEEN p_from AND p_to
  ) AS trained_days;
  RETURN COALESCE(v_days, 0);
END;
$league_active_days$;

-- ── What is STILL unfiltered, and why it is listed rather than done ──
--
-- These read workout_logs and award something, so they are the same
-- defect class — but each takes a SPECIFIC `p_workout_log_id` and grants
-- against it, which needs an early guard rather than a WHERE clause, and
-- an award path that starts raising exceptions deserves its own change
-- and its own testing:
--
--   complete_bounty_claim(p_claim_id, p_workout_log_id)
--   complete_gauntlet_challenge(p_sequence_number, p_workout_log_id, p_score)
--   submit_duel_result_atomic(p_duel_id, p_result, p_workout_log_id)
--
-- Two more leaderboards were left for the same "not asked, one line, but
-- test it properly" reason: get_friend_leaderboard and
-- get_period_leaderboard.
--
-- Deliberately NOT filtered at all — personal history, not competition:
-- generate_weekly_review_for, dispatch_memory_reengagement,
-- get_crew_inactive_members, get_org_analytics, get_trophy_progress.
