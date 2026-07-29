-- 257_leaderboard_rpc_all_boards.sql
--
-- Moves the ALL-TIME global leaderboard off the client and onto the server,
-- and closes two defects in the existing get_period_leaderboard (mig 125).
--
-- Why:
--
--   1. SCALE. LeaderboardsContent's all-time path called
--      db.entities.User.list() and ranked the entire user table in the
--      browser. Every athlete's row, for every viewer, on every open.
--      Migration 125 already built the right shape for weekly/monthly;
--      this extends it to cover the two boards that were left behind
--      (achievements, distance) so the client never needs User.list().
--
--   2. EMAIL LEAK. The 125 signature returned `email` for the top 100 to
--      any authenticated caller — the same harvest surface migration 195
--      closed on the public_profiles view. Nothing consumed it. The
--      column is dropped from the return here. Because RETURNS TABLE is
--      part of the signature, this needs DROP + CREATE, not CREATE OR
--      REPLACE.
--
--   3. NON-DETERMINISTIC TIES. 125 ordered on the metric alone, so tied
--      athletes came back in whatever order the plan produced and could
--      visibly swap places between refetches. Every ordering here is a
--      full key — metric DESC, then user_id — which is stable and also
--      fairer than a coin flip.
--
-- Also new: rank is computed server-side and returned, and
-- get_leaderboard_around_me lets an athlete outside the top 100 see their
-- real rank plus immediate neighbours. That is what makes a rank
-- actionable — the top-N-only shape could only ever say "not ranked".
--
-- Privacy: hide_from_search is honoured. Migration 117 defines that flag
-- as "removes the account from user-search + PYMK", i.e. an opt-out of
-- being discovered by strangers, and a global leaderboard is exactly
-- that. is_private is deliberately NOT honoured — it gates profile
-- CONTENT from non-followers, and those users' names already appear
-- throughout the app; dropping them from rankings would silently
-- distort everyone else's position.
--
-- Paste-safety: no dotted alias.column or record.id tokens anywhere in
-- this file (see CLAUDE.md §7). Joins go through CTEs and USING() so
-- every reference is a bare column name.

-- ── Shared ranking view ──────────────────────────────────────────────────────
-- One place that knows which profiles are eligible for a public board.
CREATE OR REPLACE VIEW public.leaderboard_eligible_profiles AS
  SELECT
    id         AS user_id,
    username   AS username,
    full_name  AS full_name,
    avatar_url AS avatar_url,
    COALESCE(total_xp, 0)::NUMERIC                    AS xp_value,
    COALESCE(total_volume_lbs, 0)::NUMERIC            AS volume_value,
    COALESCE(total_distance_meters, 0)::NUMERIC       AS distance_value,
    COALESCE(achievements_unlocked_count, 0)::NUMERIC AS achievements_value
  FROM public.user_profiles
  WHERE COALESCE(hide_from_search, false) = false;

REVOKE ALL ON public.leaderboard_eligible_profiles FROM PUBLIC;
GRANT SELECT ON public.leaderboard_eligible_profiles TO authenticated;

-- ── Top-N board ──────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_period_leaderboard(TEXT, TEXT, INT);

