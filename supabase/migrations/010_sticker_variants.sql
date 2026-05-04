-- 010_sticker_variants.sql
-- Add variant column to user_inventory
-- Create post_sticker_reactions table

ALTER TABLE user_inventory
  ADD COLUMN IF NOT EXISTS variant TEXT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS post_sticker_reactions (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id         UUID        NOT NULL,
  user_id         UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  user_email      TEXT        NOT NULL,
  user_name       TEXT,
  user_avatar_url TEXT,
  item_id         TEXT        NOT NULL,
  item_emoji      TEXT        NOT NULL,
  item_rarity     TEXT        NOT NULL DEFAULT 'common',
  variant         TEXT        DEFAULT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(post_id, user_id)
);

ALTER TABLE post_sticker_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_sticker_reactions"
  ON post_sticker_reactions FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "users_manage_own_sticker_reactions"
  ON post_sticker_reactions FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
