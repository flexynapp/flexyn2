-- 107_user_mutes.sql
--
-- Soft "mute" for the Hub feed — hides a user's posts from your feed
-- without breaking any other surface. Distinct from block:
--   • Block (mig 106) — hides everything mutually, severs follows.
--   • Mute (here)     — hides their posts in YOUR feed only. They
--                       can still DM you, you can still visit their
--                       profile, follows are unaffected.
--
-- The "I follow them but their posts are exhausting right now" tool.
-- No server-side RLS hides — mute is a viewer-side filter applied
-- in HubFeed.jsx. The server just stores the list.

CREATE TABLE IF NOT EXISTS public.user_mutes (
  muter_id      UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  muter_email   TEXT         NOT NULL,
  muted_email   TEXT         NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (muter_id, muted_email)
);

CREATE INDEX IF NOT EXISTS idx_user_mutes_muter
  ON public.user_mutes(muter_id);

ALTER TABLE public.user_mutes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_mutes: owner read" ON public.user_mutes;
CREATE POLICY "user_mutes: owner read"
  ON public.user_mutes FOR SELECT
  TO authenticated
  USING (muter_id = auth.uid());

DROP POLICY IF EXISTS "user_mutes: owner insert" ON public.user_mutes;
CREATE POLICY "user_mutes: owner insert"
  ON public.user_mutes FOR INSERT
  TO authenticated
  WITH CHECK (muter_id = auth.uid());

DROP POLICY IF EXISTS "user_mutes: owner delete" ON public.user_mutes;
CREATE POLICY "user_mutes: owner delete"
  ON public.user_mutes FOR DELETE
  TO authenticated
  USING (muter_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.user_mutes TO authenticated;

NOTIFY pgrst, 'reload schema';
