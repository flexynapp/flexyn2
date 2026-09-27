-- Rival month: a monthly layer on top of the weekly races.
--
-- Kegan, 2026-09-27: races stay seven days; add a monthly layer on top.
-- Every week you win in a calendar month counts toward it, human Rival and
-- Past You alike. Win 3 weeks in one month and a bonus is paid at the start
-- of the next: 2,000 XP, 200 coins and 2 capsules.
--
-- What counts as a week won:
--   Past You: a completed race with won = TRUE
--   Rival:    a completed match you won, EXCEPT a walkover (your rival never
--             logged). A walkover still pays its own small prize, but counting
--             it here would let a second account that accepts and never trains
--             hand out monthly bonuses.
-- A week belongs to the month its race ENDED in, in the user's local time
-- (timezone_offset_minutes, the same way streaks and reminders read it).
--
-- Paying: the cron runs daily at 12:10 UTC and pays the month that ended at
-- least 36 hours ago, so every local timezone has finished the month and the
-- hourly settlers have closed its last races. A ledger row per (user, month)
-- makes it pay once.

CREATE TABLE IF NOT EXISTS public.rival_month_bonuses (
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month     DATE NOT NULL,
  wins      INTEGER NOT NULL,
  xp        INTEGER NOT NULL DEFAULT 0,
  coins     INTEGER NOT NULL DEFAULT 0,
  capsules  INTEGER NOT NULL DEFAULT 0,
  paid_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month)
);
ALTER TABLE public.rival_month_bonuses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rival_month_bonuses_own_read" ON public.rival_month_bonuses;
CREATE POLICY "rival_month_bonuses_own_read" ON public.rival_month_bonuses
  FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.rival_month_bonuses FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rival_month_bonuses FROM authenticated;
GRANT SELECT ON public.rival_month_bonuses TO authenticated;
GRANT ALL ON public.rival_month_bonuses TO service_role;

-- Local calendar date of an instant for one user.
CREATE OR REPLACE FUNCTION public.rival_local_date(p_uid UUID, p_at TIMESTAMPTZ)
RETURNS DATE
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT ((p_at + make_interval(mins => COALESCE(
            (SELECT timezone_offset_minutes FROM public.user_profiles WHERE id = p_uid), 0)))
          AT TIME ZONE 'UTC')::date;
$$;

-- Weeks won in one local calendar month (p_month = its first day).
CREATE OR REPLACE FUNCTION public.rival_month_wins(p_uid UUID, p_month DATE)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT (
    SELECT count(*) FROM public.past_you_matches
     WHERE user_id = p_uid AND status = 'completed' AND won
       AND date_trunc('month', public.rival_local_date(p_uid, ends_at))::date = p_month
  )::int + (
    SELECT count(*) FROM public.gym_rival_assignments g
     WHERE g.winner_id = p_uid AND g.status = 'completed' AND g.accepted_at IS NOT NULL
       AND date_trunc('month', public.rival_local_date(p_uid, g.accepted_at + interval '7 days'))::date = p_month
       AND public.gym_rival_has_logged(
             CASE WHEN g.user_id = p_uid THEN g.rival_id ELSE g.user_id END,
             g.rival_type, g.accepted_at, g.accepted_at + interval '7 days')
  )::int;
$$;

