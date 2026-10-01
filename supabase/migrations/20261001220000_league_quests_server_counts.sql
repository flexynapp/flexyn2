-- League quests count only what the server itself credited.
--
-- Audit of 20261001170000 (2026-10-01). Three of the six weekly quests
-- counted rows a client can write directly, so each could be claimed with
-- no real work behind it:
--
-- * bounty_1 counted bounty_claims with status = 'completed'. bounty_claims
--   carries a client INSERT policy (claimant_id = auth.uid()) and a client
--   UPDATE policy, so a row typed straight into the table, with no bounty
--   attempted, paid the quest's 100.
-- * train_2 / train_4 counted league_active_days: any workout_logs or
--   cardio_logs row on a distinct `date`. An empty workout saved four times
--   with four back-dated dates paid all 300 at once.
-- * cardio_2 trusted cardio_logs.duration_seconds on any client row.
--
-- Each now counts what only a SECURITY DEFINER function writes:
--
-- * train_*  distinct days with workout or cardio XP in action_xp_ledger.
--            grant_workout_xp / grant_cardio_xp pay only for a session saved
--            in the last 24h, not flagged implausible, worth XP (an empty
--            session is worth none). The day is the day it was saved, so a
--            week cannot be back-filled in one sitting.
-- * cardio_2 sessions xp_session_credits paid (kind 'cardio', xp > 0) that
--            last ten minutes or more.
-- * bounty_1 a day with 'bounty_completed' in the ledger, written only by
--            complete_bounty_claim after it checks the workout.
--
-- The weekly bracket's own qualification (league_active_days) is not
-- changed here; it belongs to the leagues work. No user data changes.

CREATE OR REPLACE FUNCTION public.league_quest_progress_internal(
  p_user_id uuid, p_quest_id text, p_from date, p_to date)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer := 0;
