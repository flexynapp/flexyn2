-- migration 103: Hub social features
-- Adds: post editing (edited_at), post scheduling (publish_at),
--        repost mechanism (original_post_id), hashtag arrays (hashtags),
--        website_url on user_profiles, and PYMK helper function.
--
-- All ALTER TABLE use IF NOT EXISTS — safe to re-run on partial failures.

-- ── hub_posts additions ──────────────────────────────────────────────────────

ALTER TABLE hub_posts
  ADD COLUMN IF NOT EXISTS edited_at       TIMESTAMPTZ     NULL,
  ADD COLUMN IF NOT EXISTS publish_at      TIMESTAMPTZ     NULL,
  ADD COLUMN IF NOT EXISTS original_post_id TEXT           NULL,
  ADD COLUMN IF NOT EXISTS hashtags        TEXT[]          NULL DEFAULT '{}';

-- Index for scheduled-post queries (WHERE publish_at <= NOW())
CREATE INDEX IF NOT EXISTS idx_hub_posts_publish_at
  ON hub_posts (publish_at)
  WHERE publish_at IS NOT NULL;

-- Index for reposts (WHERE original_post_id IS NOT NULL)
CREATE INDEX IF NOT EXISTS idx_hub_posts_original_post_id
  ON hub_posts (original_post_id)
  WHERE original_post_id IS NOT NULL;

-- Index for hashtag searches (GIN array index)
CREATE INDEX IF NOT EXISTS idx_hub_posts_hashtags
  ON hub_posts USING GIN (hashtags);

-- ── user_profiles additions ──────────────────────────────────────────────────

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS website_url TEXT NULL;

-- ── PYMK helper function ─────────────────────────────────────────────────────
-- Returns up to `p_limit` users who the given user does NOT yet follow
-- but who share at least one mutual follower (i.e., followed by someone
-- who also follows the seed user). Falls back to recency-ordered new users
-- when no mutuals exist. SECURITY DEFINER so it can cross-user RLS.

CREATE OR REPLACE FUNCTION get_people_you_may_know(
  p_email  TEXT,
  p_limit  INT DEFAULT 8
)
RETURNS TABLE (
  email        TEXT,
  mutual_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH
    -- Who does the seed follow?
    i_follow AS (
      SELECT followee_email AS fe
      FROM   hub_follows
      WHERE  follower_email = p_email
    ),
    -- Who follows the seed?
    follow_me AS (
      SELECT follower_email AS fe
      FROM   hub_follows
      WHERE  followee_email = p_email
    ),
    -- Candidates: people that the seed's followers also follow
    candidates AS (
      SELECT hf.followee_email AS candidate_email,
             COUNT(*)          AS mutual_count
      FROM   hub_follows hf
      JOIN   follow_me fm ON fm.fe = hf.follower_email
      WHERE  hf.followee_email <> p_email
        AND  hf.followee_email NOT IN (SELECT fe FROM i_follow)
      GROUP  BY hf.followee_email
    )
  SELECT c.candidate_email, c.mutual_count
  FROM   candidates c
  ORDER  BY c.mutual_count DESC
  LIMIT  p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_people_you_may_know(TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_people_you_may_know(TEXT, INT) TO service_role;

NOTIFY pgrst, 'reload schema';
