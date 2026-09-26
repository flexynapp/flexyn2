-- Migration 045: Story media type + text overlay
--
-- overlay_text: optional text the poster added before uploading
-- media_type:   'image' or 'video' — lets the viewer render the right element

ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS overlay_text TEXT;
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS media_type   TEXT NOT NULL DEFAULT 'image';

NOTIFY pgrst, 'reload schema';
