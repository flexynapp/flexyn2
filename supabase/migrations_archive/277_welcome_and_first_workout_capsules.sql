-- 277_welcome_and_first_workout_capsules.sql
--
-- Two capsule grants that have never once landed.
--
-- `user_capsules` has no INSERT policy for `authenticated` — capsules are
-- created only by SECURITY DEFINER RPCs (grant_level_up_rewards mig 070,
-- grant_achievement_milestones, grant_streak_capsule, claim_daily_chest,
-- claim_referral). But two grants were still doing a bare client insert via
-- `_grantCapsule` in src/lib/data/capsules.js:
--
--   grantWelcomeCapsule    — Onboarding + LevelUpManager, the new-user capsule
--   grantForFirstWorkout   — Workout.jsx, premium capsule + 75 coins
--
-- Both return 42501 every time. Both callers are fire-and-forget with a
-- `.catch()` that reports to Sentry and shows the user nothing, so the reward
-- silently never arrived and nothing surfaced. Verified as a real
-- authenticated user before writing this:
--   SET LOCAL role authenticated + JWT claims → INSERT → 42501.
--
-- These two functions move the grants server-side, modelled on
-- grant_streak_capsule: derive the user from auth.uid(), lock the profile
-- row, check the idempotency marker, insert, mark. Nothing is trusted from
-- the client — neither function takes a user argument, so there is no
-- parameter to tamper with.
--
-- Idempotency markers, both pre-existing:
--   welcome        → "user has zero capsule rows" (same rule the client used)
--   first workout  → user_profiles.first_workout_capsule_granted
--
-- Safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- Welcome capsule — one standard capsule for a user who has none.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.grant_welcome_capsule()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      UUID := auth.uid();
  v_email    TEXT;
  v_existing INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Lock the profile row so two tabs opening at once can't both pass the
  -- "has no capsules" check and grant twice.
  SELECT email INTO v_email
    FROM public.user_profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_existing
    FROM public.user_capsules WHERE user_id = v_uid;

  IF v_existing > 0 THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'already_has_capsules');
  END IF;

  -- Guests carry email = '' on the auth row; user_profiles.email is the
  -- synthesized guest address. Rebuild it the same way db.js and
  -- grant_streak_capsule do so the row's user_email is never blank.
  IF v_email IS NULL OR v_email = '' THEN
    v_email := 'guest_' || v_uid || '@flexyn.guest';
  END IF;

  INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
  VALUES (v_uid, v_email, 'standard');

  RETURN jsonb_build_object('granted', true, 'capsule_type', 'standard');
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- First-workout capsule — one premium capsule + 75 Flex Coins, once ever.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.grant_first_workout_capsule()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     UUID := auth.uid();
  v_email   TEXT;
  v_already BOOLEAN;
  v_balance INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT email, COALESCE(first_workout_capsule_granted, FALSE)
    INTO v_email, v_already
    FROM public.user_profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = '22023';
  END IF;

  IF v_already THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'already_granted');
  END IF;

  IF v_email IS NULL OR v_email = '' THEN
    v_email := 'guest_' || v_uid || '@flexyn.guest';
  END IF;

  INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
  VALUES (v_uid, v_email, 'premium');

  -- Capsule, coins and the idempotency flag land in ONE transaction. The
  -- client used to do these as three independent writes, so a failure
  -- between them could grant the capsule and never set the flag — which
  -- re-granted on the next call, indefinitely. That race is now impossible.
  UPDATE public.user_profiles
     SET flex_coins = COALESCE(flex_coins, 0) + 75,
         first_workout_capsule_granted = TRUE
   WHERE id = v_uid
  RETURNING flex_coins INTO v_balance;

  RETURN jsonb_build_object(
    'granted',      true,
    'capsule_type', 'premium',
    'coins',        75,
    'new_balance',  v_balance
  );
END;
$function$;

-- Both derive the caller from auth.uid() and grant only to that caller, so
-- `authenticated` is the correct audience. PUBLIC is revoked anyway: every
-- public-schema function is a PostgREST endpoint, and `anon` has no business
-- reaching a SECURITY DEFINER grant even one that would immediately raise.
REVOKE ALL ON FUNCTION public.grant_welcome_capsule()       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_first_workout_capsule() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_welcome_capsule()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_first_workout_capsule() TO authenticated;
