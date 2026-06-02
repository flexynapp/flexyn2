-- Migration 111: Hub content expansion
-- Adds: video posts, saved posts, creator analytics (post views),
--        live workout sessions, poll votes timeline, collaborator posts.
--
-- Column checks: all ALTER TABLE use IF NOT EXISTS — safe to re-run.
-- RLS: DROP POLICY IF EXISTS before every CREATE POLICY (repo convention).

-- ── hub_posts additions ───────────────────────────────────────────────────────

ALTER TABLE hub_posts
  ADD COLUMN IF NOT EXISTS video_url            TEXT    NULL,
  ADD COLUMN IF NOT EXISTS collaborator_emails  TEXT[]  NULL DEFAULT '{}';

-- ── poll_votes ────────────────────────────────────────────────────────────────
-- Records individual poll votes with timestamps so the timeline view
-- can show how opinion shifted over the life of the poll.

CREATE TABLE IF NOT EXISTS poll_votes (
  id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  post_id      TEXT        NOT NULL,
  user_email   TEXT        NOT NULL,
  option_index INT         NOT NULL CHECK (option_index >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT poll_votes_once UNIQUE (post_id, user_email)
);

ALTER TABLE poll_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "poll_votes_select_any"  ON poll_votes;
DROP POLICY IF EXISTS "poll_votes_insert_own"  ON poll_votes;

-- Anyone can read votes (aggregates are public), only the voter inserts their own.
CREATE POLICY "poll_votes_select_any" ON poll_votes
  FOR SELECT USING (TRUE);

CREATE POLICY "poll_votes_insert_own" ON poll_votes
  FOR INSERT WITH CHECK (
    user_email = (SELECT email FROM user_profiles WHERE id = auth.uid())
  );

GRANT SELECT, INSERT ON poll_votes TO authenticated;
GRANT ALL            ON poll_votes TO service_role;

-- ── hub_saved_posts ───────────────────────────────────────────────────────────
-- Bookmarks for any hub post (not just meals — those live in saved_meals).

CREATE TABLE IF NOT EXISTS hub_saved_posts (
  id         TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_email TEXT        NOT NULL,
  post_id    TEXT        NOT NULL,
  saved_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT hub_saved_posts_once UNIQUE (user_email, post_id)
);

ALTER TABLE hub_saved_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hub_saved_posts_select" ON hub_saved_posts;
DROP POLICY IF EXISTS "hub_saved_posts_insert" ON hub_saved_posts;
DROP POLICY IF EXISTS "hub_saved_posts_delete" ON hub_saved_posts;

CREATE POLICY "hub_saved_posts_select" ON hub_saved_posts
  FOR SELECT USING (
    user_email = (SELECT email FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "hub_saved_posts_insert" ON hub_saved_posts
  FOR INSERT WITH CHECK (
    user_email = (SELECT email FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "hub_saved_posts_delete" ON hub_saved_posts
  FOR DELETE USING (
    user_email = (SELECT email FROM user_profiles WHERE id = auth.uid())
  );

GRANT SELECT, INSERT, DELETE ON hub_saved_posts TO authenticated;
GRANT ALL                    ON hub_saved_posts TO service_role;

-- ── hub_post_views ────────────────────────────────────────────────────────────
-- One row per (post, viewer). Unique constraint prevents double-counting.
-- Populated client-side via IntersectionObserver (2-second dwell threshold).

CREATE TABLE IF NOT EXISTS hub_post_views (
  id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  post_id      TEXT        NOT NULL,
  viewer_email TEXT        NOT NULL,
  viewed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT hub_post_views_once UNIQUE (post_id, viewer_email)
);

ALTER TABLE hub_post_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hub_post_views_select" ON hub_post_views;
DROP POLICY IF EXISTS "hub_post_views_insert" ON hub_post_views;

-- Post authors need SELECT to see analytics; everyone sees their own insert.
CREATE POLICY "hub_post_views_select" ON hub_post_views
  FOR SELECT USING (TRUE);

CREATE POLICY "hub_post_views_insert" ON hub_post_views
  FOR INSERT WITH CHECK (
    viewer_email = (SELECT email FROM user_profiles WHERE id = auth.uid())
  );

GRANT SELECT, INSERT ON hub_post_views TO authenticated;
GRANT ALL            ON hub_post_views TO service_role;

-- ── hub_live_sessions ─────────────────────────────────────────────────────────
-- Tracks active "go live" workout sessions. Realtime presence is handled
-- client-side via Supabase Realtime channels; this table is the source of
-- truth for session discovery and the active session indicator.

CREATE TABLE IF NOT EXISTS hub_live_sessions (
  id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  host_email       TEXT        NOT NULL,
  title            TEXT        NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ NULL,
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  viewer_count     INT         NOT NULL DEFAULT 0,
  current_exercise TEXT        NULL,
  current_set      INT         NULL,
  current_reps     INT         NULL,
  created_date     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE hub_live_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hub_live_sessions_read"       ON hub_live_sessions;
DROP POLICY IF EXISTS "hub_live_sessions_host_write" ON hub_live_sessions;

-- Everyone can discover active sessions; only the host can write.
CREATE POLICY "hub_live_sessions_read" ON hub_live_sessions
  FOR SELECT USING (TRUE);

CREATE POLICY "hub_live_sessions_host_write" ON hub_live_sessions
  FOR ALL USING (
    host_email = (SELECT email FROM user_profiles WHERE id = auth.uid())
  );

GRANT SELECT, INSERT, UPDATE ON hub_live_sessions TO authenticated;
GRANT ALL                    ON hub_live_sessions TO service_role;

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_hub_saved_posts_user
  ON hub_saved_posts (user_email, saved_at DESC);

CREATE INDEX IF NOT EXISTS idx_hub_post_views_post
  ON hub_post_views (post_id);

CREATE INDEX IF NOT EXISTS idx_hub_live_sessions_active
  ON hub_live_sessions (is_active, started_at DESC)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_poll_votes_post
  ON poll_votes (post_id, created_at);

NOTIFY pgrst, 'reload schema';
