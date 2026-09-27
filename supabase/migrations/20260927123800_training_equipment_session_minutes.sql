-- Remember where a user trains and how long a session is (archived 384,
-- returning through the pipeline).
--
-- Archived migration 384 was written 2026-09 alongside the onboarding change
-- that asks both questions, and was never applied to production: measured
-- 2026-09-27, neither column exists. Since then every onboarding save has
-- sent training_equipment and session_minutes (onboardingProfile.js), and
-- db.js's strip-and-retry has silently dropped both, so the AI Coach's quick
-- generator (WorkoutQuickGenerator.jsx) has fallen back to a full gym and
-- 45 minutes for everyone.
--
-- Values match the Coach's picker ids and onboarding's chips
-- (TRAINING_EQUIPMENT / SESSION_MINUTES in src/lib/data/starterRegimen.js).
-- NULL means the user skipped the question. Neither column is privileged,
-- so the client writes them directly through updateMe like fitness_level.
-- Existing users stay NULL: their answers were never stored, so there is
-- nothing to backfill.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS training_equipment TEXT,
  ADD COLUMN IF NOT EXISTS session_minutes INTEGER;

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_training_equipment_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_training_equipment_check
  CHECK (training_equipment IS NULL OR training_equipment IN ('gym', 'dumbbells', 'minimal', 'bodyweight'));

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_session_minutes_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_session_minutes_check
  CHECK (session_minutes IS NULL OR session_minutes BETWEEN 10 AND 180);

-- Attempt the writes rather than inspect the catalog: a good value saves and
-- a bad one is refused. Everything is rolled back.
DO $$
DECLARE
  v_uid uuid;
  v_ok  boolean := false;
BEGIN
  SELECT id INTO v_uid FROM public.user_profiles LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE 'training_equipment: no profiles to probe against, skipped';
    RETURN;
  END IF;
  BEGIN
    UPDATE public.user_profiles SET training_equipment = 'dumbbells', session_minutes = 45 WHERE id = v_uid;
    BEGIN
      UPDATE public.user_profiles SET training_equipment = 'spaceship' WHERE id = v_uid;
    EXCEPTION WHEN check_violation THEN
      v_ok := true;
    END;
    RAISE EXCEPTION 'rollback_probe';
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'training_equipment: the equipment check did not refuse a bad value';
  END IF;
  RAISE NOTICE 'training_equipment: good value saved, bad value refused, probe rolled back';
END $$;

SELECT count(*) AS profiles, count(training_equipment) AS with_equipment, count(session_minutes) AS with_minutes
FROM public.user_profiles;
