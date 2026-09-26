-- 097_story_reactions.sql
--
-- Emoji reactions on stories. Mirrors post_sticker_reactions (010)
-- but at the story granularity. Existing story_likes (044) covers
-- binary like/no-like; reactions add expressive variety (😍🔥💪😂🎉).
--
-- One reaction per (story, user) — same as Instagram. A new reaction
-- from the same user UPDATES the existing row rather than appending.

CREATE TABLE IF NOT EXISTS public.story_reactions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id    UUID        NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email  TEXT        NOT NULL,
  user_name   TEXT,
  emoji       TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (story_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_story_reactions_story
  ON public.story_reactions (story_id, created_at DESC);

ALTER TABLE public.story_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "story_reactions: read all" ON public.story_reactions;
CREATE POLICY "story_reactions: read all"
  ON public.story_reactions FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "story_reactions: own write" ON public.story_reactions;
CREATE POLICY "story_reactions: own write"
  ON public.story_reactions FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
