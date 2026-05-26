-- 144_bio_and_dm_polls.sql
--
-- Two additions that support the audit fixes shipped in this session:
--
--   1. Ensure user_profiles.bio exists (added in mig 049 on some
--      deployments; this is idempotent — ADD COLUMN IF NOT EXISTS is
--      a no-op if the column is already present).
--
--   2. dm_polls — lets users send polls inside DM conversations.
--      One row per poll message. Votes are stored in dm_poll_votes
--      (one row per user per poll, updating in place on re-vote).
--      The schema mirrors the story-poll pattern from mig 112 but
--      scoped to hub_messages instead of stories.
--
-- RLS:
--   dm_polls     — conversation participants read; sender inserts.
--   dm_poll_votes— authenticated users vote on polls in their convs.

-- ── 1. Bio column ─────────────────────────────────────────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS bio TEXT;

-- ── 2. DM polls table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dm_polls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID NOT NULL REFERENCES public.hub_messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.hub_conversations(id) ON DELETE CASCADE,
  creator_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question        TEXT NOT NULL,
  options         JSONB NOT NULL DEFAULT '[]',   -- [{id, text}, ...]
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at         TIMESTAMPTZ,                   -- NULL = open forever
  UNIQUE (message_id)
);

CREATE INDEX IF NOT EXISTS dm_polls_conversation_idx
  ON public.dm_polls (conversation_id);

CREATE INDEX IF NOT EXISTS dm_polls_creator_idx
  ON public.dm_polls (creator_id);

-- ── 2a. DM poll votes ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dm_poll_votes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id    UUID NOT NULL REFERENCES public.dm_polls(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  option_id  TEXT NOT NULL,   -- matches options[].id in the poll row
  voted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (poll_id, user_id)   -- one vote per user per poll; UPDATE on re-vote
);

CREATE INDEX IF NOT EXISTS dm_poll_votes_poll_idx
  ON public.dm_poll_votes (poll_id);

-- ── 2b. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.dm_polls      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_poll_votes ENABLE ROW LEVEL SECURITY;

-- Polls: any conversation participant may read polls in their convs
DROP POLICY IF EXISTS "dm_polls: participant read"   ON public.dm_polls;
CREATE POLICY "dm_polls: participant read"
  ON public.dm_polls FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hub_conversations c
       WHERE c.id = dm_polls.conversation_id
         AND (auth.email() = ANY(c.participant_emails)
              OR auth.uid() = ANY(c.participant_ids))
    )
  );

-- Polls: only the creator may insert
DROP POLICY IF EXISTS "dm_polls: creator insert"     ON public.dm_polls;
CREATE POLICY "dm_polls: creator insert"
  ON public.dm_polls FOR INSERT TO authenticated
  WITH CHECK (creator_id = auth.uid());

-- Votes: participant may read all votes on polls they can see
DROP POLICY IF EXISTS "dm_poll_votes: participant read" ON public.dm_poll_votes;
CREATE POLICY "dm_poll_votes: participant read"
  ON public.dm_poll_votes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.dm_polls p
        JOIN public.hub_conversations c ON c.id = p.conversation_id
       WHERE p.id = dm_poll_votes.poll_id
         AND (auth.email() = ANY(c.participant_emails)
              OR auth.uid() = ANY(c.participant_ids))
    )
  );

-- Votes: own insert
DROP POLICY IF EXISTS "dm_poll_votes: own insert"    ON public.dm_poll_votes;
CREATE POLICY "dm_poll_votes: own insert"
  ON public.dm_poll_votes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Votes: own update (re-vote — changes option_id in place)
DROP POLICY IF EXISTS "dm_poll_votes: own update"    ON public.dm_poll_votes;
CREATE POLICY "dm_poll_votes: own update"
  ON public.dm_poll_votes FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- Votes: own delete (un-vote)
DROP POLICY IF EXISTS "dm_poll_votes: own delete"    ON public.dm_poll_votes;
CREATE POLICY "dm_poll_votes: own delete"
  ON public.dm_poll_votes FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT ON public.dm_polls TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dm_poll_votes TO authenticated;

-- ── 2c. cast_dm_poll_vote RPC ─────────────────────────────────────────────────
-- Atomic upsert so a re-vote replaces the previous choice rather than
-- erroring on the UNIQUE (poll_id, user_id) constraint.
CREATE OR REPLACE FUNCTION public.cast_dm_poll_vote(
  p_poll_id   UUID,
  p_option_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_poll_id IS NULL OR p_option_id IS NULL THEN
    RAISE EXCEPTION 'poll_id and option_id required' USING ERRCODE = '22023';
  END IF;
  -- Verify the caller is a participant of the poll's conversation
  IF NOT EXISTS (
    SELECT 1 FROM public.dm_polls p
      JOIN public.hub_conversations c ON c.id = p.conversation_id
     WHERE p.id = p_poll_id
       AND (auth.email() = ANY(c.participant_emails)
            OR v_uid = ANY(c.participant_ids))
  ) THEN
    RAISE EXCEPTION 'not a conversation participant' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.dm_poll_votes (poll_id, user_id, option_id)
  VALUES (p_poll_id, v_uid, p_option_id)
  ON CONFLICT (poll_id, user_id)
  DO UPDATE SET option_id = EXCLUDED.option_id, voted_at = now();
END;
$$;

REVOKE ALL    ON FUNCTION public.cast_dm_poll_vote(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cast_dm_poll_vote(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
