-- 111_story_overlays.sql
--
-- Persistent overlays on stories — extends the composer past a single
-- text overlay (the StoryPreviewSheet's current state) into a multi-
-- overlay model that supports text, owned stickers, and emoji.
--
-- Schema:
--   overlays JSONB — array of { kind, x, y, scale, rotation, ...props }
--     kind = 'text'    → { text, color, font }
--     kind = 'sticker' → { stickerId, label }
--     kind = 'emoji'   → { emoji }
--
-- Coordinates (x, y) are normalized 0..1 relative to the story
-- container so a story rendered at any aspect ratio renders the
-- overlays in the same relative position.
--
-- The 18 KB JSONB cap is intentional — generous enough for ~50
-- overlays at a few hundred bytes each, but small enough that a
-- malicious client can't bloat the row. Server enforces via CHECK.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + DO-block CHECK guard for
-- safe re-apply.

ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS overlays JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stories_overlays_check'
  ) THEN
    ALTER TABLE public.stories
      ADD CONSTRAINT stories_overlays_check
      CHECK (
        jsonb_typeof(overlays) = 'array'
        AND octet_length(overlays::text) <= 18432  -- 18 KB
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
