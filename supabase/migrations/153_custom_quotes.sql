-- 153_custom_quotes.sql
--
-- User-authored "quote of the day" entries (up to 20) that cycle into the
-- Dashboard quote rotation alongside the built-in pool. One row per quote,
-- owned by the author, synced across their devices.
--
-- The 20-cap is enforced client-side + in the data layer (quotes carry no
-- economy/abuse weight, so a hard server trigger would be overkill).
-- Paste-safe: bare columns, public.<table>, auth.uid(); no dotted record
-- or alias.column tokens. Idempotent.

CREATE TABLE IF NOT EXISTS public.custom_quotes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  author     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS custom_quotes_user_idx
  ON public.custom_quotes (user_id, created_at);

ALTER TABLE public.custom_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "custom_quotes: owner all" ON public.custom_quotes;
CREATE POLICY "custom_quotes: owner all"
  ON public.custom_quotes FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.custom_quotes TO authenticated;

NOTIFY pgrst, 'reload schema';
