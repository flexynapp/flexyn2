-- 305_coach_chat_quota.sql
--
-- Per-user daily cap for the `coach-chat` Edge Function.
--
-- The AI Coach is moving from a pure regex router to a real LLM call
-- (supabase/functions/coach-chat/index.ts, Anthropic Haiku). An LLM endpoint
-- with no per-user gate is a billing hole: a signed-in user holding down send,
-- or a tampered client looping the invoke, bills our Anthropic account with
-- nothing stopping it. Migration 174 learned this on recognize-meal; this is
-- the same shape, deliberately.
--
-- Differences from the recognize-meal quota, and why:
--
--   * Cap is 20/day, not 3. A meal scan is a discrete act; a chat is a
--     conversation. Three messages a day is not a coach, it's a demo. At
--     Haiku rates a full 20-turn day is around six cents, which is a price
--     worth paying for someone who talks to the coach that much.
--
--   * Same read-before-increment shape as migration 280, so a denied call is
--     a no-op on the counter rather than climbing past the cap. The client
--     reads call_count back for a "X / 20 today" hint, and a capped user
--     tapping again must not be shown "27 / 20".
--
--   * refund_coach_chat_quota() exists for the same reason 280 added its
--     twin: the Edge Function consumes UP FRONT (that's the atomic gate that
--     stops fifty concurrent invokes) and refunds on every failure path, so
--     a user only pays for a reply they actually received.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS public.coach_chat_quota (
  user_id    uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day        date    NOT NULL,
  call_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

ALTER TABLE public.coach_chat_quota ENABLE ROW LEVEL SECURITY;

-- Read-only to the owner. There is deliberately no client INSERT or UPDATE
-- policy: the counter is written exclusively by the SECURITY DEFINER
-- functions below. A client-writable quota table is not a quota.
DROP POLICY IF EXISTS coach_chat_quota_select_own ON public.coach_chat_quota;
CREATE POLICY coach_chat_quota_select_own
  ON public.coach_chat_quota
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.coach_chat_quota TO authenticated;


CREATE OR REPLACE FUNCTION public.consume_coach_chat_quota()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cap   constant integer := 20;   -- messages per (non-exempt) user per UTC day
  v_day   date := (now() AT TIME ZONE 'utc')::date;
  v_count integer;
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  -- Owner / tester exemption — unlimited, no counter row written.
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email = ANY (ARRAY['keganbergeron@gmail.com']) THEN
    RETURN true;
  END IF;

  -- Read first so a denial does NOT increment (migration 280's lesson).
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

  RETURN v_count <= v_cap;
END;
$$;


CREATE OR REPLACE FUNCTION public.refund_coach_chat_quota()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  -- Floored at zero. Exempt accounts never wrote a row, so this no-ops for
  -- them exactly as the consume side does.
  UPDATE public.coach_chat_quota
     SET call_count = GREATEST(call_count - 1, 0)
   WHERE user_id = auth.uid()
     AND day = v_day;
END;
$$;


-- A new public-schema function is EXECUTE-able by PUBLIC — and therefore a
-- PostgREST endpoint — until revoked. `refund` is the dangerous one: left
-- open, anon could POST to /rest/v1/rpc/refund_coach_chat_quota in a loop.
-- It derives the user from auth.uid() so an anon call is already a no-op,
-- but an un-revoked SECURITY DEFINER function with side effects is exactly
-- what the security advisor flags (see the Scheduled workouts section in
-- CLAUDE.md for how this bit us before). Both are called by the Edge
-- Function as the signed-in user, so `authenticated` is the only grant needed.
REVOKE ALL ON FUNCTION public.consume_coach_chat_quota() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refund_coach_chat_quota()  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_coach_chat_quota() TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_coach_chat_quota()  TO authenticated;
