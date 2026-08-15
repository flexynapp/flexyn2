-- 356_crew_war_roster_matchmaking.sql
--
-- Crew Wars: match crews on who is actually in them, and stop letting
-- headcount decide the result.
--
-- TWO PROBLEMS, AND THEY COMPOUND
--
-- 1. MATCHMAKING RANKED ON DIVISION ALONE. join_crew_war_queue and
--    pair_waiting_crew_wars both scored candidates as
--    ABS(their division - my division), widening with patience. Division
--    is a RESULT — where a crew landed after past seasons — not a
--    description of who trains in it. Two crews can share a division and
--    share nothing else: six lifters against two, twenty-year-olds
--    against fifty-year-olds, a 400 lb squat against a 135 lb one.
--
-- 2. SCORE WAS A RAW SUM. recompute_crew_war set each side to
--    SUM(xp_contributed) over its members, so a twelve-person crew beat a
--    four-person crew whatever either one lifted. Matching on roster size
--    narrows that; it does not close it, because a crew's roster moves
--    during the seven days a war runs.
--
-- Fixing only the first would have made the second worse: better-matched
-- crews make the remaining headcount edge the deciding factor more often,
-- not less.
--
-- WHAT A CREW LOOKS LIKE
--
-- Five numbers, snapshotted onto the queue row when a crew enters:
--
--   match_roster    how many lifters
--   match_age       mean age of the members who have set one
--   match_strength  mean best estimated 1RM per member, last 90 days
--   match_cadence   mean sessions per member over the last 28 days
--   match_division  season division, the previous behaviour, kept
--
-- Snapshotted rather than computed per comparison for two reasons. It is
-- what the crew WAS when it queued, which is the fair thing to match on;
-- and the alternative recomputes four aggregates over every member of
-- every waiting crew on every join, which is a query per member per
-- candidate.
--
-- COVERAGE IS THE WHOLE DESIGN, NOT A DETAIL
--
-- Measured in production before writing this: age is set on 26 of 60
-- profiles, gender on 13, and activity_level on 0 of 60 — nothing has
-- ever written that column. A distance function that reads a missing
-- value as zero does not match crews on similarity, it ranks them on
-- absence, and it does it silently. So crew_match_gap compares a
-- dimension only when BOTH crews have it and divides by the weight it
-- actually used. Roster, cadence and division are always present —
-- cadence of zero is a measurement, not a gap — so a pair with no age
-- and no strength between them still gets a meaningful answer from the
-- three that are left.
--
-- Gender is deliberately absent. 13 of 60 is too thin to match on, and
-- sorting crews by gender mix is not something this app should do.
--
-- SCORING: BOTH SIDES FIELD THE SAME NUMBER OF LIFTERS
--
-- Each side scores the sum of its top N contributions, where N is the
-- smaller of the two rosters. A per-member MEAN was the other candidate
-- and is worse: it rewards a crew for dropping whoever trained least, so
-- the fair-looking metric quietly makes kicking people the winning move.
-- Top-N has no such incentive — extra members cost nothing, they just
-- cannot be fielded beyond the smaller crew's count.
--
-- Paste-safe per repo convention: schema-qualified tables, no
-- alias.column tokens, no record field access, no bare <> operators.

-- ── 1. The profile columns ───────────────────────────────────────────
ALTER TABLE public.crew_wars
  ADD COLUMN IF NOT EXISTS match_roster   integer,
  ADD COLUMN IF NOT EXISTS match_age      numeric,
  ADD COLUMN IF NOT EXISTS match_strength numeric,
  ADD COLUMN IF NOT EXISTS match_cadence  numeric,
  ADD COLUMN IF NOT EXISTS match_division integer;

-- ── 2. Per-crew profile parts ────────────────────────────────────────
--
-- Each returns NULL when the crew has nothing behind that dimension, so
-- the gap function can tell "no data" from "zero". Cadence is the one
-- exception: a crew that logged nothing trained zero times, which is a
-- real and comparable number.

