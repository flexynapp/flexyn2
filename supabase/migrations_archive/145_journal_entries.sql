-- 145_journal_entries.sql
--
-- "My Journal" overhaul — moves the journal from a localStorage-only
-- textarea to a server-backed entry per day so it survives sign-out,
-- syncs across devices, and can hold a title + markdown body +
-- attachments.
--
-- One row per (user, entry_date). Upsert on that pair. Attachments are
-- stored as a JSONB array of { url, type, name } pointing at the
-- existing `avatars` Storage bucket (same bucket the gym/profile
-- uploads use; its RLS already gates writes on auth.uid()).
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.journal_entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user_email  TEXT,
    entry_date  DATE NOT NULL,
    title       TEXT,
    body        TEXT,                              -- markdown
    attachments JSONB NOT NULL DEFAULT '[]',       -- [{ url, type, name }]
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, entry_date)
);

CREATE INDEX IF NOT EXISTS journal_entries_user_date_idx
  ON public.journal_entries (user_id, entry_date DESC);

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "journal: owner select" ON public.journal_entries;
DROP POLICY IF EXISTS "journal: owner insert" ON public.journal_entries;
DROP POLICY IF EXISTS "journal: owner update" ON public.journal_entries;
DROP POLICY IF EXISTS "journal: owner delete" ON public.journal_entries;

CREATE POLICY "journal: owner select"
  ON public.journal_entries FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "journal: owner insert"
  ON public.journal_entries FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "journal: owner update"
  ON public.journal_entries FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "journal: owner delete"
  ON public.journal_entries FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_entries TO authenticated;

NOTIFY pgrst, 'reload schema';
