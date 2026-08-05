-- Migration 297: monthly leagues had no writer, so they never ran
--
-- `monthly_leagues` and `monthly_league_members` have been empty since they
-- were created. Cron job 8 has resolved an empty table on the 1st of every
-- month since May, succeeding every time — the same "runs cleanly, does
-- nothing" shape as the weekly-debriefs cron and complete_goal.
--
-- WHY IT WAS EMPTY, and it is not what it looks like. record_monthly_xp is
-- the only writer, and migration 147 REVOKED it from `authenticated` because
-- the original took an arbitrary p_user_id and p_amount — anyone could
-- inflate anyone's monthly standing. 147 also rewrote the body properly: it
-- now derives the caller from auth.uid(), refuses a mismatched p_user_id,
-- whitelists the tier and clamps the amount. The body became safe; the
-- revoke was never lifted. So the feature has been correct-but-unreachable
-- rather than broken.
--
-- The obvious fix — re-grant EXECUTE — is wrong, and this is the point.
-- p_amount is still client-supplied. The clamp is per CALL (5000), not per
-- period, and nothing rate-limits calls, so a client could loop and mint an
-- arbitrary monthly total. Re-granting would reintroduce exactly the class
-- of defect this audit spent its time removing (perform_prestige,
-- contribute_crew_war_xp, increment_hub_post_counter — all fixed by deriving
-- server-side instead of trusting a number from the client).
--
-- THE FIX: an argument-free RPC that derives everything. Same shape as
-- sync_my_crew_war_progress and sync_my_crew_challenge_progress, which exist
-- for precisely this reason.
--
--   tier       <- user_profiles.league_tier for auth.uid()
--   monthly_xp <- SUM(xp_grant_log.amount) for auth.uid() this UTC month
--
-- xp_grant_log is server-written (user_id, amount, granted_at) and is the
-- same source the XP system already trusts, so there is no new source of
-- truth here — just a second reader of an existing one.
--
-- IDEMPOTENT BY CONSTRUCTION, which is the property that matters. The member
-- row is SET to the derived total, never incremented. Calling this once or a
-- thousand times in a row produces the same standing, so there is nothing to
-- farm regardless of how often a client fires it. record_monthly_xp's
-- `monthly_xp = monthly_xp + amount` is what made call-count matter.
--
-- record_monthly_xp is left in place and still revoked. It is not deleted
-- because the weekly path's league_resolution notification flow references
-- the same tier vocabulary and I did not want to widen this change; it stays
-- service_role-only and unused.
--
-- Client work still required — this migration alone changes nothing a user
-- sees. Something has to CALL sync_my_monthly_league(); the natural place is
-- wherever the weekly league is ensured on Dashboard mount. Until then the
-- tables stay empty, which is the same state as today, not a regression.
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.sync_my_monthly_league()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_email       text;
  v_tier        text;
  v_month_start date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  v_month_end   date := (date_trunc('month', now() AT TIME ZONE 'UTC') + INTERVAL '1 month - 1 day')::date;
  v_xp          integer;
  v_league_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT email, league_tier INTO v_email, v_tier
    FROM public.user_profiles WHERE id = v_uid;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'profile missing' USING ERRCODE = 'P0002';
  END IF;

  -- Unset or unrecognised tier falls to bronze rather than erroring. A user
  -- with no tier yet should still land on a board; refusing would make the
  -- feature invisible to exactly the new accounts it is meant to onboard.
  IF v_tier IS NULL OR v_tier NOT IN
     ('bronze','silver','gold','platinum','diamond','master','grandmaster') THEN
    v_tier := 'bronze';
  END IF;

  -- Derived, never passed in.
  SELECT COALESCE(SUM(amount), 0) INTO v_xp
    FROM public.xp_grant_log
   WHERE user_id = v_uid
     AND granted_at >= v_month_start
     AND granted_at <  (v_month_end + 1);

  IF v_xp <= 0 THEN
    RETURN jsonb_build_object('joined', false, 'reason', 'no xp this month');
  END IF;

  SELECT id INTO v_league_id
    FROM public.monthly_leagues
   WHERE tier = v_tier
     AND month_start = v_month_start
     AND is_resolved = false
     AND member_count < 200
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_league_id IS NULL THEN
    INSERT INTO public.monthly_leagues (tier, month_start, month_end, member_count)
    VALUES (v_tier, v_month_start, v_month_end, 0)
    RETURNING id INTO v_league_id;
  END IF;

  -- SET, not +=. This is what makes repeat calls harmless.
  INSERT INTO public.monthly_league_members (league_id, user_id, user_email, monthly_xp)
  VALUES (v_league_id, v_uid, v_email, v_xp)
  ON CONFLICT (league_id, user_id)
  DO UPDATE SET monthly_xp = EXCLUDED.monthly_xp;

  UPDATE public.monthly_leagues
     SET member_count = (SELECT count(*) FROM public.monthly_league_members
                          WHERE league_id = v_league_id)
   WHERE id = v_league_id;

  RETURN jsonb_build_object(
    'joined', true, 'league_id', v_league_id, 'tier', v_tier, 'monthly_xp', v_xp);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.sync_my_monthly_league() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_my_monthly_league() FROM anon;
GRANT  EXECUTE ON FUNCTION public.sync_my_monthly_league() TO authenticated;
