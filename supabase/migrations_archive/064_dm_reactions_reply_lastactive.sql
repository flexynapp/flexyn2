-- 064: DM emoji reactions, inline reply columns, last_active_at
-- ─────────────────────────────────────────────────────────────────────────────

-- ① Emoji reactions on DM messages
CREATE TABLE IF NOT EXISTS dm_message_reactions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID        NOT NULL REFERENCES hub_messages(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji       TEXT        NOT NULL CHECK (char_length(emoji) <= 10),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_dm_msg_rxns_msg ON dm_message_reactions(message_id);

ALTER TABLE dm_message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dm_rxns_select" ON dm_message_reactions;
CREATE POLICY "dm_rxns_select" ON dm_message_reactions
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "dm_rxns_insert" ON dm_message_reactions;
CREATE POLICY "dm_rxns_insert" ON dm_message_reactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "dm_rxns_delete" ON dm_message_reactions;
CREATE POLICY "dm_rxns_delete" ON dm_message_reactions
  FOR DELETE USING (auth.uid() = user_id);

-- toggle_dm_reaction RPC
CREATE OR REPLACE FUNCTION toggle_dm_reaction(
  p_message_id UUID,
  p_user_id    UUID,
  p_emoji      TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM dm_message_reactions
    WHERE message_id = p_message_id AND user_id = p_user_id AND emoji = p_emoji
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM dm_message_reactions
    WHERE message_id = p_message_id AND user_id = p_user_id AND emoji = p_emoji;
    RETURN FALSE;
  ELSE
    INSERT INTO dm_message_reactions(message_id, user_id, emoji)
    VALUES (p_message_id, p_user_id, p_emoji)
    ON CONFLICT DO NOTHING;
    RETURN TRUE;
  END IF;
END;
$$;

-- ② Inline reply columns on hub_messages
ALTER TABLE hub_messages
  ADD COLUMN IF NOT EXISTS replied_to_message_id UUID REFERENCES hub_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replied_to_snippet     TEXT;

-- ③ last_active_at on user_profiles
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
