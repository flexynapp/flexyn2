-- 095_sleep_tracking.sql
--
-- New domain: sleep + perceived-recovery tracking. One row per (user,
-- date) — what time they went to bed, how long they slept, quality
-- score 1-5, soreness 1-5. Drives the Recovery Score heuristic on
-- the Dashboard.
--
-- Why not derive sleep from workout logs?
-- ───────────────────────────────────────
-- Sleep is a separate signal from workouts. Plenty of users will
-- check in on sleep without logging a workout (rest days), and sleep
-- impacts performance via mechanisms (HRV, glycogen restoration)
-- the workout log can't see. Worth its own table.
--
-- Why a separate table, not a column on user_profiles?
-- ────────────────────────────────────────────────────
-- Sleep is time-series, not single-state. We want a 7-day rolling
-- average + week-over-week trend chart on the Progress page, which
-- requires history. user_profiles is for current state.

CREATE TABLE IF NOT EXISTS public.sleep_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email      TEXT        NOT NULL,
  date            DATE        NOT NULL,                       -- the night-of date (the morning the user logs it)
  hours           NUMERIC(3,1) NOT NULL,                       -- 0.0 - 24.0, decimal allowed (e.g. 7.5)
  quality         INTEGER     CHECK (quality IS NULL OR quality BETWEEN 1 AND 5),
  soreness        INTEGER     CHECK (soreness IS NULL OR soreness BETWEEN 1 AND 5),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_sleep_logs_user_date
  ON public.sleep_logs (user_id, date DESC);

ALTER TABLE public.sleep_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sleep_logs: owner full access" ON public.sleep_logs;
CREATE POLICY "sleep_logs: owner full access"
  ON public.sleep_logs FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- migration 085's ALTER DEFAULT PRIVILEGES grants service_role auto

NOTIFY pgrst, 'reload schema';
