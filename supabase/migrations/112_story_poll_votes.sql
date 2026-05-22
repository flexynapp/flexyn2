-- 112_story_poll_votes.sql
--
-- Backing table for poll-overlay voting on stories. Migration 111
-- introduced the `overlays` JSONB column; this migration enables one
-- of the planned overlay kinds:
--
--   { kind: 'poll', question, options: [{ id, label }], x, y }
--
-- Each viewer can vote ONCE per story; the unique constraint on
-- (story_id, voter_id) enforces that server-side so a malicious
-- client can't stuff the box.
--
-- Countdown timers (the other 17c overlay kind) don't need a backing
-- table — they're purely render-side ("ends in 2d 4h" ticker).

CREATE TABLE IF NOT EXISTS public.story_poll_votes (
  story_id   UUID         NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  voter_id   UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  option_id  TEXT         NOT NULL,
  voted_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, voter_id)
);

CREATE INDEX IF NOT EXISTS idx_story_poll_votes_story
  ON public.story_poll_votes(story_id);

ALTER TABLE public.story_poll_votes ENABLE ROW LEVEL SECURITY;

-- Anyone can SEE the votes — needed for the live "63% chose A" bars
-- shown to viewers after they cast their own vote. Pre-vote the
-- client just shows the option labels; post-vote it fetches the
-- aggregate counts.
DROP POLICY IF EXISTS "story_poll_votes: public read" ON public.story_poll_votes;
CREATE POLICY "story_poll_votes: public read"
  ON public.story_poll_votes FOR SELECT
  TO authenticated
  USING (true);

-- Insert: only your own row, only via the RPC (which upserts so a
-- "change my vote" tap doesn't error out).
DROP POLICY IF EXISTS "story_poll_votes: own insert" ON public.story_poll_votes;
CREATE POLICY "story_poll_votes: own insert"
  ON public.story_poll_votes FOR INSERT
  TO authenticated
  WITH CHECK (voter_id = auth.uid());

DROP POLICY IF EXISTS "story_poll_votes: own update" ON public.story_poll_votes;
CREATE POLICY "story_poll_votes: own update"
  ON public.story_poll_votes FOR UPDATE
  TO authenticated
  USING (voter_id = auth.uid());

-- No DELETE — once you've voted, you can change but not erase.
GRANT SELECT, INSERT, UPDATE ON public.story_poll_votes TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Atomic vote RPC. Upsert so the user can change their vote (the
-- option_id swaps), but the (story_id, voter_id) PK guarantees the
-- count stays correct even under concurrent retries.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cast_story_poll_vote(
  p_story_id   UUID,
  p_option_id  TEXT
) RETURNS VOID
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
  IF p_story_id IS NULL OR p_option_id IS NULL OR length(p_option_id) = 0 THEN
    RAISE EXCEPTION 'invalid_args' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.story_poll_votes (story_id, voter_id, option_id)
  VALUES (p_story_id, v_uid, p_option_id)
  ON CONFLICT (story_id, voter_id)
  DO UPDATE SET option_id = EXCLUDED.option_id, voted_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.cast_story_poll_vote(UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Aggregate-counts helper. Returns { option_id, count } rows for a
-- single story's poll. Used by the viewer to render results bars
-- after the user has cast their vote (or always, if the story owner).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.story_poll_results(
  p_story_id UUID
) RETURNS TABLE (
  option_id TEXT,
  vote_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT option_id, COUNT(*)::bigint
    FROM public.story_poll_votes
   WHERE story_id = p_story_id
   GROUP BY option_id;
$$;

GRANT EXECUTE ON FUNCTION public.story_poll_results(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