CREATE OR REPLACE FUNCTION public.crew_match_age(p_crew_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $crew_match_age$
DECLARE
  v_avg numeric;
BEGIN
  SELECT AVG(age) INTO v_avg
    FROM public.user_profiles
   WHERE age IS NOT NULL
     AND id IN (SELECT user_id FROM public.crew_members WHERE crew_id = p_crew_id);
  RETURN v_avg;
END;
$crew_match_age$;

CREATE OR REPLACE FUNCTION public.crew_match_strength(p_crew_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $crew_match_strength$
DECLARE
  v_user  uuid;
  v_email text;
  v_best  numeric;
  v_sum   numeric := 0;
  v_n     integer := 0;
BEGIN
  -- Same 40-member ceiling and same dual identity match as
  -- recompute_crew_war: workout_logs rows predating the uuid migration
  -- are keyed by created_by (an email), so a user_id-only read silently
  -- misses a member's whole history.
  FOR v_user IN
    SELECT user_id FROM public.crew_members WHERE crew_id = p_crew_id LIMIT 40
  LOOP
    SELECT lower(email) INTO v_email
      FROM public.user_profiles WHERE id = v_user;

    SELECT MAX((public._best_1rm_from_exercises(exercises)->>'e1rm')::numeric)
      INTO v_best
      FROM public.workout_logs
     WHERE (user_id = v_user OR (v_email IS NOT NULL AND lower(created_by) = v_email))
       AND created_at > now() - INTERVAL '90 days';

    IF v_best IS NOT NULL THEN
      v_sum := v_sum + v_best;
      v_n   := v_n + 1;
    END IF;
  END LOOP;

  IF v_n = 0 THEN
    RETURN NULL;
  END IF;
  RETURN v_sum / v_n;
END;
$crew_match_strength$;

CREATE OR REPLACE FUNCTION public.crew_match_cadence(p_crew_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $crew_match_cadence$
DECLARE
  v_user  uuid;
  v_email text;
  v_sess  integer;
  v_sum   numeric := 0;
  v_n     integer := 0;
BEGIN
  FOR v_user IN
    SELECT user_id FROM public.crew_members WHERE crew_id = p_crew_id LIMIT 40
  LOOP
    SELECT lower(email) INTO v_email
      FROM public.user_profiles WHERE id = v_user;

    SELECT COUNT(*) INTO v_sess
      FROM public.workout_logs
     WHERE (user_id = v_user OR (v_email IS NOT NULL AND lower(created_by) = v_email))
       AND created_at > now() - INTERVAL '28 days';

    v_sum := v_sum + COALESCE(v_sess, 0);
    v_n   := v_n + 1;
  END LOOP;

  IF v_n = 0 THEN
    RETURN NULL;
  END IF;
  RETURN v_sum / v_n;
END;
$crew_match_cadence$;

-- ── 3. The distance between two crews ────────────────────────────────
--
-- Pure arithmetic over ten scalars — no table access — so it is cheap to
-- call once per candidate row inside a query, and there is no identifier
-- in its body for the clipboard to mangle.
--
-- Returns 0 (identical) to 1 (as far apart as the scale measures).
-- Weights: division 3, roster 2, strength 2, cadence 1.5, age 1. Division
-- keeps the largest weight because it is the only dimension that already
-- encodes competitive result rather than description.

CREATE OR REPLACE FUNCTION public.crew_match_gap(
  p_roster_a integer, p_age_a numeric, p_str_a numeric, p_cad_a numeric, p_div_a integer,
  p_roster_b integer, p_age_b numeric, p_str_b numeric, p_cad_b numeric, p_div_b integer
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $crew_match_gap$
  SELECT (
      3.0 * LEAST(1.0, ABS(COALESCE(p_div_a, 1) - COALESCE(p_div_b, 1)) / 3.0)
    -- ::numeric on the numerator is load-bearing. Both roster counts are
    -- integers, so without it this is integer division: a 2-against-12
    -- mismatch computed ABS(2-12) / GREATEST(2,12,1) = 10/12 = 0 and the
    -- roster term contributed NOTHING to the distance. Measured before
    -- the cast, gap(2,…) vs gap(12,…) came back exactly 0.000000. Every
    -- other term already divides by a numeric literal (3.0, 4.0, 20.0) or
    -- a numeric column, which is why this was the only one affected.
    + 2.0 * (ABS(COALESCE(p_roster_a, 0) - COALESCE(p_roster_b, 0))::numeric
             / GREATEST(COALESCE(p_roster_a, 0), COALESCE(p_roster_b, 0), 1))
    + 1.5 * LEAST(1.0, ABS(COALESCE(p_cad_a, 0) - COALESCE(p_cad_b, 0)) / 4.0)
    + CASE WHEN p_str_a IS NOT NULL AND p_str_b IS NOT NULL
           THEN 2.0 * (ABS(p_str_a - p_str_b) / GREATEST(p_str_a, p_str_b, 1))
           ELSE 0.0 END
    + CASE WHEN p_age_a IS NOT NULL AND p_age_b IS NOT NULL
           THEN 1.0 * LEAST(1.0, ABS(p_age_a - p_age_b) / 20.0)
           ELSE 0.0 END
  ) / (
      6.5
    + CASE WHEN p_str_a IS NOT NULL AND p_str_b IS NOT NULL THEN 2.0 ELSE 0.0 END
    + CASE WHEN p_age_a IS NOT NULL AND p_age_b IS NOT NULL THEN 1.0 ELSE 0.0 END
  );
$crew_match_gap$;

-- These are internal. Every public-schema function is a PostgREST
-- endpoint until revoked, and crew_match_strength reads other people's
-- training history — it takes a crew id, so exposing it would let any
-- caller profile a crew they are not in.
REVOKE ALL ON FUNCTION public.crew_match_age(uuid)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crew_match_strength(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crew_match_cadence(uuid)  FROM PUBLIC, anon, authenticated;

-- ── 4. Joining the queue ─────────────────────────────────────────────
--
-- Unchanged from 247: leader-gated, two-member minimum, one open entry
-- per crew, pairs on arrival under the partial unique index. What changed
-- is that the crew's profile is computed once up front, candidates are
-- ranked by crew_match_gap instead of division distance, and the row we
-- insert carries the snapshot for whoever arrives next.

CREATE OR REPLACE FUNCTION public.join_crew_war_queue(p_crew_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $join_crew_war_queue$
DECLARE
  v_uid       uuid := auth.uid();
  v_leader    integer;
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

  SELECT COUNT(*) INTO v_leader
    FROM public.crew_members
   WHERE crew_id = p_crew_id
     AND user_id = v_uid
     AND is_admin = TRUE;

  IF v_leader = 0 THEN
    RAISE EXCEPTION 'only a crew leader can enter matchmaking'
      USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_members
    FROM public.crew_members
   WHERE crew_id = p_crew_id;

  IF v_members = LEAST(v_members, 1) THEN
    RAISE EXCEPTION 'crew needs at least two members to battle'
      USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_existing
    FROM public.crew_wars
   WHERE status IN ('matchmaking', 'active')
     AND (crew_a_id = p_crew_id OR crew_b_id = p_crew_id)
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', TRUE, 'status', 'already_queued',
                              'war_id', v_existing);
  END IF;

  PERFORM public.ensure_crew_season_entry(p_crew_id);

  SELECT COALESCE(MIN(division), 1) INTO v_my_div
    FROM public.crew_season_stats
   WHERE crew_id = p_crew_id
     AND season_id = public.current_crew_season();

  v_my_age := public.crew_match_age(p_crew_id);
  v_my_str := public.crew_match_strength(p_crew_id);
  v_my_cad := public.crew_match_cadence(p_crew_id);

  -- Closest first, oldest entry breaking ties. The tolerance a candidate
  -- is held to opens by 0.15 for every 12 hours IT has waited, so an
  -- early arrival gets a near match or keeps waiting, and nobody is
  -- stranded because the pool is small. 5 candidates because the UPDATE
  -- below can lose a race and we want somewhere to go next.
  FOR v_opponent IN
    SELECT w_id FROM (
      SELECT
        id AS w_id,
        created_at AS w_since,
        public.crew_match_gap(
          v_members, v_my_age, v_my_str, v_my_cad, v_my_div,
          match_roster, match_age, match_strength, match_cadence, match_division
        ) AS w_gap,
        FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 43200) AS w_patience
      FROM public.crew_wars
      WHERE crew_b_id IS NULL
        AND status = 'matchmaking'
        AND NOT (crew_a_id = p_crew_id)
      LIMIT 50
    ) AS candidates
    WHERE w_gap = LEAST(w_gap, 0.15 + 0.15 * w_patience)
    ORDER BY w_gap, w_since
    LIMIT 5
  LOOP
    UPDATE public.crew_wars
       SET crew_b_id    = p_crew_id,
           status       = 'active',
           starts_at    = now(),
           ends_at      = now() + INTERVAL '7 days',
           crew_a_score = 0,
           crew_b_score = 0
     WHERE id = v_opponent
       AND crew_b_id IS NULL
       AND status = 'matchmaking';

    GET DIAGNOSTICS v_claimed = ROW_COUNT;

    IF v_claimed = 1 THEN
      PERFORM public.notify_crew_war_started_for(v_opponent);
      RETURN jsonb_build_object('ok', TRUE, 'status', 'matched',
                                'war_id', v_opponent);
    END IF;
  END LOOP;

  INSERT INTO public.crew_wars
    (crew_a_id, crew_b_id, status,
     match_roster, match_age, match_strength, match_cadence, match_division)
  VALUES
    (p_crew_id, NULL, 'matchmaking',
     v_members, v_my_age, v_my_str, v_my_cad, v_my_div)
  RETURNING id INTO v_existing;

  RETURN jsonb_build_object('ok', TRUE, 'status', 'queued',
                            'war_id', v_existing);
END;
$join_crew_war_queue$;

-- ── 5. The sweeper ───────────────────────────────────────────────────
--
-- Same ranking, applied to pairs that are both already waiting. Both
-- sides' profiles are on their rows, so this needs no member reads at
-- all — it is arithmetic over the queue.

CREATE OR REPLACE FUNCTION public.pair_waiting_crew_wars()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $pair_waiting_crew_wars$
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

    SELECT w_id, w_crew INTO v_b, v_b_crew
      FROM (
        SELECT
          id AS w_id,
          crew_a_id AS w_crew,
          created_at AS w_since,
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
     WHERE w_gap = LEAST(
             w_gap,
             0.15 + 0.15 * FLOOR(EXTRACT(EPOCH FROM (now() - v_a_since)) / 43200)
           )
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
$pair_waiting_crew_wars$;

-- ── 6. Scoring: top N per side, N = the smaller roster ───────────────
--
-- Per-member rows are written exactly as before — every member still
-- sees their own volume, sessions and days on the war panel, and the
-- personal figure is unchanged. What changed is the two lines that roll
-- those rows up into the number that decides the war.

CREATE OR REPLACE FUNCTION public.recompute_crew_war(p_war_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $recompute_crew_war$
DECLARE
  v_crew_a  uuid;
  v_crew_b  uuid;
  v_start   timestamptz;
  v_end     timestamptz;
  v_status  text;
  v_crew    uuid;
  v_user    uuid;
  v_email   text;
  v_vol     numeric;
  v_sess    integer;
  v_days    integer;
  v_vol_c   bigint;
  v_sess_c  integer;
  v_days_c  integer;
  v_score   integer;
  v_n_a     integer;
  v_n_b     integer;
  v_field   integer;
  v_score_a integer;
  v_score_b integer;
  v_touched integer := 0;
BEGIN
  IF p_war_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT crew_a_id, crew_b_id, starts_at, ends_at, status
    INTO v_crew_a, v_crew_b, v_start, v_end, v_status
    FROM public.crew_wars
   WHERE id = p_war_id;

  IF v_crew_b IS NULL OR v_start IS NULL OR v_end IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_crew IN SELECT unnest(ARRAY[v_crew_a, v_crew_b])
  LOOP
    FOR v_user IN
      SELECT user_id FROM public.crew_members WHERE crew_id = v_crew LIMIT 40
    LOOP
      SELECT lower(email) INTO v_email
        FROM public.user_profiles WHERE id = v_user;

      SELECT
        COALESCE(SUM(public._duel_calc_volume(exercises)), 0),
        COUNT(*),
        COUNT(DISTINCT "date")
      INTO v_vol, v_sess, v_days
      FROM public.workout_logs
      WHERE (user_id = v_user OR (v_email IS NOT NULL AND lower(created_by) = v_email))
        AND created_at BETWEEN v_start AND v_end;

      v_score := public._crew_war_score(v_vol, v_sess, v_days);
      v_vol_c := LEAST(200000, GREATEST(0, FLOOR(COALESCE(v_vol, 0))))::bigint;
      v_sess_c := LEAST(28, GREATEST(0, COALESCE(v_sess, 0)));
      v_days_c := LEAST(7,  GREATEST(0, COALESCE(v_days, 0)));

      INSERT INTO public.crew_war_contributions
        (war_id, user_id, crew_id, xp_contributed, volume_lbs, sessions, days_active, updated_at)
      VALUES
        (p_war_id, v_user, v_crew, v_score, v_vol_c, v_sess_c, v_days_c, now())
      ON CONFLICT (war_id, user_id) DO UPDATE
        SET xp_contributed = v_score,
            volume_lbs     = v_vol_c,
            sessions       = v_sess_c,
            days_active    = v_days_c,
            crew_id        = v_crew,
            updated_at     = now();

      v_touched := v_touched + 1;
    END LOOP;
  END LOOP;

  -- How many each side may field. Counted from the contribution rows
  -- rather than crew_members, because that is exactly the set that was
  -- scored — the loop above stops at 40, so a 60-member crew fields 40
  -- and the count has to agree with the sum it bounds.
  SELECT COUNT(*) INTO v_n_a
    FROM public.crew_war_contributions
   WHERE war_id = p_war_id AND crew_id = v_crew_a;

  SELECT COUNT(*) INTO v_n_b
    FROM public.crew_war_contributions
   WHERE war_id = p_war_id AND crew_id = v_crew_b;

  v_field := GREATEST(1, LEAST(v_n_a, v_n_b));

  SELECT COALESCE(SUM(xp_contributed), 0) INTO v_score_a
    FROM (
      SELECT xp_contributed
        FROM public.crew_war_contributions
       WHERE war_id = p_war_id AND crew_id = v_crew_a
       ORDER BY xp_contributed DESC
       LIMIT v_field
    ) AS fielded_a;

  SELECT COALESCE(SUM(xp_contributed), 0) INTO v_score_b
    FROM (
      SELECT xp_contributed
        FROM public.crew_war_contributions
       WHERE war_id = p_war_id AND crew_id = v_crew_b
       ORDER BY xp_contributed DESC
       LIMIT v_field
    ) AS fielded_b;

  UPDATE public.crew_wars
     SET crew_a_score = v_score_a,
         crew_b_score = v_score_b,
         scored_at    = now()
   WHERE id = p_war_id;

  RETURN v_touched;
END;
$recompute_crew_war$;
