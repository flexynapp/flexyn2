-- 229_recognize_meal_quota_cap_3.sql
--
-- Lower the Photo-AI (recognize-meal) per-user daily cap from 30 → 3.
-- Only the v_cap constant changes; the check-and-increment logic is
-- identical to migration 174. Bump this back up (one CREATE OR REPLACE)
-- when the feature is proven out and the Anthropic spend is understood.

CREATE OR REPLACE FUNCTION public.consume_recognize_meal_quota()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cap   constant integer := 3;    -- calls per user per UTC day
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
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
