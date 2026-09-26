-- 047_story_enhancements.sql
-- 25-hour expiry, privacy, story blocks, status notes + likes

-- 1. 25-hour story expiry
ALTER TABLE public.stories
  ALTER COLUMN expires_at SET DEFAULT now() + interval '25 hours';

-- 2. Privacy columns
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS privacy TEXT NOT NULL DEFAULT 'friends';

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS default_story_privacy TEXT NOT NULL DEFAULT 'friends';

-- 3. Story blocks
CREATE TABLE IF NOT EXISTS public.story_blocks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocker_email TEXT        NOT NULL,
  blocked_email TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(blocker_id, blocked_email)
);

ALTER TABLE public.story_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "story_blocks_all" ON public.story_blocks;
CREATE POLICY "story_blocks_all" ON public.story_blocks
  FOR ALL USING (blocker_id = auth.uid());

-- 4. Status notes
CREATE TABLE IF NOT EXISTS public.status_notes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT        NOT NULL,
  text       TEXT        NOT NULL CHECK (char_length(text) <= 60),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.status_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "status_notes_select" ON public.status_notes;
DROP POLICY IF EXISTS "status_notes_manage" ON public.status_notes;
CREATE POLICY "status_notes_select" ON public.status_notes
  FOR SELECT USING (expires_at > now());
CREATE POLICY "status_notes_manage" ON public.status_notes
  FOR ALL USING (user_id = auth.uid());

-- 5. Status note likes
CREATE TABLE IF NOT EXISTS public.status_note_likes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id     UUID        NOT NULL REFERENCES public.status_notes(id) ON DELETE CASCADE,
  liker_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  liker_email TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(note_id, liker_id)
);

ALTER TABLE public.status_note_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "status_note_likes_select" ON public.status_note_likes;
DROP POLICY IF EXISTS "status_note_likes_manage" ON public.status_note_likes;
CREATE POLICY "status_note_likes_select" ON public.status_note_likes
  FOR SELECT USING (true);
CREATE POLICY "status_note_likes_manage" ON public.status_note_likes
  FOR ALL USING (liker_id = auth.uid());

NOTIFY pgrst, 'reload schema';
