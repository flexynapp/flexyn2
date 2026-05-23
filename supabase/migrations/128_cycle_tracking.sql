-- 128_cycle_tracking.sql
--
-- Period / cycle tracking. Strictly opt-in (off by default), private
-- to the owner (RLS), no friends/crew sharing. The data lives behind
-- the `cycle_tracking_enabled` flag on user_profiles — clients must
-- check the flag before reading from cycle_logs OR exposing any
-- cycle-related UI.
--
-- Storage shape: one row per period START. Cycle phases (follicular /
-- ovulation / luteal / menstrual) are computed client-side from the
-- two most recent period starts — no need to denormalize phases here
-- (they change every few days and would drift quickly).
--
-- Why no symptoms table or detailed flow log: this is the MVP. A
-- single period-start log is enough to compute the active phase and
-- power the workout-suggestion adapter. Symptoms / flow / mood
-- tracking can come later as add-on tables.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS cycle_tracking_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cycle_length_days      INTEGER;  -- user override, NULL = use the 28-day default

CREATE TABLE IF NOT EXISTS public.cycle_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, start_date)
);

CREATE INDEX IF NOT EXISTS cycle_logs_user_idx
  ON public.cycle_logs (user_id, start_date DESC);

ALTER TABLE public.cycle_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cycle_logs: read own"   ON public.cycle_logs;
DROP POLICY IF EXISTS "cycle_logs: write own"  ON public.cycle_logs;
DROP POLICY IF EXISTS "cycle_logs: delete own" ON public.cycle_logs;

-- Strict owner-only RLS. No public read; cycle data never leaves the
-- account even when other rows on user_profiles (username, total_xp)
-- do via the global User.list() leaderboard reads.
CREATE POLICY "cycle_logs: read own"
  ON public.cycle_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "cycle_logs: write own"
  ON public.cycle_logs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "cycle_logs: delete own"
  ON public.cycle_logs FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.cycle_logs TO authenticated;

NOTIFY pgrst, 'reload schema';
