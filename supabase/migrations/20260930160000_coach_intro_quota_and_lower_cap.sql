-- Coach launch readiness (2026-09-30, thread "Coach accuracy test").
--
-- Two changes, both to what the AI Coach may spend in a day.
--
-- 1. The all-users ceiling on Coach chat drops from 3,000 to 500 a day.
--    coach-chat moves real questions from Haiku 4.5 to Sonnet 5.5 in the same
--    change (about 3x the price per message, measured in
--    audits/coach-eval-2026-09-30/three-way-comparison.md). At 3,000 the worst
--    day would cost about $36; at 500 about $6. Real traffic today is a few
--    messages a week, so this binds nobody. Raise it when traffic does.
--    The body below is restated from pg_get_functiondef() on production, with
--    only the constant changed.
--
-- 2. The onboarding write-up gets its own quota. It was ~93% of all Coach
--    calls and it counted against a guest's 5 chat messages a day, so a new
--    user arrived at the Coach with one of their five already spent. It now
--    runs on Haiku with a short prompt (see coach-chat) and is metered here:
--    2 a day per user (a retry if the first one times out) and 1,000 a day
--    across everyone. A Haiku intro is about $0.001, so the ceiling is ~$1 a
--    day. It is a separate counter, not an exemption: a request that says it
--    is an intro still spends from a budget, so claiming to be one buys an
--    attacker two short Haiku replies a day, not free chat.

CREATE OR REPLACE FUNCTION public.consume_coach_chat_quota()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_global_cap constant integer := 500;
  v_user_cap   constant integer := 20;
  v_guest_cap  constant integer := 5;
  v_day        date := (now() AT TIME ZONE 'utc')::date;
  v_cap        integer;
  v_count      integer;
  v_total      integer;
  v_email      text;
  v_is_guest   boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email = ANY (ARRAY['keganbergeron@gmail.com']) THEN
    RETURN true;
  END IF;

  SELECT call_count INTO v_total
    FROM public.coach_chat_daily_total
   WHERE day = v_day;

  IF COALESCE(v_total, 0) >= v_global_cap THEN
    RETURN false;
  END IF;

  SELECT is_anonymous INTO v_is_guest FROM auth.users WHERE id = auth.uid();
  v_cap := CASE WHEN COALESCE(v_is_guest, false) THEN v_guest_cap ELSE v_user_cap END;

  SELECT call_count INTO v_count
    FROM public.coach_chat_quota
   WHERE user_id = auth.uid()
     AND day = v_day;

  IF COALESCE(v_count, 0) >= v_cap THEN
    RETURN false;
  END IF;

  INSERT INTO public.coach_chat_quota (user_id, day, call_count)
  VALUES (auth.uid(), v_day, 1)
  ON CONFLICT (user_id, day)
  DO UPDATE SET call_count = public.coach_chat_quota.call_count + 1
  RETURNING call_count INTO v_count;

  INSERT INTO public.coach_chat_daily_total (day, call_count)
  VALUES (v_day, 1)
  ON CONFLICT (day)
  DO UPDATE SET call_count = public.coach_chat_daily_total.call_count + 1;

  RETURN v_count <= v_cap;
END;
$function$;

-- Per-user and all-users counters for the onboarding intro. No policies: only
-- the SECURITY DEFINER function below reads or writes them.
CREATE TABLE IF NOT EXISTS public.coach_intro_quota (
  user_id    uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day        date    NOT NULL,
  call_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
ALTER TABLE public.coach_intro_quota ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.coach_intro_daily_total (
  day        date    PRIMARY KEY,
  call_count integer NOT NULL DEFAULT 0
);
ALTER TABLE public.coach_intro_daily_total ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.coach_intro_quota       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.coach_intro_daily_total FROM PUBLIC, anon, authenticated;

-- Keyed on auth.uid() only. No owner bypass by email: new code looks users up
-- by id (see the email-exposure plan), and two intros a day is enough for
-- testing anyway.
CREATE OR REPLACE FUNCTION public.consume_coach_intro_quota()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_global_cap constant integer := 1000;
  v_user_cap   constant integer := 2;
  v_day        date := (now() AT TIME ZONE 'utc')::date;
  v_count      integer;
  v_total      integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT call_count INTO v_total
    FROM public.coach_intro_daily_total
   WHERE day = v_day;
  IF COALESCE(v_total, 0) >= v_global_cap THEN
    RETURN false;
  END IF;

  SELECT call_count INTO v_count
    FROM public.coach_intro_quota
   WHERE user_id = auth.uid() AND day = v_day;
  IF COALESCE(v_count, 0) >= v_user_cap THEN
    RETURN false;
  END IF;

  INSERT INTO public.coach_intro_quota (user_id, day, call_count)
  VALUES (auth.uid(), v_day, 1)
  ON CONFLICT (user_id, day)
  DO UPDATE SET call_count = public.coach_intro_quota.call_count + 1
  RETURNING call_count INTO v_count;

  INSERT INTO public.coach_intro_daily_total (day, call_count)
  VALUES (v_day, 1)
  ON CONFLICT (day)
  DO UPDATE SET call_count = public.coach_intro_daily_total.call_count + 1;

  RETURN v_count <= v_user_cap;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_coach_intro_quota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_coach_intro_quota() TO authenticated, service_role;
