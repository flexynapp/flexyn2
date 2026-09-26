-- 280_recognize_meal_quota_no_charge_on_failure.sql
--
-- Photo-AI was charging a scan for work it never delivered.
--
-- The edge function (supabase/functions/recognize-meal/index.ts) calls
-- consume_recognize_meal_quota() FIRST, then validates the request, then
-- calls Anthropic, then parses. Every failure after that consume already
-- cost the user one of their three daily scans:
--
--   INVALID_JSON · MISSING_IMAGE · IMAGE_TOO_LARGE · UNSUPPORTED_MEDIA_TYPE
--   SERVER_MISCONFIGURED · API_ERROR (fetch threw) · API_ERROR (upstream 5xx)
--   RATE_LIMIT (Anthropic's, not ours) · PARSE_ERROR · NOT_FOOD
--
-- Ten ways to lose a scan without getting a meal. Photograph something that
-- isn't food twice and you are down to your last one for the day.
--
-- Rather than move the consume to the end (which would remove the atomic
-- gate that stops a user firing fifty concurrent recognitions and draining
-- the Anthropic budget — the whole reason migration 174 added it), the
-- consume stays up front and the edge function REFUNDS on every failure
-- path. The gate keeps working; the user only pays for a result.
--
-- Two functions change here:
--
-- 1. consume_recognize_meal_quota() — stop incrementing once the cap is
--    already reached. Migration 229/231 incremented unconditionally and
--    then returned `v_count <= v_cap`, so tapping while capped kept
--    climbing the counter. src/lib/data/photoAiQuota.js reads call_count
--    straight back for the "X / 3" display, so a capped user tapping a few
--    more times could be shown "6 / 3". Now a denied call is a no-op.
--
-- 2. refund_recognize_meal_quota() — new. Gives back exactly one scan,
--    floored at zero, for today's row only. Exempt accounts never wrote a
--    row so they no-op, same as on the consume side.
--
-- Both are idempotent to re-run. The edge function must be redeployed for
-- the refund to actually be called — this migration alone only makes the
-- refund available and stops the over-cap drift.

CREATE OR REPLACE FUNCTION public.consume_recognize_meal_quota()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cap   constant integer := 3;    -- calls per (non-exempt) user per UTC day
  v_day   date := (now() AT TIME ZONE 'utc')::date;
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

  -- Read first so a denial does NOT increment. The old version always
  -- incremented and only then compared, which let the stored count run
  -- past the cap every time a capped user tapped again.
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

  RETURN v_count <= v_cap;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_recognize_meal_quota() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_recognize_meal_quota() TO authenticated;

-- Hand back one scan when the recognition did not produce a meal.
--
-- Deliberately NOT idempotent per-request: the edge function calls it at
-- most once per failed request, on the same code path that consumed. It
-- floors at zero so a double call can never mint free scans beyond the
-- day's real usage.
CREATE OR REPLACE FUNCTION public.refund_recognize_meal_quota()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_day   date := (now() AT TIME ZONE 'utc')::date;
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  -- Exempt accounts never wrote a row; nothing to give back.
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email = ANY (ARRAY['keganbergeron@gmail.com']) THEN
    RETURN;
  END IF;

  UPDATE public.recognize_meal_quota
     SET call_count = GREATEST(call_count - 1, 0)
   WHERE user_id = auth.uid()
     AND day = v_day;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_recognize_meal_quota() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refund_recognize_meal_quota() TO authenticated;
