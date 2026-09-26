-- 331_weekly_review_one_body.sql
--
-- ONE body for the weekly review, callable two ways.
--
-- WHY
-- ---
-- The review was computed twice: once in SQL by generate_my_weekly_review,
-- and once in TypeScript by the generateWeeklyDebriefs Edge Function, which
-- carried its own volume sum, its own XP formula (sets*12 + rep tiers), its
-- own muscle-group keyword matcher and its own PR detection. The two
-- disagreed. Whichever ran last won, so the same week showed different
-- numbers depending on whether you opened the app or the Sunday cron fired —
-- and the cron would have overwritten a correct review with worse figures.
-- That is why the cron was left unscheduled rather than simply re-added.
--
-- Porting the v2 formula into TypeScript would recreate the divergence one
-- release later. Instead the body moves to a single function that takes the
-- user as a parameter, and both callers go through it:
--
--   generate_weekly_review_for(p_user_id, p_week_start)   <- CANONICAL body
--   generate_my_weekly_review(p_week_start)               <- wrapper, auth.uid()
--   generate_my_weekly_debrief(p_week_start)              <- v1 name, forwards
--
-- **Edit generate_weekly_review_for. The other two are one-liners.**
--
-- SECURITY
-- --------
-- generate_weekly_review_for takes the user as a PARAMETER, which the
-- invariants section of CLAUDE.md warns about — a SECURITY DEFINER function
-- must normally derive the user from auth.uid(). It is safe here only because
-- it is REVOKED from anon and authenticated, so the sole callers are
-- service_role (the Edge Function) and the wrapper, which binds auth.uid()
-- itself. Without that REVOKE any signed-in user could regenerate — and
-- therefore overwrite — any other user's review. This mirrors the REVOKE on
-- fire_scheduled_workout_reminders in migration 276, which is load-bearing
-- for the same reason. Verified after applying: `get_advisors` lists
-- generate_my_weekly_review under authenticated_security_definer_function_
-- executable (expected, it derives from auth.uid()) and does NOT list
-- generate_weekly_review_for at all.
--
-- HOW THE BODY IS MOVED
-- --------------------
-- By transforming the INSTALLED function rather than restating 500 lines,
-- because retyping it is the one way to make the two versions differ, which
-- is the exact defect this migration exists to remove. The transform is
-- guarded four ways: the source must exist, the signature anchor must match,
-- the auth.uid() anchor must match, and no auth.uid() may survive in the
-- result. It also refuses to run twice — after this migration
-- generate_my_weekly_review IS the wrapper, and transforming a wrapper into
-- the canonical function would destroy the real body.
--
-- Prerequisite: migrations 328 and 330 must have been applied.

DO $mig$
DECLARE src TEXT; forsrc TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'generate_my_weekly_review';

  IF src IS NULL THEN
    RAISE EXCEPTION 'generate_my_weekly_review not installed — apply 328 and 330 first';
  END IF;

  IF position('generate_weekly_review_for' in src) > 0 THEN
    RAISE EXCEPTION 'already extracted — generate_weekly_review_for is canonical, edit that instead';
  END IF;

  forsrc := replace(src,
    'FUNCTION public.generate_my_weekly_review(p_week_start date DEFAULT NULL::date)',
    'FUNCTION public.generate_weekly_review_for(p_user_id uuid, p_week_start date DEFAULT NULL::date)');
  IF forsrc = src THEN RAISE EXCEPTION 'signature anchor missed'; END IF;

  src := forsrc;
  forsrc := replace(src,
    'v_user_id        UUID := auth.uid();',
    'v_user_id        UUID := p_user_id;');
  IF forsrc = src THEN RAISE EXCEPTION 'auth.uid() anchor missed'; END IF;

  IF position('auth.uid()' in forsrc) > 0 THEN
    RAISE EXCEPTION 'auth.uid() still present in the _for body — refusing to install';
  END IF;

  EXECUTE forsrc;
END
$mig$;

-- The client path. Everything it used to do now lives one call away.
CREATE OR REPLACE FUNCTION public.generate_my_weekly_review(p_week_start DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $w$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  RETURN public.generate_weekly_review_for(auth.uid(), p_week_start);
END;
$w$;

-- service_role only — see SECURITY above. Not negotiable.
REVOKE ALL ON FUNCTION public.generate_weekly_review_for(uuid, date) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.generate_my_weekly_review(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_my_weekly_review(date) TO authenticated;

NOTIFY pgrst, 'reload schema';
