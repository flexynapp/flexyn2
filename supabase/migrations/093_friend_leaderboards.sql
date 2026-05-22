-- 093_friend_leaderboards.sql
--
-- Server-side weekly leaderboard scoped to the caller's mutual
-- follows. Powers a new "Friends" tab on the Leaderboards modal.
-- Competitive without crew commitment — you don't have to join a
-- crew or accept a duel to feel the social pressure of friends
-- ranking above you.
--
-- DESIGN
-- ──────
-- The leaderboard is mutual-follow only — A appears on B's board
-- iff they follow each other. Unilateral follows would let a user
-- show up on a stranger's leaderboard just by following them, which
-- is anti-pattern.
--
-- Three sort modes: weekly_xp, weekly_volume, weekly_sessions. The
-- RPC takes p_mode and picks the right column for the ORDER BY.
-- All three columns come straight from the existing weekly stats
-- (computed by the leaderboard cron / WeeklyRecap path).
--
-- The caller is ALWAYS included in the result, even if they wouldn't
-- otherwise be in the top N — seeing your own row is the whole
-- point of a leaderboard.

CREATE OR REPLACE FUNCTION public.get_friend_leaderboard(
  p_mode  TEXT DEFAULT 'weekly_xp',  -- 'weekly_xp' | 'weekly_volume' | 'weekly_sessions'
  p_limit INT  DEFAULT 20
)
RETURNS TABLE (
  user_id          UUID,
  username         TEXT,
  avatar_url       TEXT,
  current_level    INT,
  weekly_xp        INT,
  weekly_volume    NUMERIC,
  weekly_sessions  INT,
  is_self          BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_email  TEXT;
  v_limit  INT  := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_mode   TEXT := COALESCE(p_mode, 'weekly_xp');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF v_mode NOT IN ('weekly_xp', 'weekly_volume', 'weekly_sessions') THEN
    RAISE EXCEPTION 'invalid mode' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;
  IF v_email IS NULL THEN
    RETURN;
  END IF;

  -- The CTE finds mutual follows: emails where the caller follows
  -- them AND they follow the caller back.
  RETURN QUERY
    WITH mutuals AS (
      SELECT hf1.followee_email AS email
        FROM public.hub_follows hf1
        JOIN public.hub_follows hf2
          ON hf2.follower_email = hf1.followee_email
         AND hf2.followee_email = hf1.follower_email
       WHERE hf1.follower_email = v_email
    ),
    -- Include the caller in the candidate set so they always see
    -- their own row. UNION not UNION ALL — dedup if they somehow
    -- appear in mutuals (shouldn't, but defensive).
    candidates AS (
      SELECT email FROM mutuals
      UNION
      SELECT v_email
    ),
    ranked AS (
      SELECT
        p.id,
        p.username,
        p.avatar_url,
        p.current_level,
        COALESCE(p.weekly_xp,        0)::INT     AS weekly_xp,
        COALESCE(p.weekly_volume,    0)::NUMERIC AS weekly_volume,
        COALESCE(p.weekly_sessions,  0)::INT     AS weekly_sessions,
        (p.id = v_uid)                          AS is_self
      FROM public.user_profiles p
      JOIN candidates c ON c.email = p.email
      WHERE p.username IS NOT NULL
        AND p.username NOT LIKE 'deleted_%'
    )
    SELECT
      r.id, r.username, r.avatar_url, r.current_level,
      r.weekly_xp, r.weekly_volume, r.weekly_sessions, r.is_self
    FROM ranked r
    ORDER BY
      CASE v_mode
        WHEN 'weekly_xp'       THEN r.weekly_xp
        WHEN 'weekly_sessions' THEN r.weekly_sessions
      END DESC NULLS LAST,
      CASE v_mode
        WHEN 'weekly_volume'   THEN r.weekly_volume
      END DESC NULLS LAST,
      r.username ASC
    LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_friend_leaderboard(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_friend_leaderboard(TEXT, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
