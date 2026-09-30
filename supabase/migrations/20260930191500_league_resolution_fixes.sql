-- Leagues audit, 2026-09-30. Three defects in how a week is resolved.
--
-- 1. notify_league_resolution_for was EXECUTE-able by `authenticated`.
--    It takes the recipient, outcome, tiers, coins and capsule as
--    parameters, and its only gate is "the caller shared a resolved
--    bracket with the recipient". So anyone who had been in a bracket with
--    you could push you "You were promoted to Legend, +600 coins, premium
--    capsule" and nothing would be true. Nothing in the app calls it: the
--    resolver uses notify_league_resolution_internal. Revoked.
--
-- 2. The resolver ranked on a stale weekly_xp. league_members.weekly_xp is
--    only refreshed when the member's own app calls sync_my_weekly_league,
--    so XP earned after someone last opened the app was not counted, and
--    two members of one bracket were ranked on numbers taken at different
--    times. roll_weekly_leagues now recomputes every member's XP from
--    xp_grant_log (the same sum sync_my_weekly_league takes) immediately
--    before resolving.
--
-- 3. The weekly roll ran at 00:10 UTC Monday. Training days are counted by
--    workout_logs.date, which is the lifter's LOCAL date, so a Sunday-evening
--    session anywhere in the Americas (Sunday 20:00 in New York is Monday
--    00:00 UTC) was logged after its week had already been resolved and
--    never counted towards qualifying. The roll now runs at 12:10 UTC
--    Monday, after Sunday has ended in every inhabited time zone.

REVOKE EXECUTE ON FUNCTION public.notify_league_resolution_for(uuid, text, text, text, integer, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.roll_weekly_leagues()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id      UUID;
  v_start   DATE;
  v_end     DATE;
  v_claimed INTEGER := 0;
BEGIN
  FOR v_id, v_start, v_end IN
    SELECT id, week_start, week_end FROM public.leagues
     WHERE is_resolved = FALSE
       AND week_end = LEAST(week_end, CURRENT_DATE)
       AND NOT (week_end = CURRENT_DATE)
     ORDER BY week_start
  LOOP
    UPDATE public.leagues
       SET is_resolved = TRUE
     WHERE id = v_id AND is_resolved = FALSE;

    IF FOUND THEN
      -- Same window as sync_my_weekly_league: [week_start, week_end + 1).
      UPDATE public.league_members m
         SET weekly_xp = LEAST(150000, GREATEST(0, COALESCE((
               SELECT SUM(g.amount) FROM public.xp_grant_log g
                WHERE g.user_id = m.user_id
                  AND g.granted_at >= v_start::TIMESTAMPTZ
                  AND g.granted_at < (v_end + 1)::TIMESTAMPTZ), 0)))
       WHERE m.league_id = v_id;

      PERFORM public.resolve_league_bracket_internal(v_id);
      v_claimed := v_claimed + 1;
    END IF;
  END LOOP;

  RETURN v_claimed;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.roll_weekly_leagues() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'roll-weekly-leagues') THEN
    PERFORM cron.unschedule('roll-weekly-leagues');
  END IF;
  PERFORM cron.schedule('roll-weekly-leagues', '10 12 * * 1',
                        'SELECT public.roll_weekly_leagues();');
END $$;

-- Probe: attempt the things, rolled back.
DO $$
DECLARE
  v_league UUID;
  v_user   UUID;
  v_xp     INTEGER;
BEGIN
  IF has_function_privilege('authenticated',
       'public.notify_league_resolution_for(uuid, text, text, text, integer, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'probe: authenticated can still forge league notifications';
  END IF;

  IF (SELECT schedule FROM cron.job WHERE jobname = 'roll-weekly-leagues') <> '10 12 * * 1' THEN
    RAISE EXCEPTION 'probe: roll-weekly-leagues not rescheduled';
  END IF;

  -- A past bracket whose stored XP is stale: the roll must count the ledger.
  SELECT id INTO v_user FROM public.user_profiles ORDER BY created_at LIMIT 1;
  IF v_user IS NULL THEN RETURN; END IF;  -- empty preview database

  BEGIN
    INSERT INTO public.leagues (tier, week_start, week_end, member_count, is_resolved)
    VALUES ('bronze', DATE '2001-01-01', DATE '2001-01-07', 0, FALSE)
    RETURNING id INTO v_league;
    INSERT INTO public.league_members (league_id, user_id, user_email, weekly_xp)
    VALUES (v_league, v_user, 'probe@example.invalid', 0);
    INSERT INTO public.xp_grant_log (user_id, amount, granted_at)
    VALUES (v_user, 42, TIMESTAMPTZ '2001-01-03 12:00:00+00');

    PERFORM public.roll_weekly_leagues();

    SELECT weekly_xp INTO v_xp FROM public.league_members
     WHERE league_id = v_league AND user_id = v_user;
    IF v_xp IS DISTINCT FROM 42 THEN
      RAISE EXCEPTION 'probe: roll ranked on stale XP (got %, want 42)', v_xp;
    END IF;
    IF NOT (SELECT is_resolved FROM public.leagues WHERE id = v_league) THEN
      RAISE EXCEPTION 'probe: bracket not resolved';
    END IF;

    RAISE EXCEPTION 'probe_ok';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
  END;
END $$;
