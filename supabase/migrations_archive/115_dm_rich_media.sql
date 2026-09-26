-- 115_dm_rich_media.sql
--
-- Adds rich-media columns to hub_messages for batch 18c:
--
--   • message_type   TEXT — 'text' | 'sticker' | 'gif' | 'voice' | etc.
--                            Defaults to 'text' so the existing send path
--                            keeps working without callers needing to set
--                            anything explicitly.
--   • sticker_id     TEXT — present when message_type='sticker'; references
--                            an id from src/lib/lootCatalog.js ITEMS array.
--                            Not a foreign key (catalog lives in code, not
--                            in a DB table) — sanitized client-side.
--   • duration_ms    INTEGER — voice memo duration. Lets the renderer show
--                            "0:14" next to the play button without
--                            decoding the audio.
--
-- All three are NULLable / IF NOT EXISTS additive so an existing row
-- works unchanged.

ALTER TABLE public.hub_messages
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS sticker_id   TEXT,
  ADD COLUMN IF NOT EXISTS duration_ms  INTEGER;

-- Constraint: short whitelist of accepted message types. Future kinds
-- can extend this with a CREATE OR REPLACE-style rewrite (a migration
-- drops + re-adds the constraint with the new value list).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hub_messages_message_type_check'
  ) THEN
    ALTER TABLE public.hub_messages
      ADD CONSTRAINT hub_messages_message_type_check
      CHECK (message_type IN ('text', 'sticker', 'gif', 'voice'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