REVOKE ALL ON FUNCTION public.rival_local_date(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rival_month_wins(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rival_local_date(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.rival_month_wins(uuid, date) TO service_role;

-- The caller's current month, for the card.
CREATE OR REPLACE FUNCTION public.get_my_rival_month()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_month DATE;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  v_month := date_trunc('month', public.rival_local_date(v_uid, now()))::date;
  RETURN jsonb_build_object(
    'month', v_month,
    'wins', public.rival_month_wins(v_uid, v_month),
    'goal', 3,
    'last_paid', (SELECT to_jsonb(b) - 'user_id' FROM public.rival_month_bonuses b
                   WHERE b.user_id = v_uid ORDER BY month DESC LIMIT 1));
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_rival_month() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_rival_month() TO authenticated, service_role;

-- Pays one user for one month. Returns TRUE when it paid.
CREATE OR REPLACE FUNCTION public.rival_pay_month(p_uid UUID, p_month DATE)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_wins INTEGER; v_email TEXT;
  v_xp0 BIGINT; v_xp1 BIGINT; v_c0 NUMERIC; v_c1 NUMERIC;
BEGIN
  v_wins := public.rival_month_wins(p_uid, p_month);
  IF v_wins < 3 THEN RETURN FALSE; END IF;

  INSERT INTO public.rival_month_bonuses (user_id, month, wins)
  VALUES (p_uid, p_month, v_wins)
  ON CONFLICT (user_id, month) DO NOTHING;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_uid;
  SELECT COALESCE(total_xp, 0), COALESCE(flex_coins, 0) INTO v_xp0, v_c0 FROM public.user_profiles WHERE id = p_uid;
  PERFORM public.award_xp_internal(p_uid, 2000);
  UPDATE public.user_profiles SET flex_coins = COALESCE(flex_coins, 0) + 200 WHERE id = p_uid;
  INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
  SELECT p_uid, v_email, 'standard' FROM generate_series(1, 2);
  SELECT COALESCE(total_xp, 0), COALESCE(flex_coins, 0) INTO v_xp1, v_c1 FROM public.user_profiles WHERE id = p_uid;

  UPDATE public.rival_month_bonuses
     SET xp = (v_xp1 - v_xp0)::int, coins = round(v_c1 - v_c0)::int, capsules = 2
   WHERE user_id = p_uid AND month = p_month;

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (p_uid, v_email, 'rival_month_bonus',
    '🏆 ' || v_wins || ' weeks won in ' || to_char(p_month, 'FMMonth'),
    concat_ws(', ',
      CASE WHEN v_xp1 - v_xp0 > 0 THEN '+' || (v_xp1 - v_xp0) || ' XP' END,
      CASE WHEN v_c1 - v_c0 > 0 THEN '+' || round(v_c1 - v_c0) || ' coins' END,
      '2 capsules') || '. A new month starts now.',
    '🏆', '/workout',
    jsonb_build_object('month', p_month, 'wins', v_wins));
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.rival_pay_month(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rival_pay_month(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.rival_pay_months()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_month DATE := (date_trunc('month', now() - interval '36 hours') - interval '1 month')::date;
  v_from TIMESTAMPTZ := v_month - interval '1 day';
  v_to   TIMESTAMPTZ := (v_month + interval '1 month') + interval '1 day';
  r RECORD; n INTEGER := 0;
BEGIN
  FOR r IN
    SELECT user_id AS uid FROM public.past_you_matches
     WHERE status = 'completed' AND won AND ends_at >= v_from AND ends_at < v_to
    UNION
    SELECT winner_id FROM public.gym_rival_assignments
     WHERE status = 'completed' AND winner_id IS NOT NULL
       AND accepted_at + interval '7 days' >= v_from AND accepted_at + interval '7 days' < v_to
  LOOP
    BEGIN
      IF public.rival_pay_month(r.uid, v_month) THEN n := n + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'rival_pay_months: user % failed: %', r.uid, SQLERRM;
    END;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.rival_pay_months() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rival_pay_months() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('rival-month-bonus')
   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rival-month-bonus');
END;
$$;
SELECT cron.schedule('rival-month-bonus', '10 12 * * *', $$SELECT public.rival_pay_months()$$);

-- ── Notification category ──────────────────────────────────────────────────
-- Restated from 20260927183000 (the installed body) plus the bonus, which is
-- an achievement: a reward the user earned, not a nudge.

CREATE OR REPLACE FUNCTION public.notification_type_category(p_type text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT CASE p_type
    WHEN 'streak_milestone'         THEN 'streak'
    WHEN 'streak_break_warning'     THEN 'streak'
    WHEN 'streak_rescued'           THEN 'streak'
    WHEN 'quest_claimed'            THEN 'quests'
    WHEN 'quest_expiry_warning'     THEN 'quests'
    WHEN 'league_promoted'          THEN 'league'
    WHEN 'league_demoted'           THEN 'league'
    WHEN 'league_held'              THEN 'league'
    WHEN 'league_promotion'         THEN 'league'
    WHEN 'league_demotion'          THEN 'league'
    WHEN 'friend_post'              THEN 'social'
    WHEN 'friend_follow'            THEN 'social'
    WHEN 'comment_reply'            THEN 'social'
    WHEN 'post_reaction'            THEN 'social'
    WHEN 'post_like'                THEN 'social'
    WHEN 'sticker_reaction'         THEN 'social'
    WHEN 'trade_offer'              THEN 'social'
    WHEN 'crew_everyone'            THEN 'social'
    WHEN 'coin_gift'                THEN 'social'
    WHEN 'gym_member_joined'        THEN 'social'
    WHEN 'story_reaction'           THEN 'social'
    WHEN 'dm_received'              THEN 'social'
    WHEN 'pr_set'                   THEN 'achievements'
    WHEN 'capsule_earned'           THEN 'achievements'
    WHEN 'coin_milestone'           THEN 'achievements'
    WHEN 'rival_month_bonus'        THEN 'achievements'
    WHEN 'welcome_back'             THEN 'engagement'
    WHEN 'weekly_gauntlet_started'  THEN 'engagement'
    WHEN 'memory_reengagement'      THEN 'engagement'
    WHEN 'referral_success'         THEN 'engagement'
    WHEN 'comeback_protocol'        THEN 'engagement'
    WHEN 'past_you_nudge'           THEN 'engagement'
    WHEN 'duel_invite'              THEN 'competitive'
    WHEN 'duel_result'              THEN 'competitive'
    WHEN 'bounty_claim'             THEN 'competitive'
    WHEN 'bounty_beaten'            THEN 'competitive'
    WHEN 'crew_war_started'         THEN 'competitive'
    WHEN 'crew_war_resolved'        THEN 'competitive'
    WHEN 'nemesis_assigned'         THEN 'competitive'
    WHEN 'nemesis_overthrown'       THEN 'competitive'
    WHEN 'gauntlet_path_completed'  THEN 'competitive'
    WHEN 'crew_challenge_created'   THEN 'competitive'
    WHEN 'crew_challenge_completed' THEN 'competitive'
    WHEN 'past_you_checkpoint'      THEN 'competitive'
    ELSE NULL
  END;
$function$;

-- ── Attempt it ─────────────────────────────────────────────────────────────
-- Rolled back by the closing RAISE. A walkover does not count, two wins do
-- not pay, three pay exactly once, and a win in another month is not counted.

DO $$
DECLARE
  a UUID := gen_random_uuid();
  b UUID := gen_random_uuid();
  v_month DATE := (date_trunc('month', now()) - interval '1 month')::date;
  v_xp0 BIGINT; v_xp1 BIGINT; v_caps0 INTEGER; v_caps1 INTEGER;
  j JSONB;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    VALUES (a, 'month-probe-a-' || a || '@example.invalid', 'authenticated', 'authenticated', FALSE),
           (b, 'month-probe-b-' || b || '@example.invalid', 'authenticated', 'authenticated', FALSE);
    INSERT INTO public.user_profiles (id, email) VALUES
      (a, 'month-probe-a-' || a || '@example.invalid'), (b, 'month-probe-b-' || b || '@example.invalid')
    ON CONFLICT (id) DO NOTHING;
    UPDATE public.user_profiles SET timezone_offset_minutes = 0 WHERE id IN (a, b);

    -- Two Past You wins last month, and one in a later month.
    INSERT INTO public.past_you_matches (user_id, rival_type, level, baseline, baseline_weeks, target, started_at, ends_at, status, won, settled_at)
    VALUES (a, 'gym', 1, 5000, 1, 5000, v_month + interval '1 day',  v_month + interval '8 days',  'completed', TRUE, v_month + interval '8 days'),
           (a, 'gym', 2, 5000, 1, 5200, v_month + interval '8 days', v_month + interval '15 days', 'completed', TRUE, v_month + interval '15 days'),
           (a, 'gym', 3, 5000, 1, 5400, v_month + interval '2 months', v_month + interval '2 months 7 days', 'completed', TRUE, v_month + interval '2 months 7 days');

    -- A walkover win last month: b never logged. It must not count.
    INSERT INTO public.gym_rival_assignments (user_id, rival_id, status, accepted_at, winner_id, rival_type, settled_at)
    VALUES (a, b, 'completed', v_month + interval '15 days', a, 'gym', v_month + interval '22 days');

    IF public.rival_month_wins(a, v_month) <> 2 THEN
      RAISE EXCEPTION 'probe: expected 2 wins last month, got %', public.rival_month_wins(a, v_month);
    END IF;
    IF public.rival_pay_month(a, v_month) THEN RAISE EXCEPTION 'probe: paid a 2-win month'; END IF;

    -- A third win, ending on the month's last day.
    INSERT INTO public.past_you_matches (user_id, rival_type, level, baseline, baseline_weeks, target, started_at, ends_at, status, won, settled_at)
    VALUES (a, 'cardio', 1, 2500, 1, 2500, v_month + interval '1 month' - interval '8 days',
            v_month + interval '1 month' - interval '1 hour', 'completed', TRUE, v_month + interval '1 month');

    SELECT COALESCE(total_xp, 0) INTO v_xp0 FROM public.user_profiles WHERE id = a;
    SELECT count(*) INTO v_caps0 FROM public.user_capsules WHERE user_id = a;
    IF NOT public.rival_pay_month(a, v_month) THEN RAISE EXCEPTION 'probe: 3-win month not paid'; END IF;
    IF public.rival_pay_month(a, v_month) THEN RAISE EXCEPTION 'probe: month paid twice'; END IF;
    SELECT COALESCE(total_xp, 0) INTO v_xp1 FROM public.user_profiles WHERE id = a;
    SELECT count(*) INTO v_caps1 FROM public.user_capsules WHERE user_id = a;
    IF v_xp1 - v_xp0 <> 2000 THEN RAISE EXCEPTION 'probe: bonus paid % XP (want 2000)', v_xp1 - v_xp0; END IF;
    IF v_caps1 - v_caps0 <> 2 THEN RAISE EXCEPTION 'probe: bonus paid % capsules (want 2)', v_caps1 - v_caps0; END IF;
    IF (SELECT xp FROM public.rival_month_bonuses WHERE user_id = a AND month = v_month) <> 2000 THEN
      RAISE EXCEPTION 'probe: ledger does not record the XP paid';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = a AND type = 'rival_month_bonus') THEN
      RAISE EXCEPTION 'probe: no bonus notice';
    END IF;

    -- The sweep finds nothing left to pay for last month.
    PERFORM public.rival_pay_months();

    -- The caller sees their own month, and only their own.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    j := public.get_my_rival_month();
    IF (j->>'goal')::int <> 3 OR (j->'last_paid'->>'month')::date <> v_month THEN
      RAISE EXCEPTION 'probe: get_my_rival_month returned %', j;
    END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    j := public.get_my_rival_month();
    IF (j->>'wins')::int <> 0 OR j->'last_paid' <> 'null'::jsonb THEN
      RAISE EXCEPTION 'probe: another user saw a month that is not theirs: %', j;
    END IF;

    IF public.notification_type_category('rival_month_bonus') <> 'achievements'
       OR public.notification_type_category('past_you_nudge') <> 'engagement' THEN
      RAISE EXCEPTION 'probe: notification categories wrong';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'probe passed';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
END;
$$;
