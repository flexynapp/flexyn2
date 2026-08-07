-- 307_coach_chat_circuit_breaker.sql
--
-- A global daily ceiling on coach-chat, plus a smaller cap for guests.
--
-- WHY — the per-user cap does not bound anything
--
-- Migration 305 caps each user at 20 coach messages per UTC day and I called
-- that bounded. It isn't. `signInAnonymously()` is wired up for guest sign-in
-- (src/api/db.js, migration 172): no email, no verification, instant, free.
-- Every guest identity arrives with a fresh 20-message quota, so the cap
-- bounds an honest user and nothing else. Twelve guest identities were minted
-- in one afternoon of testing without trying.
--
-- The exposure is roughly 6c per identity (20 messages at ~0.3c) with no
-- limit on identities. Migration 306 sweeps abandoned guests daily, which is
-- worth having, but it is cleanup AFTER the spend — it does not stop one.
--
-- So the bound has to be global. This is a circuit breaker, not a quota: it
-- exists to make the worst case a number rather than an open question.
--
--   3,000 calls/day  ~=  $9/day  ~=  $270/month, hard ceiling
--
-- That is ~100x current real usage (29 non-guest accounts), so it is
-- invisible to real users and only ever fires when something is wrong.
--
-- GUESTS GET 5, NOT 20
--
-- A guest has no logged workouts, so buildCoachContext hands the model an
-- empty digest and the Coach cannot personalise anything for them — it is a
-- generic fitness chatbot at that point. Five messages is enough to see what
-- the feature is before signing up, which is what guest mode is for.
--
-- Identifying a guest uses `auth.users.is_anonymous`, following migration
-- 306: it is what Supabase Auth actually records, and the '@flexyn.guest'
-- email heuristic embeds a dotted token that this project's clipboard
-- pipeline mangles into a predicate that silently matches nothing.
--
-- WHAT A TRIPPED BREAKER LOOKS LIKE
--
-- Same as any other cap: the RPC returns false, the Edge Function returns
-- RATE_LIMIT, and the client falls back to the rule-based Coach. The app
-- keeps working; it just stops paying Anthropic.
--
-- Known rough edge, deliberately accepted: a user who has sent two messages
-- would see the existing "you've hit today's limit" copy, which is not true
-- for them. Distinguishing the two cases means changing this function's
-- return type and redeploying the Edge Function, and the breaker should never
-- fire in normal operation. If it ever fires routinely, fix the copy then —
-- and treat routine firing as the real signal, because it means either an
-- abuse problem or a userbase that has outgrown this ceiling.
--
-- Idempotent — safe to re-run.


-- One row per UTC day. Deliberately NOT per-user: this is the aggregate the
-- per-user table cannot answer, since the whole attack is spreading spend
-- across many users.
CREATE TABLE IF NOT EXISTS public.coach_chat_daily_total (
  day        date    PRIMARY KEY,
  call_count integer NOT NULL DEFAULT 0
);

-- RLS on with NO policies and no grants: nothing reaches this table except
-- the SECURITY DEFINER functions below. There are no "own rows" here to
-- scope a policy to, and the running total is operational data — a client
-- that could read it could tell how close the app is to its own ceiling.
ALTER TABLE public.coach_chat_daily_total ENABLE ROW LEVEL SECURITY;


CREATE OR REPLACE FUNCTION public.consume_coach_chat_quota()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_global_cap constant integer := 3000;  -- all users, per UTC day
  v_user_cap   constant integer := 20;    -- registered user, per UTC day
  v_guest_cap  constant integer := 5;     -- guest (anonymous) user
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

  -- Owner / tester exemption, checked first so a tripped breaker never locks
  -- the owner out of diagnosing why it tripped. Writes no counter row.
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email = ANY (ARRAY['keganbergeron@gmail.com']) THEN
    RETURN true;
  END IF;

  -- Circuit breaker. Read before increment, exactly like the per-user check
  -- below and for the same reason (migration 280): a denied call must be a
  -- no-op on the counter, or a capped day keeps climbing past its own ceiling
  -- and the number stops meaning anything.
  SELECT call_count INTO v_total
    FROM public.coach_chat_daily_total
   WHERE day = v_day;

  IF COALESCE(v_total, 0) >= v_global_cap THEN
    RETURN false;
  END IF;

  -- A guest has an empty training digest, so the Coach cannot personalise
  -- for them anyway. Enough to evaluate the feature, not enough to farm.
  SELECT is_anonymous INTO v_is_guest FROM auth.users WHERE id = auth.uid();
  v_cap := CASE WHEN COALESCE(v_is_guest, false) THEN v_guest_cap ELSE v_user_cap END;

  SELECT call_count INTO v_count
    FROM public.coach_chat_quota
   WHERE user_id = auth.uid()
     AND day = v_day;

  IF COALESCE(v_count, 0) >= v_cap THEN
    RETURN false;
  END IF;

  -- Past both gates: charge the call to the user and to the day. Order does
  -- not matter, but both must happen or the two counters drift.
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
$$;


CREATE OR REPLACE FUNCTION public.refund_coach_chat_quota()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_day  date := (now() AT TIME ZONE 'utc')::date;
  v_rows integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.coach_chat_quota
     SET call_count = GREATEST(call_count - 1, 0)
   WHERE user_id = auth.uid()
     AND day = v_day;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Only give back to the day total if a user row was actually decremented.
  -- The owner is exempt and never wrote a user row, so an unguarded decrement
  -- here would hand the day a free call every time an owner request failed —
  -- slowly inflating the headroom the breaker is supposed to enforce.
  IF v_rows > 0 THEN
    UPDATE public.coach_chat_daily_total
       SET call_count = GREATEST(call_count - 1, 0)
     WHERE day = v_day;
  END IF;
END;
$$;


-- Both are called by the Edge Function as the signed-in user. A new
-- public-schema function is EXECUTE-able by PUBLIC — and therefore a
-- PostgREST endpoint — until revoked; `refund` in particular must not be
-- loopable by anon. (See the Scheduled workouts section of CLAUDE.md for how
-- a missing REVOKE exposed a cron-only function.)
REVOKE ALL ON FUNCTION public.consume_coach_chat_quota() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refund_coach_chat_quota()  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_coach_chat_quota() TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_coach_chat_quota()  TO authenticated;
