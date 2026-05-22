-- 091_follow_suggestions.sql
--
-- Surfaces "suggested follows" — popular active users the caller isn't
-- yet following. Drives the new Follow Suggestion Rail at the top of
-- the Hub feed. Fixes the empty-feed trap: a new user with zero
-- follows sees no posts, no live activity, no follower activity
-- banner, and bounces. One tap on a suggested user fixes that.
--
-- DESIGN
-- ──────
-- Single SECURITY DEFINER RPC. Eligibility:
--   • Active in last 30 days (last_login_date >= now() - 30 days)
--   • Has a non-NULL email (skip ghost accounts)
--   • Not the caller
--   • Not already followed by the caller (NOT EXISTS hub_follows)
--   • username is set (skip deleted_* placeholders + null usernames —
--     a "Follow ?" card is useless)
--
-- Ranking signal: total_followers DESC, then total_posts DESC. Popular
-- + active accounts surface first (social proof). Tiebreak on
-- created_at ASC to favor established users over fresh signups.
--
-- Returns 8 by default — slightly more than the crew rail (5) because
-- follows are lighter-weight commitments than crew membership. A
-- horizontal rail comfortably handles 8 cards on a mobile screen.

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
      -- Subquery count, not a JOIN-GROUP-BY, so we don't double-count
      -- a user who has followers in multiple status states.
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
      COALESCE(p.total_posts, 0) DESC,
      p.created_at ASC
    LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_suggested_followees(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_suggested_followees(INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
