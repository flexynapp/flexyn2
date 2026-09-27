-- first_workout_capsule_granted becomes server-only.
--
-- grant_first_workout_capsule() pays a premium capsule and 75 flex coins and
-- its ONLY idempotency check is this flag. The flag was missing from the
-- user_profiles privileged-column guard, so a signed-in user could set it
-- back to FALSE with a plain PostgREST update and claim again, as often as
-- they liked. Capsules are uncapped. Found by the 2026-09-27 codebase audit
-- and confirmed on production.
--
-- A separate guard trigger, in the shape of guard_streak_capsule_marks,
-- rather than restating the 25-column user_profiles_block_privileged_updates.
-- The grant RPC runs SECURITY DEFINER as postgres, so it still sets the flag.
-- reset_my_profile_stats never touched this column, and the client reset no
-- longer sends it: the first-workout capsule is once per account.
--
-- The column list on the UPDATE trigger is the gate (see CLAUDE.md on
-- trigger column lists): it fires whenever the flag is in the SET clause,
-- which is the only way a client can change it.

CREATE OR REPLACE FUNCTION public.guard_first_workout_capsule_flag()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.first_workout_capsule_granted := FALSE;
    RETURN NEW;
  END IF;
  IF NEW.first_workout_capsule_granted IS DISTINCT FROM OLD.first_workout_capsule_granted THEN
    RAISE EXCEPTION 'first_workout_capsule_granted is RPC-only (use grant_first_workout_capsule)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_first_workout_capsule_flag() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_first_workout_capsule_flag_tr ON public.user_profiles;
CREATE TRIGGER guard_first_workout_capsule_flag_tr
  BEFORE INSERT OR UPDATE OF first_workout_capsule_granted ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_first_workout_capsule_flag();

-- Prove it, as a real signed-in user on their own row: clearing the flag is
-- refused, and an ordinary profile edit in the same shape still saves.
DO $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT id INTO v_uid FROM public.user_profiles LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE 'no profiles on this database; skipping the self-test';
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.user_profiles
       SET first_workout_capsule_granted = NOT COALESCE(first_workout_capsule_granted, FALSE)
     WHERE id = v_uid;
    RESET ROLE;
    RAISE EXCEPTION 'a signed-in user could still flip first_workout_capsule_granted';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;

  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.user_profiles SET bio = bio WHERE id = v_uid;
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'probe_rollback';
  EXCEPTION WHEN raise_exception THEN
    RESET ROLE;
    IF SQLERRM <> 'probe_rollback' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claims', '', true);
END
$$;
