-- AI quota refunds become server-only.
--
-- refund_coach_chat_quota() and refund_recognize_meal_quota() were executable
-- by `authenticated` and checked nothing but auth.uid(). A signed-in user,
-- guests included, could call consume, get an answer, call refund, and repeat:
-- the per-user cap (20 chats, 3 meal scans) and the all-users daily ceiling
-- on Anthropic spend both stopped meaning anything. Found by the 2026-09-27
-- codebase audit and confirmed against production grants.
--
-- The refund exists so a user does not pay for a reply the Edge Function
-- failed to deliver, and only the Edge Function knows that. So the refund
-- moves behind the service role: the *_for(p_user_id) variants below are
-- callable only by service_role, and the functions call them after
-- auth.getUser() has verified who the caller is. The old no-argument
-- functions stay (a function is not user data) but nobody outside the
-- database can execute them.
--
-- The owner exemption in consume_* (it returns TRUE without counting for
-- one address) is mirrored in the refund, or an owner refund would
-- decrement the shared daily total for a call that was never counted.

CREATE OR REPLACE FUNCTION public.refund_coach_chat_quota_for(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_day   date := (now() AT TIME ZONE 'utc')::date;
  v_email text;
  v_rows  integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email = ANY (ARRAY['keganbergeron@gmail.com']) THEN
    RETURN;
  END IF;

  UPDATE public.coach_chat_quota
     SET call_count = GREATEST(call_count - 1, 0)
   WHERE user_id = p_user_id AND day = v_day AND call_count > 0;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows > 0 THEN
    UPDATE public.coach_chat_daily_total
       SET call_count = GREATEST(call_count - 1, 0)
     WHERE day = v_day;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_recognize_meal_quota_for(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_day   date := (now() AT TIME ZONE 'utc')::date;
  v_email text;
  v_rows  integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email = ANY (ARRAY['keganbergeron@gmail.com']) THEN
    RETURN;
  END IF;

  UPDATE public.recognize_meal_quota
     SET call_count = GREATEST(call_count - 1, 0)
   WHERE user_id = p_user_id AND day = v_day AND call_count > 0;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows > 0 THEN
    UPDATE public.recognize_meal_daily_total
       SET call_count = GREATEST(call_count - 1, 0)
     WHERE day = v_day;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_coach_chat_quota_for(uuid)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_recognize_meal_quota_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_coach_chat_quota_for(uuid)     TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_recognize_meal_quota_for(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.refund_coach_chat_quota()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_recognize_meal_quota() FROM PUBLIC, anon, authenticated;

-- Prove it: as a real signed-in user, every refund door must be refused,
-- while the service role can still refund.
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_fn  text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  FOREACH v_fn IN ARRAY ARRAY[
    'SELECT public.refund_coach_chat_quota()',
    'SELECT public.refund_recognize_meal_quota()',
    format('SELECT public.refund_coach_chat_quota_for(%L)', v_uid),
    format('SELECT public.refund_recognize_meal_quota_for(%L)', v_uid)
  ] LOOP
    BEGIN
      SET LOCAL ROLE authenticated;
      EXECUTE v_fn;
      RESET ROLE;
      RAISE EXCEPTION 'authenticated could still run: %', v_fn;
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE;
    END;
  END LOOP;

  SET LOCAL ROLE service_role;
  PERFORM public.refund_coach_chat_quota_for(v_uid);
  PERFORM public.refund_recognize_meal_quota_for(v_uid);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', '', true);
END
$$;
