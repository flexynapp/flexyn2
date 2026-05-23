-- 129_fitness_assessment.sql
--
-- 4-question fitness self-assessment captured in onboarding. The
-- starter regimen builder reads these signals to tune sets / reps /
-- exercise selection beyond what fitness_level alone says.
--
-- Storage: a single JSONB blob on user_profiles. Schema (all keys
-- optional; missing = "didn't answer"):
--   {
--     bench_bw:      'yes' | 'no' | 'not_yet' | null,
--     squat_bw15:    'yes' | 'no' | 'not_yet' | null,
--     pullups_10:    'yes' | 'no' | 'not_yet' | null,
--     mile_under10:  'yes' | 'no' | 'not_yet' | null
--   }
--
-- JSONB keeps this extensible — future assessments add keys without
-- a schema migration. The default '{}' so unauthenticated reads
-- (rare for this column) never return NULL.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS fitness_assessment JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
