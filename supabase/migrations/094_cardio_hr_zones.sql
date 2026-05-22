-- 094_cardio_hr_zones.sql
--
-- Extends cardio_logs with HR-zone time-in-zone tracking. Standard
-- 5-zone model from sport science:
--
--   Zone 1  50-60% max HR  recovery
--   Zone 2  60-70% max HR  aerobic / base
--   Zone 3  70-80% max HR  tempo
--   Zone 4  80-90% max HR  threshold
--   Zone 5  90-100% max HR VO2max / sprint
--
-- Each zone column holds MINUTES spent in that zone for the session.
-- Sum may exceed duration_min if the user logs overlapping ranges —
-- the client validates that sum ≤ duration_min before saving.
--
-- Optional max_hr column on user_profiles is the user's measured /
-- estimated maximum heart rate, used to color-code zone displays.
-- A reasonable default is 220 − age, but we let users override.

ALTER TABLE public.cardio_logs
  ADD COLUMN IF NOT EXISTS hr_zone1_min INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hr_zone2_min INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hr_zone3_min INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hr_zone4_min INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hr_zone5_min INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_hr_bpm   INTEGER,
  ADD COLUMN IF NOT EXISTS max_hr_bpm   INTEGER;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS max_hr_bpm INTEGER;

NOTIFY pgrst, 'reload schema';
