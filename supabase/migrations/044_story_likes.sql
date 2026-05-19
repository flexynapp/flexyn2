-- Migration 044: Story Likes
--
-- Lets viewers send a ❤️ reaction to a story. The owner sees who liked vs
-- who just viewed when they swipe up on their own story.

CREATE TABLE IF NOT EXISTS public.story_likes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id    UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  liker_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  liker_email TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (story_id, liker_id)
);

CREATE INDEX IF NOT EXISTS idx_story_likes_story  ON public.story_likes(story_id);
CREATE INDEX IF NOT EXISTS idx_story_likes_liker  ON public.story_likes(liker_id);

ALTER TABLE public.story_likes ENABLE ROW LEVEL SECURITY;

-- Story owner needs to read who liked their story.
-- DROP-THEN-CREATE so this migration is safely re-runnable (see note in 043).
DROP POLICY IF EXISTS "story_likes: authenticated can read" ON public.story_likes;
CREATE POLICY "story_likes: authenticated can read"
  ON public.story_likes FOR SELECT
  TO authenticated
  USING (true);

-- Only insert your own like
DROP POLICY IF EXISTS "story_likes: insert own" ON public.story_likes;
CREATE POLICY "story_likes: insert own"
  ON public.story_likes FOR INSERT
  TO authenticated
  WITH CHECK (liker_id = auth.uid());

-- Only delete your own like (unlike)
DROP POLICY IF EXISTS "story_likes: delete own" ON public.story_likes;
CREATE POLICY "story_likes: delete own"
  ON public.story_likes FOR DELETE
  TO authenticated
  USING (liker_id = auth.uid());