CREATE OR REPLACE FUNCTION public.get_period_leaderboard(
  p_board  TEXT,   -- 'volume' | 'xp' | 'sessions' | 'achievements' | 'distance'
  p_period TEXT,   -- 'weekly' | 'monthly' | 'alltime'
  p_limit  INT DEFAULT 100
) RETURNS TABLE (
  rank       INT,
  user_id    UUID,
  username   TEXT,
  full_name  TEXT,
  avatar_url TEXT,
  value      NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $get_period_leaderboard$
#variable_conflict use_column
DECLARE
  v_uid    UUID := auth.uid();
  v_limit  INT  := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
  v_period TEXT := COALESCE(p_period, 'alltime');
  v_board  TEXT := COALESCE(p_board, 'volume');
  v_since  TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF v_board NOT IN ('volume', 'xp', 'sessions', 'achievements', 'distance') THEN
    RAISE EXCEPTION 'invalid board' USING ERRCODE = '22023';
  END IF;
  IF v_period NOT IN ('weekly', 'monthly', 'alltime') THEN
    RAISE EXCEPTION 'invalid period' USING ERRCODE = '22023';
  END IF;

  -- Achievements and distance have no period-scoped definition — we don't
  -- keep per-window aggregates for either. Pin them to all-time rather than
  -- silently returning zeros, which is how the weekly XP board failed
  -- before migration 125.
  IF v_board IN ('achievements', 'distance') THEN
    v_period := 'alltime';
  END IF;

  IF v_period = 'alltime' THEN
    RETURN QUERY
      WITH base AS (
        SELECT
          user_id    AS user_id,
          username   AS username,
          full_name  AS full_name,
          avatar_url AS avatar_url,
          CASE v_board
            WHEN 'xp'           THEN xp_value
            WHEN 'volume'       THEN volume_value
            WHEN 'distance'     THEN distance_value
            WHEN 'achievements' THEN achievements_value
            ELSE 0::NUMERIC
          END AS value
        FROM public.leaderboard_eligible_profiles
      ),
      live AS (
        SELECT user_id, username, full_name, avatar_url, value
        FROM base
        WHERE value > 0
      )
      SELECT
        (ROW_NUMBER() OVER (ORDER BY value DESC, user_id ASC))::INT AS rank,
        user_id, username, full_name, avatar_url, value
      FROM live
      ORDER BY value DESC, user_id ASC
      LIMIT v_limit;
    RETURN;
  END IF;

  -- 'alltime' sessions has no denormalized column, so it falls through to
  -- the log-scan path below alongside the weekly / monthly windows.
  v_since := CASE v_period
    WHEN 'weekly'  THEN date_trunc('week',  now() AT TIME ZONE 'UTC')
    WHEN 'monthly' THEN date_trunc('month', now() AT TIME ZONE 'UTC')
    ELSE NULL
  END;

  RETURN QUERY
    WITH stats AS (
      SELECT
        user_id                                  AS user_id,
        SUM(COALESCE(total_volume, 0))::NUMERIC  AS agg_volume,
        COUNT(*)::NUMERIC                        AS agg_sessions
      FROM public.workout_logs
      WHERE v_since IS NULL OR date >= v_since::date
      GROUP BY user_id
    ),
    eligible AS (
      SELECT user_id, username, full_name, avatar_url
      FROM public.leaderboard_eligible_profiles
    ),
    joined AS (
      SELECT
        user_id, username, full_name, avatar_url,
        CASE v_board
          WHEN 'sessions' THEN agg_sessions
          ELSE agg_volume   -- volume, and xp approximated by volume (see below)
        END AS value
      FROM stats
      JOIN eligible USING (user_id)
    ),
    live AS (
      SELECT user_id, username, full_name, avatar_url, value
      FROM joined
      WHERE value > 0
    )
    SELECT
      (ROW_NUMBER() OVER (ORDER BY value DESC, user_id ASC))::INT AS rank,
      user_id, username, full_name, avatar_url, value
    FROM live
    ORDER BY value DESC, user_id ASC
    LIMIT v_limit;
  -- TODO: weekly/monthly XP is still approximated by volume, carried over
  -- from migration 125. Deriving it properly needs a per-window XP source
  -- (league_members.weekly_xp covers the week only). Tracked separately.
END;
$get_period_leaderboard$;

REVOKE ALL ON FUNCTION public.get_period_leaderboard(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_period_leaderboard(TEXT, TEXT, INT) TO authenticated;

-- ── The caller's own neighbourhood ───────────────────────────────────────────
-- Returns the caller plus p_radius rows either side, with true global ranks.
-- Without this, anyone outside the top 100 has no rank to show at all.
-- Nakama exposes the same pair of reads (top-N and around-owner) for exactly
-- this reason.
CREATE OR REPLACE FUNCTION public.get_leaderboard_around_me(
  p_board  TEXT,
  p_period TEXT DEFAULT 'alltime',
  p_radius INT  DEFAULT 3
) RETURNS TABLE (
  rank       INT,
  user_id    UUID,
  username   TEXT,
  full_name  TEXT,
  avatar_url TEXT,
  value      NUMERIC,
  is_me      BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $get_leaderboard_around_me$
#variable_conflict use_column
DECLARE
  v_uid     UUID := auth.uid();
  v_radius  INT  := LEAST(GREATEST(COALESCE(p_radius, 3), 1), 25);
  v_board   TEXT := COALESCE(p_board, 'xp');
  v_period  TEXT := COALESCE(p_period, 'alltime');
  v_my_rank INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF v_board NOT IN ('volume', 'xp', 'achievements', 'distance') THEN
    RAISE EXCEPTION 'invalid board' USING ERRCODE = '22023';
  END IF;
  -- Only the all-time boards are backed by denormalized columns cheap
  -- enough to rank the whole table for a neighbourhood read.
  IF v_period <> 'alltime' THEN
    RAISE EXCEPTION 'around-me supports alltime only' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS tmp_board (
    rank       INT,
    user_id    UUID,
    username   TEXT,
    full_name  TEXT,
    avatar_url TEXT,
    value      NUMERIC
  ) ON COMMIT DROP;
  DELETE FROM tmp_board;

  INSERT INTO tmp_board (rank, user_id, username, full_name, avatar_url, value)
  WITH base AS (
    SELECT
      user_id    AS user_id,
      username   AS username,
      full_name  AS full_name,
      avatar_url AS avatar_url,
      CASE v_board
        WHEN 'xp'           THEN xp_value
        WHEN 'volume'       THEN volume_value
        WHEN 'distance'     THEN distance_value
        WHEN 'achievements' THEN achievements_value
        ELSE 0::NUMERIC
      END AS value
    FROM public.leaderboard_eligible_profiles
  ),
  live AS (
    SELECT user_id, username, full_name, avatar_url, value
    FROM base
    WHERE value > 0
  )
  SELECT
    (ROW_NUMBER() OVER (ORDER BY value DESC, user_id ASC))::INT,
    user_id, username, full_name, avatar_url, value
  FROM live;

  SELECT rank INTO v_my_rank FROM tmp_board WHERE user_id = v_uid;

  -- Not on the board (no activity yet, or opted out of discovery): return
  -- the head of the list rather than nothing, so the surface still renders.
  IF v_my_rank IS NULL THEN
    RETURN QUERY
      SELECT rank, user_id, username, full_name, avatar_url, value, false
      FROM tmp_board
      ORDER BY rank
      LIMIT (v_radius * 2) + 1;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT rank, user_id, username, full_name, avatar_url, value,
           (user_id = v_uid) AS is_me
    FROM tmp_board
    WHERE rank BETWEEN (v_my_rank - v_radius) AND (v_my_rank + v_radius)
    ORDER BY rank;
END;
$get_leaderboard_around_me$;

REVOKE ALL ON FUNCTION public.get_leaderboard_around_me(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_around_me(TEXT, TEXT, INT) TO authenticated;

-- Ranking scans the whole eligible set on every open; these keep it cheap.
CREATE INDEX IF NOT EXISTS idx_user_profiles_total_xp
  ON public.user_profiles (total_xp DESC) WHERE total_xp > 0;
CREATE INDEX IF NOT EXISTS idx_user_profiles_total_volume
  ON public.user_profiles (total_volume_lbs DESC) WHERE total_volume_lbs > 0;
CREATE INDEX IF NOT EXISTS idx_user_profiles_total_distance
  ON public.user_profiles (total_distance_meters DESC) WHERE total_distance_meters > 0;
CREATE INDEX IF NOT EXISTS idx_user_profiles_achievements
  ON public.user_profiles (achievements_unlocked_count DESC) WHERE achievements_unlocked_count > 0;

NOTIFY pgrst, 'reload schema';
