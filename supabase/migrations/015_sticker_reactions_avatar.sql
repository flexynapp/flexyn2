-- Migration 015: Add user_avatar_url + user_name to post_sticker_reactions
--
-- Background: post_sticker_reactions was created by an early seed script
-- without these columns. Migration 010's CREATE TABLE IF NOT EXISTS was a
-- no-op. Migration 011 added item_rarity + item_name. This migration adds
-- the remaining columns reactWithSticker() writes:
--   - user_avatar_url (the actual error from the screenshot)
--   - user_name (for display in reaction lists; may already exist via 011)
--
-- Symptom before this migration:
--   "Could not find the 'user_avatar_url' column of 'post_sticker_reactions'
--    in the schema cache"  →  reactions silently fail
--
-- Safe to re-run: IF NOT EXISTS guards prevent duplicate-column errors.

ALTER TABLE public.post_sticker_reactions
  ADD COLUMN IF NOT EXISTS user_avatar_url TEXT;

ALTER TABLE public.post_sticker_reactions
  ADD COLUMN IF NOT EXISTS user_name TEXT;

-- Force PostgREST to refresh its schema cache so the new columns are
-- immediately visible to the JS client without a manual reload.
NOTIFY pgrst, 'reload schema';
