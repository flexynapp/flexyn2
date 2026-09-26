-- 099_story_highlights.sql
--
-- Story Highlights — pinned "best of" stories that live permanently
-- on a user's profile beyond the normal 24-hour story TTL. Instagram-
-- style: user picks past stories and groups them into named albums.
--
-- Two-table design:
--   story_highlights         — one row per album (user_id, title, cover)
--   story_highlight_items    — map story_id → album_id (many-to-many)

CREATE TABLE IF NOT EXISTS public.story_highlights (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email    TEXT        NOT NULL,
  title         TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 40),
  cover_url     TEXT,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_story_highlights_user
  ON public.story_highlights (user_id, sort_order);

ALTER TABLE public.story_highlights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "story_highlights: read all" ON public.story_highlights;
CREATE POLICY "story_highlights: read all"
  ON public.story_highlights FOR SELECT USING (true);

DROP POLICY IF EXISTS "story_highlights: own write" ON public.story_highlights;
CREATE POLICY "story_highlights: own write"
  ON public.story_highlights FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.story_highlight_items (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  highlight_id  UUID        NOT NULL REFERENCES public.story_highlights(id) ON DELETE CASCADE,
  story_id      UUID        NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (highlight_id, story_id)
);

CREATE INDEX IF NOT EXISTS idx_story_highlight_items_highlight
  ON public.story_highlight_items (highlight_id, added_at DESC);

ALTER TABLE public.story_highlight_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "story_highlight_items: read all" ON public.story_highlight_items;
CREATE POLICY "story_highlight_items: read all"
  ON public.story_highlight_items FOR SELECT USING (true);

-- Writes gated to the highlight's owner (joins through to story_highlights).
DROP POLICY IF EXISTS "story_highlight_items: owner write" ON public.story_highlight_items;
CREATE POLICY "story_highlight_items: owner write"
  ON public.story_highlight_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.story_highlights sh
     WHERE sh.id = story_highlight_items.highlight_id
       AND sh.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.story_highlights sh
     WHERE sh.id = story_highlight_items.highlight_id
       AND sh.user_id = auth.uid()
  ));

NOTIFY pgrst, 'reload schema';