BEGIN
  CASE p_quest_id
    WHEN 'train_2', 'train_4' THEN
      SELECT count(DISTINCT day) INTO v_n FROM public.action_xp_ledger
       WHERE user_id = p_user_id
         AND action_type IN ('workout_completed', 'cardio_completed')
         AND day BETWEEN p_from AND p_to AND amount > 0;

    WHEN 'cardio_2' THEN
      SELECT count(*) INTO v_n
        FROM public.xp_session_credits s
        JOIN public.cardio_logs c ON c.id = s.log_id
       WHERE s.user_id = p_user_id AND s.kind = 'cardio' AND COALESCE(s.xp, 0) > 0
         AND s.credited_at >= p_from::timestamptz AND s.credited_at < (p_to + 1)::timestamptz
         AND COALESCE(c.duration_seconds, c.duration_min * 60, 0) >= 600;

    WHEN 'water_3' THEN
      SELECT count(DISTINCT day) INTO v_n FROM public.action_xp_ledger
       WHERE user_id = p_user_id AND action_type = 'water_goal_met'
         AND day BETWEEN p_from AND p_to AND amount > 0;

    WHEN 'scan_meals_3' THEN
      SELECT count(DISTINCT day) INTO v_n FROM public.action_xp_ledger
       WHERE user_id = p_user_id AND action_type IN ('photo_meal', 'barcode_meal')
         AND day BETWEEN p_from AND p_to AND amount > 0;

    WHEN 'bounty_1' THEN
      SELECT count(DISTINCT day) INTO v_n FROM public.action_xp_ledger
       WHERE user_id = p_user_id AND action_type = 'bounty_completed'
         AND day BETWEEN p_from AND p_to AND amount > 0;

    ELSE
      v_n := 0;
  END CASE;
  RETURN COALESCE(v_n, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.league_quest_progress_internal(uuid, text, date, date) FROM PUBLIC, anon, authenticated;

------------------------------------------------------------------------------
-- Probe: attempt each forgery as a real authenticated user, then roll back
------------------------------------------------------------------------------
DO $probe$
DECLARE
  u     uuid := gen_random_uuid();
  mail  text;
  wk    date := (date_trunc('week', CURRENT_DATE))::date;
  other date;
  lg    uuid;
  b     uuid;
  cl    uuid;
  r     jsonb;
BEGIN
  other := CASE WHEN CURRENT_DATE > wk THEN CURRENT_DATE - 1 ELSE CURRENT_DATE + 1 END;
  BEGIN
    mail := 'league-quest-probe-' || u || '@example.invalid';
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    VALUES (u, mail, 'authenticated', 'authenticated', FALSE);
    INSERT INTO public.user_profiles (id, email) VALUES (u, mail) ON CONFLICT (id) DO NOTHING;
    UPDATE public.user_profiles SET timezone_offset_minutes = 0 WHERE id = u;

    INSERT INTO public.leagues (tier, week_start, week_end) VALUES ('bronze', wk, wk + 6) RETURNING id INTO lg;
    INSERT INTO public.league_members (league_id, user_id, user_email, tier) VALUES (lg, u, mail, 'bronze');
    INSERT INTO public.bounties (target_user_id, target_username, metric, target_value, entry_fee, reward)
    VALUES (u, 'probe', 'session_volume', 1, 0, 0) RETURNING id INTO b;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', u, 'role', 'authenticated', 'email', mail)::text, true);
    SET LOCAL ROLE authenticated;

    -- Forgery 1: a completed bounty claim typed straight into the table.
    INSERT INTO public.bounty_claims (bounty_id, claimant_id, deadline, status, completed_at)
    VALUES (b, u, now() + interval '1 day', 'completed', now());
    r := public.claim_league_quest('bounty_1');
    IF (r->>'success')::boolean THEN RAISE EXCEPTION 'probe: forged bounty claim paid: %', r; END IF;

    -- Forgery 2: empty workouts on two dates, and long cardio rows nobody credited.
    INSERT INTO public.workout_logs (created_by, user_id, date, exercises)
    VALUES (mail, u, CURRENT_DATE, '[]'::jsonb), (mail, u, other, '[]'::jsonb);
    INSERT INTO public.cardio_logs (created_by, user_id, date, duration_seconds)
    VALUES (mail, u, CURRENT_DATE, 3600), (mail, u, other, 3600)
    RETURNING id INTO cl;
    r := public.claim_league_quest('train_2');
    IF (r->>'success')::boolean THEN RAISE EXCEPTION 'probe: empty workouts paid train_2: %', r; END IF;
    r := public.claim_league_quest('cardio_2');
    IF (r->>'success')::boolean THEN RAISE EXCEPTION 'probe: uncredited cardio paid cardio_2: %', r; END IF;

    -- What the server writes still counts: training XP on two days.
    RESET ROLE;
    INSERT INTO public.action_xp_ledger (user_id, day, action_type, amount)
    VALUES (u, CURRENT_DATE, 'workout_completed', 40), (u, other, 'cardio_completed', 30);
    SET LOCAL ROLE authenticated;
    r := public.claim_league_quest('train_2');
    IF NOT (r->>'success')::boolean OR (r->>'xp_awarded')::int <> 100 THEN
      RAISE EXCEPTION 'probe: credited training did not pay train_2: %', r;
    END IF;

    -- And one credited bounty.
    RESET ROLE;
    INSERT INTO public.action_xp_ledger (user_id, day, action_type, amount)
    VALUES (u, CURRENT_DATE, 'bounty_completed', 100);
    SET LOCAL ROLE authenticated;
    r := public.claim_league_quest('bounty_1');
    IF NOT (r->>'success')::boolean THEN RAISE EXCEPTION 'probe: credited bounty did not pay: %', r; END IF;

    RAISE EXCEPTION 'probe passed' USING ERRCODE = 'P0003';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN
    NULL;
  END;
END;
$probe$;
