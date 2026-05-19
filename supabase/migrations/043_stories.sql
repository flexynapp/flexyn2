-- Migration 043: 24-hour Photo Stories
--
-- Instagram / Snapchat-style stories. A user posts a photo that is visible
-- to their followers for 24 hours, then automatically expires.
--
-- Tables:
--   stories       — one row per posted photo, expires_at auto-set to +24h
--   story_views   — tracks which viewer has seen which story so the UI can
--                   show a seen/unseen ring on each avatar

-- ── stories ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.stories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email  TEXT NOT NULL,
  image_url   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_stories_user_email ON public.stories(user_email);
CREATE INDEX IF NOT EXISTS idx_stories_expires     ON public.stories(expires_at);
CREATE INDEX IF NOT EXISTS idx_stories_created     ON public.stories(user_email, created_at DESC);

ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read stories (follower filtering is done client-side).
-- This keeps the RLS simple and avoids a join on hub_follows inside the policy.
-- DROP-THEN-CREATE so the migration is safely re-runnable: Postgres CREATE
-- POLICY has no IF NOT EXISTS clause, so a second apply on top of a partial
-- run blows up with 42710 ("policy already exists"). Subsequent migrations
-- (047, 048) follow the same pattern.
DROP POLICY IF EXISTS "stories: authenticated can read" ON public.stories;
CREATE POLICY "stories: authenticated can read"
  ON public.stories FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "stories: insert own" ON public.stories;
CREATE POLICY "stories: insert own"
  ON public.stories FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "stories: delete own" ON public.stories;
CREATE POLICY "stories: delete own"
  ON public.stories FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ── story_views ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.story_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id    UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  viewer_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (story_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS idx_story_views_viewer ON public.story_views(viewer_id);

ALTER TABLE public.story_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "story_views: authenticated can read" ON public.story_views;
CREATE POLICY "story_views: authenticated can read"
  ON public.story_views FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "story_views: insert own" ON public.story_views;
CREATE POLICY "story_views: insert own"
  ON public.story_views FOR INSERT
  TO authenticated
  WITH CHECK (viewer_id = auth.uid());
