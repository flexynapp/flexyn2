-- First-week check-in: one tap a day for a new account's first seven days.
--
-- Opening the app has never paid XP. Kegan asked (2026-10-02) for a check-in
-- sheet a new user sees once a day in their first week, so showing up is
-- rewarded on purpose rather than by coincidence with a daily quest.
--
-- The reward is decided and paid here, never by the client:
--   * the day number comes from the account's own sign-up date, so a client
--     cannot claim day 7 on day 1;
--   * each day can be claimed once (primary key) and the dates only move
--     forward, so a missed day stays missed and the most a forged date can
--     do is take a future day early, which it then cannot take again;
--   * XP goes through award_xp_internal (374): same rolling cap, same
--     xp_grant_log row as every other grant;
--   * coins are a direct credit like claim_quest_atomic, so 264's ledger
--     trigger clamps them, and the function reports what actually landed.
--
-- "Today" is the caller's local date, the same clock advance_login_streak
-- uses, held to within a day of the server's UTC date. The sign-up day is
-- read in the timezone the profile stores (user_local_now's convention), so
-- a user whose profile has no offset counts days in UTC.

CREATE TABLE IF NOT EXISTS public.first_week_checkins (
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day_index   smallint    NOT NULL CHECK (day_index BETWEEN 1 AND 7),
  local_date  date        NOT NULL,
  xp_awarded  integer     NOT NULL DEFAULT 0,
  coins_awarded integer   NOT NULL DEFAULT 0,
  claimed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day_index),
  UNIQUE (user_id, local_date)
);

ALTER TABLE public.first_week_checkins ENABLE ROW LEVEL SECURITY;

-- Read your own rows. No client INSERT, UPDATE or DELETE: the claim RPC is
-- the only writer.
DROP POLICY IF EXISTS first_week_checkins_select_own ON public.first_week_checkins;
CREATE POLICY first_week_checkins_select_own ON public.first_week_checkins
  FOR SELECT TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.first_week_checkins FROM anon, authenticated;
GRANT SELECT ON public.first_week_checkins TO authenticated;

-- The reward ladder. One place, read by both RPCs.
CREATE OR REPLACE FUNCTION public.first_week_checkin_reward(p_day integer)
 RETURNS TABLE (xp integer, coins integer)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT v.xp, v.coins
    FROM (VALUES (1, 20, 10), (2, 20, 10), (3, 30, 15), (4, 30, 15),
                 (5, 40, 20), (6, 50, 25), (7, 100, 50)) AS v(day, xp, coins)
   WHERE v.day = p_day;
$function$;

REVOKE ALL ON FUNCTION public.first_week_checkin_reward(integer) FROM PUBLIC, anon, authenticated;

-- The caller's day number (1 = sign-up day) for a given local date.
CREATE OR REPLACE FUNCTION public.first_week_checkin_day(p_user_id uuid, p_today date)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (p_today - ((u.created_at + (COALESCE(p.timezone_offset_minutes, 0) || ' minutes')::interval)
                       AT TIME ZONE 'UTC')::date) + 1
    FROM auth.users u
    LEFT JOIN public.user_profiles p ON p.id = u.id
   WHERE u.id = p_user_id;
$function$;

REVOKE ALL ON FUNCTION public.first_week_checkin_day(uuid, date) FROM PUBLIC, anon, authenticated;

