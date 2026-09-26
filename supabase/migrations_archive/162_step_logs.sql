-- 162_step_logs.sql
--
-- Manual daily step tracking. Mirrors sleep_logs (mig 095) / mood_logs
-- (mig 096): one row per (user, date), upsert on date so re-logging the
-- same day overwrites instead of duplicating. Manual entry only — auto-sync
-- from a wearable is a separate, native-app effort.
--
-- One row per day keeps it time-series (for a future 7/14-day trend chart on
-- Progress, the same way sleep is charted), rather than a single-state column
-- on user_profiles.
--
-- Paste-safe + idempotent.

CREATE TABLE IF NOT EXISTS public.step_logs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT        NOT NULL,
  date       DATE        NOT NULL,
  steps      INTEGER     NOT NULL CHECK (steps >= 0 AND steps <= 200000),
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_step_logs_user_date
  ON public.step_logs (user_id, date DESC);

ALTER TABLE public.step_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "step_logs: owner full access" ON public.step_logs;
CREATE POLICY "step_logs: owner full access"
  ON public.step_logs FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
