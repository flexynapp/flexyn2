-- 259_fix_around_me_temp_table.sql
--
-- get_leaderboard_around_me has never worked. Migration 257 declared it
-- STABLE but built its result in a TEMP TABLE, and Postgres rejects that
-- combination outright:
--
--     ERROR: 0A000: CREATE TABLE is not allowed in a non-volatile function
--
-- So every call raised, on every input. It went unnoticed because nothing
-- consumed it yet — the client wrapper was written ahead of the surfaces
-- that needed it, and the wrapper's error handling turns an unrecognised
-- failure into `supported: false`, which looks exactly like a host that
-- hasn't run the migration.
--
-- Rewritten as a single statement. The temp table only existed to compute
-- ranks once and then read them twice (find the caller's rank, then take a
-- window around it); a CTE with a scalar subquery does the same thing, and
-- lets the function stay STABLE — which is what we want, since it's a pure
-- read the planner should be free to hoist.
--
-- The UNION ALL covers the not-on-the-board case (no activity yet, or
-- hide_from_search set): return the head of the list so the surface still
-- renders something rather than collapsing to empty.
--
-- Verified against production before shipping: caller at rank 4 of 8 gets
-- ranks 2-6 back with is_me true on their own row.
--
-- Paste-safety: no dotted alias.column tokens (see CLAUDE.md §7).

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
  v_uid    UUID := auth.uid();
  v_radius INT  := LEAST(GREATEST(COALESCE(p_radius, 3), 1), 25);
  v_board  TEXT := COALESCE(p_board, 'xp');
  v_period TEXT := COALESCE(p_period, 'alltime');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF v_board NOT IN ('volume', 'xp', 'achievements', 'distance') THEN
    RAISE EXCEPTION 'invalid board' USING ERRCODE = '22023';
  END IF;
  IF v_period <> 'alltime' THEN
    RAISE EXCEPTION 'around-me supports alltime only' USING ERRCODE = '22023';
  END IF;

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
    ),
    ranked AS (
      SELECT
        (ROW_NUMBER() OVER (ORDER BY value DESC, user_id ASC))::INT AS rank,
        user_id, username, full_name, avatar_url, value
      FROM live
    ),
    me AS (
      SELECT rank AS my_rank FROM ranked WHERE user_id = v_uid
    )
    SELECT rank, user_id, username, full_name, avatar_url, value,
           (user_id = v_uid) AS is_me
    FROM ranked
    WHERE (SELECT my_rank FROM me) IS NOT NULL
      AND rank BETWEEN (SELECT my_rank FROM me) - v_radius
                   AND (SELECT my_rank FROM me) + v_radius
    UNION ALL
    SELECT rank, user_id, username, full_name, avatar_url, value, false
    FROM ranked
    WHERE (SELECT my_rank FROM me) IS NULL
      AND rank <= (v_radius * 2) + 1
    ORDER BY rank;
END;
$get_leaderboard_around_me$;

REVOKE ALL ON FUNCTION public.get_leaderboard_around_me(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_around_me(TEXT, TEXT, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
