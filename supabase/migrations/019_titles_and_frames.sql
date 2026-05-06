-- Migration 019: Profile Titles + Profile Frames
--
-- Two new loot types beyond stickers and themes:
--   • Titles — text label shown under the user's @handle (e.g. "Iron Will")
--   • Frames — animated/colored border around the avatar
--
-- Stored as a single equipped_id per type on user_profiles. The full set of
-- owned titles/frames lives in the user_inventory table (already exists)
-- with item_type = 'title' or 'frame'.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS equipped_title_id TEXT,
  ADD COLUMN IF NOT EXISTS equipped_frame_id TEXT;

-- Force PostgREST to refresh its schema cache so the JS client sees these
-- columns immediately after the migration runs.
NOTIFY pgrst, 'reload schema';
