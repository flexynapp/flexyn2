-- 385_recognize_meal_daily_ceiling.sql
--
-- An all-users daily ceiling on meal-photo recognition, mirroring what 307
-- did for the Coach.
--
-- Why: recognize-meal is the most expensive call in the app (a vision request
-- on the Sonnet tier) and it only had a PER-USER cap (3/day, mig 229). Per-user
-- caps bound one account, not the bill: a launch day, or a script cycling
-- anonymous guest accounts, multiplies it by however many accounts show up.
-- The Coach has had a 3,000/day global breaker since 307; meal scan had none.
--
-- 500 scans/day is several times anything production has seen (44 accounts,
-- 2 active this week as of 2026-09-24). Raise it here when real traffic needs
-- it; the point is that the ceiling exists before the traffic does.
--
-- Shipped alongside: both Edge Functions now fail CLOSED when these RPCs
-- error, instead of open. An outage of the counter used to lift every limit.
--
-- Paste-safe: single-table statements and public.<table> qualifiers only.

CREATE TABLE IF NOT EXISTS public.recognize_meal_daily_total (
  day        date    PRIMARY KEY,
  call_count integer NOT NULL DEFAULT 0
);

-- No policies on purpose: only the SECURITY DEFINER functions below touch it.
ALTER TABLE public.recognize_meal_daily_total ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_recognize_meal_quota()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_global_cap constant integer := 500;  -- all users, per UTC day
  v_cap        constant integer := 3;    -- per user, per UTC day (mig 229)
  v_day        date := (now() AT TIME ZONE 'utc')::date;
  v_count      integer;
  v_total      integer;
  v_email      text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  -- Owner exemption (mig 231). Kept ahead of the global ceiling so the owner
  -- can still test the feature on a day the breaker has tripped.
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email = ANY (ARRAY['keganbergeron@gmail.com']) THEN
    RETURN true;
  END IF;

  SELECT call_count INTO v_total
    FROM public.recognize_meal_daily_total
   WHERE day = v_day;

  IF COALESCE(v_total, 0) >= v_global_cap THEN
    RETURN false;
  END IF;

  SELECT call_count INTO v_count
    FROM public.recognize_meal_quota
   WHERE user_id = auth.uid()
     AND day = v_day;

  IF COALESCE(v_count, 0) >= v_cap THEN
    RETURN false;
  END IF;

  INSERT INTO public.recognize_meal_quota (user_id, day, call_count)
  VALUES (auth.uid(), v_day, 1)
  ON CONFLICT (user_id, day)
  DO UPDATE SET call_count = public.recognize_meal_quota.call_count + 1
  RETURNING call_count INTO v_count;

  INSERT INTO public.recognize_meal_daily_total (day, call_count)
  VALUES (v_day, 1)
  ON CONFLICT (day)
  DO UPDATE SET call_count = public.recognize_meal_daily_total.call_count + 1;

  RETURN v_count <= v_cap;
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_recognize_meal_quota()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_day   date := (now() AT TIME ZONE 'utc')::date;
  v_email text;
  v_rows  integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email = ANY (ARRAY['keganbergeron@gmail.com']) THEN
    RETURN;
  END IF;

  UPDATE public.recognize_meal_quota
     SET call_count = GREATEST(call_count - 1, 0)
   WHERE user_id = auth.uid()
     AND day = v_day;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Only give back to the global total when there was a per-user charge to
  -- give back, so repeated refunds cannot drive the ceiling down.
  IF v_rows > 0 THEN
    UPDATE public.recognize_meal_daily_total
       SET call_count = GREATEST(call_count - 1, 0)
     WHERE day = v_day;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_recognize_meal_quota() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refund_recognize_meal_quota()  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_recognize_meal_quota() TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_recognize_meal_quota()  TO authenticated;

-- Check: the table exists and the installed consume body carries the ceiling.
SELECT
  to_regclass('public.recognize_meal_daily_total') IS NOT NULL AS ceiling_table_exists,
  position('recognize_meal_daily_total' IN pg_get_functiondef('public.consume_recognize_meal_quota()'::regprocedure)) > 0 AS consume_checks_ceiling;
