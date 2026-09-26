-- 266_capsule_mint_lockdown.sql
--
-- Fixes L1 and L4 from docs/loot-system-audit-2026-07-29.md, plus L5 while
-- in the same place.
--
-- ── Correction to the audit ──────────────────────────────────────────────
--
-- The audit said L1 was "one statement, nothing legitimate breaks". That was
-- wrong. THREE client paths insert into user_capsules today:
--
--   src/lib/data/loginStreak.js:207   elite capsule on streak day 30/60/100
--   src/lib/data/workoutStreak.js:160 same, for the workout streak
--   src/components/hub/CoinShopModal.jsx:99  an "admin" sandbox bypass
--
-- The first two are real features. Revoking INSERT without replacing them
-- would silently stop milestone capsules from ever being granted — the code
-- already swallows the error into a console.warn, so it would have failed
-- quietly rather than loudly. So this migration adds a server-validated
-- replacement first, then revokes.
--
-- The third is itself a second instance of L1. CoinShopModal grants free
-- capsules when the username OR THE EMAIL LOCAL PART is in a hardcoded list
-- (`kegan`, `sean`, `admin`, …). Anyone who signs up as admin@anything.com
-- passes that check. A client-side privilege test is not a security
-- boundary; that path is deleted in the same commit rather than ported.
--
-- ── L1: capsules become mint-by-RPC-only ─────────────────────────────────
--
-- authenticated held INSERT on user_capsules with an own-rows policy, so
-- POST /rest/v1/user_capsules minted Elite Capsules — 1,000 coins each, the
-- priciest item in the game — for free. Verified against production before
-- writing this.
--
-- grant_streak_capsule below is the replacement. It reads the streak off
-- user_profiles rather than trusting a client-supplied day, checks the day is
-- a real milestone, and uses a high-water mark so repeat calls on the same
-- milestone are no-ops. Same shape as level_capsules_awarded_through.
--
-- ── L4: TRUNCATE ─────────────────────────────────────────────────────────
--
-- authenticated held TRUNCATE on user_capsules and user_inventory, and anon
-- held it on user_capsules. TRUNCATE ignores RLS, so the privilege means
-- "wipe every user's items". Not reachable through PostgREST — no REST verb
-- maps to TRUNCATE — so this is cleanup of a Supabase default GRANT ALL that
-- was never narrowed, not an emergency.
--
-- ── L5: dead policies ────────────────────────────────────────────────────
--
-- user_inventory has INSERT and UPDATE policies with no matching grants, so
-- they can never fire. Dropped so nobody reads them as evidence that client
-- writes are supported.
--
-- Paste-safety: no dotted alias.column or record .id tokens (CLAUDE.md §7).

-- ── High-water marks for streak capsule grants ───────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS login_streak_capsule_through   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS workout_streak_capsule_through INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.user_profiles.login_streak_capsule_through IS
  'Highest login-streak day already paid a milestone capsule. Guards grant_streak_capsule against repeat calls.';
COMMENT ON COLUMN public.user_profiles.workout_streak_capsule_through IS
  'Highest workout-streak day already paid a milestone capsule.';

-- Backfill: anyone already past a milestone has been granted under the old
-- client path, so mark them paid to their current streak rather than handing
-- out a second capsule on the next login.
UPDATE public.user_profiles
   SET login_streak_capsule_through   = GREATEST(COALESCE(login_streak, 0), 0),
       workout_streak_capsule_through = GREATEST(COALESCE(workout_streak, 0), 0)
 WHERE COALESCE(login_streak, 0) > 0
    OR COALESCE(workout_streak, 0) > 0;

