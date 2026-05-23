-- 125_period_leaderboard.sql
--
-- Adds get_period_leaderboard(p_board, p_period, p_limit) — top-N
-- users by workout volume / XP / sessions over a time window.
--
-- Context: the existing global leaderboard read `weekly_xp` /
-- `weekly_volume` from `user_profiles`, but those columns don't
-- exist there (only on `league_members.weekly_xp`). The weekly
-- toggle silently degraded to zero everywhere — a latent bug.
-- This RPC restores it and adds a monthly window in one go.
--
-- Aggregation strategy: scan `workout_logs.total_volume` for the
-- period window, group by user, sort by the chosen metric. For
-- 'alltime' we fall back to the denormalized `user_profiles.total_*`
-- columns (faster than scanning every log ever).
--
-- Read-all RLS: anyone authenticated can query the leaderboard.
-- Inner queries run with SECURITY DEFINER so they bypass the
-- per-row visibility rules on workout_logs.

CREATE OR REPLACE FUNCTION public.get_period_leaderboard(
  p_board  TEXT,   -- 'volume' | 'xp' | 'sessions'
  p_period TEXT,   -- 'weekly' | 'monthly' | 'alltime'
  p_limit  INT DEFAULT 100
) RETURNS TABLE (
  user_id    UUID,
  email      TEXT,
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
  IF v_board NOT IN ('volume', 'xp', 'sessions') THEN
    RAISE EXCEPTION 'invalid board' USING ERRCODE = '22023';
  END IF;
  IF v_period NOT IN ('weekly', 'monthly', 'alltime') THEN
    RAISE EXCEPTION 'invalid period' USING ERRCODE = '22023';
  END IF;

  v_since := CASE v_period
    WHEN 'weekly'  THEN date_trunc('week',  now() AT TIME ZONE 'UTC')
    WHEN 'monthly' THEN date_trunc('month', now() AT TIME ZONE 'UTC')
    ELSE NULL
  END;

  IF v_period = 'alltime' AND v_board = 'volume' THEN
    -- Alltime volume: use the denormalized column on user_profiles.
    RETURN QUERY
      SELECT
        p.id          AS user_id,
        p.email,
        p.username,
        p.full_name,
        p.avatar_url,
        COALESCE(p.total_volume_lbs, 0)::NUMERIC AS value
      FROM public.user_profiles p
      WHERE COALESCE(p.total_volume_lbs, 0) > 0
      ORDER BY p.total_volume_lbs DESC
      LIMIT v_limit;
    RETURN;
  END IF;

  IF v_period = 'alltime' AND v_board = 'xp' THEN
    RETURN QUERY
      SELECT
        p.id          AS user_id,
        p.email,
        p.username,
        p.full_name,
        p.avatar_url,
        COALESCE(p.total_xp, 0)::NUMERIC AS value
      FROM public.user_profiles p
      WHERE COALESCE(p.total_xp, 0) > 0
      ORDER BY p.total_xp DESC
      LIMIT v_limit;
    RETURN;
  END IF;

  -- Period-scoped (weekly / monthly) board, OR alltime sessions —
  -- aggregate from workout_logs directly. Sessions is always a
  -- log-count, so we treat alltime-sessions the same path.
  RETURN QUERY
    WITH stats AS (
      SELECT
        wl.user_id,
        SUM(COALESCE(wl.total_volume, 0))::NUMERIC AS w_volume,
        COUNT(*)::INT                              AS w_sessions
      FROM public.workout_logs wl
      WHERE v_since IS NULL OR wl.date >= v_since::date
      GROUP BY wl.user_id
    )
    SELECT
      p.id        AS user_id,
      p.email,
      p.username,
      p.full_name,
      p.avatar_url,
      CASE v_board
        WHEN 'volume'   THEN s.w_volume
        WHEN 'sessions' THEN s.w_sessions::NUMERIC
        WHEN 'xp'       THEN s.w_volume    -- approximate weekly/monthly XP via volume (TODO: derive from xp_logs)
      END AS value
    FROM stats s
    JOIN public.user_profiles p ON p.id = s.user_id
    WHERE CASE v_board
      WHEN 'volume'   THEN s.w_volume > 0
      WHEN 'sessions' THEN s.w_sessions > 0
      WHEN 'xp'       THEN s.w_volume > 0
    END
    ORDER BY CASE v_board
      WHEN 'volume'   THEN s.w_volume
      WHEN 'sessions' THEN s.w_sessions::NUMERIC
      WHEN 'xp'       THEN s.w_volume
    END DESC
    LIMIT v_limit;
END;
$get_period_leaderboard$;

REVOKE ALL ON FUNCTION public.get_period_leaderboard(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_period_leaderboard(TEXT, TEXT, INT) TO authenticated;
