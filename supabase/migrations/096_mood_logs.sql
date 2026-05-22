-- 096_mood_logs.sql
--
-- Daily mood tracker. Single-emoji choice (😩😐🙂😄🔥) stored as an
-- integer 1-5 with optional notes. One row per (user, date). Powers
-- the Dashboard mood card + a mood-vs-volume correlation chart on
-- the Progress page.
--
-- Why an integer not a string? The five-tier mood ladder maps cleanly
-- to 1-5 and lets us correlate with workout volume, sleep quality,
-- and soreness numerically without a lookup table.

CREATE TABLE IF NOT EXISTS public.mood_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email  TEXT        NOT NULL,
  date        DATE        NOT NULL,
  mood        INTEGER     NOT NULL CHECK (mood BETWEEN 1 AND 5),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_mood_logs_user_date
  ON public.mood_logs (user_id, date DESC);

ALTER TABLE public.mood_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mood_logs: owner full access" ON public.mood_logs;
CREATE POLICY "mood_logs: owner full access"
  ON public.mood_logs FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
