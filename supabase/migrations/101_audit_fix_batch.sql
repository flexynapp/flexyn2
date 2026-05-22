-- 101_audit_fix_batch.sql
--
-- HOTFIX batch for three column/function-name bugs of the SAME class
-- as the timezone_offset bug fixed in migration 100. All three were
-- shipped earlier in this session, silently failed in production via
-- a swallowing EXCEPTION handler or never-returned RPC, and were
-- caught by a follow-up self-audit pass.
--
-- The user's explicit feedback on shipping 100 was: "There shouldn't
-- be any error's if you checked your work and made sure it was
-- perfect..." — fair. This migration cleans up the rest of the
-- references-to-nonexistent-schema class.
--
-- Bugs being fixed:
--
--   1. 089_referrals.sql calls grant_flex_coins(uuid, integer). The
--      only flex-coin RPC that exists is increment_flex_coins(integer)
--      from migration 030, which operates on auth.uid(). The 089
--      EXCEPTION WHEN undefined_function handler catches every call
--      and falls through to a direct UPDATE — so the system works,
--      but the atomic intent is never honored.  FIX: define the
--      function the code is calling.
--
--   2. 093_friend_leaderboards.sql references p.weekly_xp,
--      p.weekly_volume, p.weekly_sessions on user_profiles. Those
--      columns live on league_members (migration 016), not on
--      user_profiles. The RPC fails with 42703 on every call.
--      FIX: rewrite to aggregate weekly_volume + weekly_sessions
--      from workout_logs, and pull weekly_xp from league_members
--      (NULL/0 if the user isn't in a league).
--
--   3. 091_follow_suggestions.sql references p.total_posts on
--      user_profiles. The column doesn't exist anywhere. The RPC
--      fails with 42703 on every call.  FIX: drop the dead sort
--      key — the COUNT subquery on follows is already the primary
--      ranking signal, and created_at ASC is the tiebreak. No
--      ranking quality is lost.

-- ── 1. grant_flex_coins(p_user_id, p_delta) ───────────────────────────
--
-- Sibling to increment_flex_coins, but takes an explicit target
-- user_id so callers can credit a user OTHER than auth.uid().
-- SECURITY DEFINER bypasses RLS. Only callable from authenticated
-- contexts (claim_referral is the current consumer).

CREATE OR REPLACE FUNCTION public.grant_flex_coins(p_user_id UUID, p_delta INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'no user_id' USING ERRCODE = '22023';
  END IF;
  IF p_delta IS NULL OR p_delta = 0 THEN RETURN; END IF;
  -- Same clamping as increment_flex_coins: don't allow a race to
  -- push a balance below zero.
  UPDATE public.user_profiles
     SET flex_coins = GREATEST(0, COALESCE(flex_coins, 0) + p_delta)
   WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_flex_coins(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_flex_coins(UUID, INTEGER) TO authenticated;

-- ── 2. get_friend_leaderboard — rewrite without nonexistent cols ─────
--
-- Compute weekly_volume + weekly_sessions on the fly from
-- workout_logs over the current ISO week (Mon-Sun in UTC).
-- weekly_xp comes from league_members (one row per active league
-- membership; sum across leagues in case a user is in multiple
-- mid-rollover, though typically one). The shape of the returned
-- table is unchanged so the client doesn't need to change.

CREATE OR REPLACE FUNCTION public.get_friend_leaderboard(
  p_mode  TEXT DEFAULT 'weekly_xp',
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
  v_uid        UUID := auth.uid();
  v_email      TEXT;
  v_limit      INT  := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_mode       TEXT := COALESCE(p_mode, 'weekly_xp');
  v_week_start TIMESTAMPTZ := date_trunc('week', now() AT TIME ZONE 'UTC');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF v_mode NOT IN ('weekly_xp', 'weekly_volume', 'weekly_sessions') THEN
    RAISE EXCEPTION 'invalid mode' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;
  IF v_email IS NULL THEN RETURN; END IF;

  RETURN QUERY
    WITH mutuals AS (
      SELECT hf1.followee_email AS email
        FROM public.hub_follows hf1
        JOIN public.hub_follows hf2
          ON hf2.follower_email = hf1.followee_email
         AND hf2.followee_email = hf1.follower_email
       WHERE hf1.follower_email = v_email
    ),
    candidates AS (
      SELECT email FROM mutuals
      UNION
      SELECT v_email
    ),
    -- Per-user weekly volume + session count from workout_logs.
    -- date column is DATE so compare against the week-start date.
    -- Guard the case where the user has no logs at all (LEFT JOIN
    -- in the final SELECT handles that).
    weekly_stats AS (
      SELECT
        wl.user_id,
        SUM(COALESCE(wl.total_volume, 0))::NUMERIC AS w_volume,
        COUNT(*)::INT                              AS w_sessions
      FROM public.workout_logs wl
      WHERE wl.date >= v_week_start::date
      GROUP BY wl.user_id
    ),
    -- Aggregate weekly_xp across any leagues the user is in (a user
    -- may briefly be in two during transition windows). NULL → 0 in
    -- the final COALESCE.
    weekly_xp_per_user AS (
      SELECT
        lm.user_id,
        SUM(COALESCE(lm.weekly_xp, 0))::INT AS w_xp
      FROM public.league_members lm
      GROUP BY lm.user_id
    ),
    ranked AS (
      SELECT
        p.id,
        p.username,
        p.avatar_url,
        p.current_level,
        COALESCE(wx.w_xp,       0)::INT     AS weekly_xp,
        COALESCE(ws.w_volume,   0)::NUMERIC AS weekly_volume,
        COALESCE(ws.w_sessions, 0)::INT     AS weekly_sessions,
        (p.id = v_uid)                      AS is_self
      FROM public.user_profiles p
      JOIN candidates c ON c.email = p.email
      LEFT JOIN weekly_stats        ws ON ws.user_id = p.id
      LEFT JOIN weekly_xp_per_user  wx ON wx.user_id = p.id
      WHERE p.username IS NOT NULL
        AND p.username NOT LIKE 'deleted_%'
    )
    SELECT
      r.id, r.username, r.avatar_url, r.current_level,
      r.weekly_xp, r.weekly_volume, r.weekly_sessions, r.is_self
    FROM ranked r
    ORDER BY
      CASE v_mode
        WHEN 'weekly_xp'       THEN r.weekly_xp::NUMERIC
        WHEN 'weekly_volume'   THEN r.weekly_volume
        WHEN 'weekly_sessions' THEN r.weekly_sessions::NUMERIC
      END DESC NULLS LAST,
      r.username ASC
    LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_friend_leaderboard(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_friend_leaderboard(TEXT, INT) TO authenticated;

-- ── 3. get_suggested_followees — drop dead total_posts sort ───────────
--
-- total_posts doesn't exist on user_profiles. The ORDER BY
-- COALESCE(p.total_posts, 0) was a 42703 silent failure on every
-- call. The primary sort (follower COUNT) and tiebreak (created_at)
-- carry enough signal on their own — drop the broken middle term.

CREATE OR REPLACE FUNCTION public.get_suggested_followees(p_limit INT DEFAULT 8)
RETURNS TABLE (
  user_id          UUID,
  username         TEXT,
  email            TEXT,
  avatar_url       TEXT,
  current_level    INT,
  follower_count   INT,
  active_until     TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_email  TEXT;
  v_limit  INT  := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 20);
  v_since  DATE := (now() AT TIME ZONE 'UTC')::date - INTERVAL '30 days';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;

  RETURN QUERY
    SELECT
      p.id              AS user_id,
      p.username,
      p.email,
      p.avatar_url,
      p.current_level,
      (SELECT COUNT(*)::INT FROM public.hub_follows hf
        WHERE hf.followee_email = p.email)         AS follower_count,
      p.active_until
    FROM public.user_profiles p
    WHERE p.id <> v_uid
      AND p.email IS NOT NULL
      AND p.username IS NOT NULL
      AND p.username NOT LIKE 'deleted_%'
      AND p.last_login_date >= v_since
      AND NOT EXISTS (
        SELECT 1 FROM public.hub_follows hf
         WHERE hf.follower_email = v_email
           AND hf.followee_email = p.email
      )
    ORDER BY
      (SELECT COUNT(*) FROM public.hub_follows hf WHERE hf.followee_email = p.email) DESC,
      p.created_at ASC
    LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_suggested_followees(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_suggested_followees(INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
