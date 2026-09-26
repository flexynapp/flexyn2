-- 133_body_metrics_measurements.sql
--
-- Adds circumference measurement columns to body_metrics so the
-- onboarding body-baseline step and Progress tab can store
-- waist / chest / hip alongside the existing weight + body-fat.
--
-- All nullable — existing rows are unaffected (NULL = not recorded).

ALTER TABLE public.body_metrics
  ADD COLUMN IF NOT EXISTS waist_cm NUMERIC,
  ADD COLUMN IF NOT EXISTS chest_cm NUMERIC,
  ADD COLUMN IF NOT EXISTS hip_cm   NUMERIC;

NOTIFY pgrst, 'reload schema';
