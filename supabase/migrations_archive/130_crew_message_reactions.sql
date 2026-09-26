-- 130_crew_message_reactions.sql
--
-- Formalises the crew_message_reactions table that CrewMessageItem.jsx
-- already references (with a graceful try/catch in case it didn't exist).
-- Adds a SECURITY DEFINER toggle_crew_reaction RPC so the client never
-- needs to delete rows directly (no RLS ownership headaches).
--
-- Column name: `emoji` (TEXT) — mirrors dm_message_reactions so the two
-- tables are structurally identical and the data layer is easy to share.
-- The column was previously called `reaction` in the informal code; this
-- migration creates the authoritative schema.

CREATE TABLE IF NOT EXISTS public.crew_message_reactions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID        NOT NULL
                REFERENCES public.crew_messages(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL
                REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji       TEXT        NOT NULL CHECK (char_length(emoji) <= 10),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_crew_msg_rxns_msg
  ON public.crew_message_reactions(message_id);

ALTER TABLE public.crew_message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crew_rxns_select" ON public.crew_message_reactions;
CREATE POLICY "crew_rxns_select" ON public.crew_message_reactions
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "crew_rxns_insert" ON public.crew_message_reactions;
CREATE POLICY "crew_rxns_insert" ON public.crew_message_reactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "crew_rxns_delete" ON public.crew_message_reactions;
CREATE POLICY "crew_rxns_delete" ON public.crew_message_reactions
  FOR DELETE USING (auth.uid() = user_id);

GRANT SELECT, INSERT, DELETE
  ON public.crew_message_reactions TO authenticated;

-- ── toggle_crew_reaction ──────────────────────────────────────────────
-- Atomically adds or removes a single emoji reaction.
-- Returns TRUE if the reaction now exists, FALSE if it was removed.

CREATE OR REPLACE FUNCTION public.toggle_crew_reaction(
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
  IF p_message_id IS NULL OR p_user_id IS NULL OR p_emoji IS NULL THEN
    RAISE EXCEPTION 'all arguments required' USING ERRCODE = '22023';
  END IF;
  IF char_length(p_emoji) > 10 THEN
    RAISE EXCEPTION 'emoji too long' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.crew_message_reactions
     WHERE message_id = p_message_id
       AND user_id    = p_user_id
       AND emoji      = p_emoji
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM public.crew_message_reactions
     WHERE message_id = p_message_id
       AND user_id    = p_user_id
       AND emoji      = p_emoji;
    RETURN FALSE;
  ELSE
    INSERT INTO public.crew_message_reactions (message_id, user_id, emoji)
    VALUES (p_message_id, p_user_id, p_emoji)
    ON CONFLICT DO NOTHING;
    RETURN TRUE;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_crew_reaction(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_crew_reaction(UUID, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
