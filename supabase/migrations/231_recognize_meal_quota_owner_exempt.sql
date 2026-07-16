-- 231_recognize_meal_quota_owner_exempt.sql
--
-- Give specific owner/tester accounts UNLIMITED Photo-AI (recognize-meal)
-- scans, while every other account keeps the daily cap from migration 229.
--
-- The exemption is keyed on the account's email (looked up from auth.users
-- by auth.uid()), so it survives even if the underlying user_id changes.
-- To exempt another account, add its lower-cased email to the ARRAY below.
--
-- Exempt accounts short-circuit BEFORE the counter is touched, so they never
-- write a recognize_meal_quota row and are never limited.

CREATE OR REPLACE FUNCTION public.consume_recognize_meal_quota()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cap   constant integer := 3;    -- calls per (non-exempt) user per UTC day
  v_count integer;
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  -- Owner / tester exemption — unlimited scans, no counter increment.
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email = ANY (ARRAY['keganbergeron@gmail.com']) THEN
    RETURN true;
  END IF;

  INSERT INTO public.recognize_meal_quota (user_id, day, call_count)
  VALUES (auth.uid(), (now() AT TIME ZONE 'utc')::date, 1)
  ON CONFLICT (user_id, day)
  DO UPDATE SET call_count = public.recognize_meal_quota.call_count + 1
  RETURNING call_count INTO v_count;

  RETURN v_count <= v_cap;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_recognize_meal_quota() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_recognize_meal_quota() TO authenticated;

NOTIFY pgrst, 'reload schema';