-- What the sheet draws: today's day number, whether it is open to claim, and
-- the seven days with their prize and status.
CREATE OR REPLACE FUNCTION public.get_first_week_checkin(p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_server date := (now() AT TIME ZONE 'UTC')::date;
  v_day    integer;
  v_last   date;
  v_days   jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF p_today IS NULL OR p_today < v_server - 1 OR p_today > v_server + 1 THEN
    RAISE EXCEPTION 'p_today out of range' USING ERRCODE = '22023';
  END IF;

  v_day := public.first_week_checkin_day(v_uid, p_today);
  IF v_day IS NULL OR v_day < 1 OR v_day > 7 THEN
    RETURN jsonb_build_object('eligible', FALSE, 'day', v_day);
  END IF;

  SELECT max(local_date) INTO v_last FROM public.first_week_checkins WHERE user_id = v_uid;

  SELECT jsonb_agg(jsonb_build_object(
           'day', d,
           'xp', r.xp,
           'coins', r.coins,
           'status', CASE
             WHEN c.day_index IS NOT NULL THEN 'claimed'
             WHEN d < v_day THEN 'missed'
             WHEN d = v_day THEN 'today'
             ELSE 'future' END)
         ORDER BY d)
    INTO v_days
    FROM generate_series(1, 7) AS d
    CROSS JOIN LATERAL public.first_week_checkin_reward(d) r
    LEFT JOIN public.first_week_checkins c ON c.user_id = v_uid AND c.day_index = d;

  RETURN jsonb_build_object(
    'eligible', TRUE,
    'day', v_day,
    'claimable', NOT EXISTS (SELECT 1 FROM public.first_week_checkins
                              WHERE user_id = v_uid AND day_index = v_day)
                 AND (v_last IS NULL OR p_today > v_last),
    'days', v_days);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_first_week_checkin(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_first_week_checkin(date) TO authenticated;

-- Claim today. Returns what was actually credited.
CREATE OR REPLACE FUNCTION public.claim_first_week_checkin(p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_server  date := (now() AT TIME ZONE 'UTC')::date;
  v_day     integer;
  v_xp      integer;
  v_coins   integer;
  v_xp_before bigint;
  v_xp_after  bigint;
  v_c_before  integer;
  v_c_after   integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF p_today IS NULL OR p_today < v_server - 1 OR p_today > v_server + 1 THEN
    RAISE EXCEPTION 'p_today out of range' USING ERRCODE = '22023';
  END IF;

  -- Serialise this user's claims so two taps cannot both pass the checks.
  PERFORM 1 FROM public.user_profiles WHERE id = v_uid FOR UPDATE;

  v_day := public.first_week_checkin_day(v_uid, p_today);
  IF v_day IS NULL OR v_day < 1 OR v_day > 7 THEN
    RETURN jsonb_build_object('claimed', FALSE, 'reason', 'not_eligible', 'day', v_day);
  END IF;

  IF EXISTS (SELECT 1 FROM public.first_week_checkins
              WHERE user_id = v_uid AND (day_index = v_day OR local_date >= p_today)) THEN
    RETURN jsonb_build_object('claimed', FALSE, 'reason', 'already_claimed', 'day', v_day);
  END IF;

  SELECT r.xp, r.coins INTO v_xp, v_coins FROM public.first_week_checkin_reward(v_day) r;

  SELECT COALESCE(total_xp, 0), COALESCE(flex_coins, 0) INTO v_xp_before, v_c_before
    FROM public.user_profiles WHERE id = v_uid;

  PERFORM public.award_xp_internal(v_uid, v_xp);

  UPDATE public.user_profiles
     SET flex_coins = COALESCE(flex_coins, 0) + v_coins
   WHERE id = v_uid;

  SELECT COALESCE(total_xp, 0), COALESCE(flex_coins, 0) INTO v_xp_after, v_c_after
    FROM public.user_profiles WHERE id = v_uid;

  INSERT INTO public.first_week_checkins (user_id, day_index, local_date, xp_awarded, coins_awarded)
  VALUES (v_uid, v_day, p_today, (v_xp_after - v_xp_before)::integer, GREATEST(v_c_after - v_c_before, 0));

  RETURN jsonb_build_object(
    'claimed', TRUE,
    'day', v_day,
    'xp_awarded', (v_xp_after - v_xp_before)::integer,
    'coins_awarded', GREATEST(v_c_after - v_c_before, 0),
    'total_xp', v_xp_after,
    'flex_coins', v_c_after);
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_first_week_checkin(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_first_week_checkin(date) TO authenticated;

-- Probe: the internal helpers are not callable by clients, the ladder is
-- seven days long, and the table has no client write path.
DO $probe$
BEGIN
  IF has_function_privilege('authenticated', 'public.first_week_checkin_day(uuid, date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.first_week_checkin_reward(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'first-week helper is client-callable';
  END IF;
  IF has_function_privilege('anon', 'public.claim_first_week_checkin(date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can claim a check-in';
  END IF;
  IF (SELECT count(*) FROM generate_series(1, 8) d, public.first_week_checkin_reward(d)) <> 7 THEN
    RAISE EXCEPTION 'reward ladder is not seven days';
  END IF;
  IF has_table_privilege('authenticated', 'public.first_week_checkins', 'INSERT')
     OR has_table_privilege('authenticated', 'public.first_week_checkins', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.first_week_checkins', 'DELETE') THEN
    RAISE EXCEPTION 'clients can write first_week_checkins';
  END IF;
END
$probe$;