-- ── Server-validated milestone capsule grant ─────────────────────────────
CREATE OR REPLACE FUNCTION public.grant_streak_capsule(p_kind text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $grant_streak_capsule$
DECLARE
  v_uid     UUID := auth.uid();
  v_email   TEXT;
  v_day     INTEGER;
  v_through INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('login', 'workout') THEN
    RAISE EXCEPTION 'kind must be login or workout' USING ERRCODE = '22023';
  END IF;

  -- The streak day comes from the row, never from the caller.
  IF p_kind = 'login' THEN
    SELECT COALESCE(login_streak, 0), COALESCE(login_streak_capsule_through, 0), email
      INTO v_day, v_through, v_email
      FROM public.user_profiles WHERE id = v_uid FOR UPDATE;
  ELSE
    SELECT COALESCE(workout_streak, 0), COALESCE(workout_streak_capsule_through, 0), email
      INTO v_day, v_through, v_email
      FROM public.user_profiles WHERE id = v_uid FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = '22023';
  END IF;

  -- Milestone days only, matching eliteCapsuleOnStreakDay /
  -- eliteCapsuleOnWorkoutStreakDay in the client.
  IF v_day NOT IN (30, 60, 100) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'not_a_milestone', 'day', v_day);
  END IF;

  -- Already paid for this milestone (or a later one).
  IF v_through >= v_day THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'already_granted', 'day', v_day);
  END IF;

  IF v_email IS NULL OR v_email = '' THEN
    v_email := 'guest_' || v_uid || '@flexyn.guest';
  END IF;

  INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
  VALUES (v_uid, v_email, 'elite');

  IF p_kind = 'login' THEN
    UPDATE public.user_profiles SET login_streak_capsule_through = v_day WHERE id = v_uid;
  ELSE
    UPDATE public.user_profiles SET workout_streak_capsule_through = v_day WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object('granted', true, 'capsule_type', 'elite', 'day', v_day);
END;
$grant_streak_capsule$;

REVOKE ALL ON FUNCTION public.grant_streak_capsule(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_streak_capsule(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.grant_streak_capsule(text) TO authenticated;

-- The new high-water columns must not be client-writable either, or the
-- idempotency guard is bypassable. Migration 142's guard covers a fixed list
-- of columns, so these get their own check.
CREATE OR REPLACE FUNCTION public.guard_streak_capsule_marks()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $guard_streak_capsule_marks$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN RETURN NEW; END IF;
  IF NEW.login_streak_capsule_through IS DISTINCT FROM OLD.login_streak_capsule_through THEN
    RAISE EXCEPTION 'login_streak_capsule_through is RPC-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.workout_streak_capsule_through IS DISTINCT FROM OLD.workout_streak_capsule_through THEN
    RAISE EXCEPTION 'workout_streak_capsule_through is RPC-only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$guard_streak_capsule_marks$;

DROP TRIGGER IF EXISTS guard_streak_capsule_marks_tr ON public.user_profiles;
CREATE TRIGGER guard_streak_capsule_marks_tr
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_streak_capsule_marks();

-- ── L1: revoke the mint ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "capsules: users can insert own capsules" ON public.user_capsules;

REVOKE INSERT ON public.user_capsules FROM authenticated;
REVOKE INSERT ON public.user_capsules FROM anon;
REVOKE INSERT ON public.user_capsules FROM PUBLIC;

-- ── L4: revoke TRUNCATE ──────────────────────────────────────────────────
REVOKE TRUNCATE ON public.user_capsules  FROM authenticated;
REVOKE TRUNCATE ON public.user_capsules  FROM anon;
REVOKE TRUNCATE ON public.user_capsules  FROM PUBLIC;
REVOKE TRUNCATE ON public.user_inventory FROM authenticated;
REVOKE TRUNCATE ON public.user_inventory FROM anon;
REVOKE TRUNCATE ON public.user_inventory FROM PUBLIC;

-- ── L5: drop policies that can never fire ────────────────────────────────
DROP POLICY IF EXISTS "inventory: users can insert own items" ON public.user_inventory;
DROP POLICY IF EXISTS "inventory: users can update own items" ON public.user_inventory;

NOTIFY pgrst, 'reload schema';
