-- 384: remember where a user trains and how long a session is.
--
-- Onboarding's sharpen step now asks both. The starter plan uses the answers
-- at the moment it is built; these columns let the AI Coach's quick generator
-- start from the same answers instead of assuming a full gym and 45 minutes.
--
-- Values match the Coach's own picker ids (EQUIPMENT_OPTIONS and
-- DURATION_OPTIONS in src/lib/aiCoach/workoutGenerator.js). NULL means the
-- user skipped the question. Neither column is privileged, so the client
-- writes them directly through updateMe like fitness_level.

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
    RAISE NOTICE '384: no profiles to probe against, skipped';
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
    RAISE EXCEPTION '384: the equipment check did not refuse a bad value';
  END IF;
  RAISE NOTICE '384: good value saved, bad value refused, probe rolled back';
END $$;

SELECT count(*) AS profiles, count(training_equipment) AS with_equipment, count(session_minutes) AS with_minutes
FROM public.user_profiles;
