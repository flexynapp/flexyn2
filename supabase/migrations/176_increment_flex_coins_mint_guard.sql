-- Migration 176: close the flex-coin mint without breaking legitimate grants
--
-- C18 (2026-06 audit): increment_flex_coins(p_delta) is SECURITY DEFINER,
-- granted to authenticated, and applied any positive p_delta to the
-- caller's own balance with no bound —
--   supabase.rpc('increment_flex_coins', { p_delta: 999999999 })
-- minted unlimited currency. The audit's first instinct (REVOKE from
-- authenticated) is NOT safe here: the client calls this RPC directly in
-- four legitimate flows — login-streak coins (loginStreak.js), workout-
-- streak coins (workoutStreak.js), capsule sell-back (capsules.js), and
-- inventory rewards (inventory.js) — and claim_referral (089) calls it
-- internally. Revoking it would break all of those.
--
-- Instead we keep the grant and make the function itself safe:
--   1. Per-call clamp — a single positive grant is capped at a ceiling
--      above the largest legitimate grant. Verified against prod code:
--      the biggest single increment_flex_coins call is the day-100
--      workout-streak milestone (2000); login-streak tops at 1500,
--      capsule/loot at 1000, referral 200. Ceiling 2500 leaves headroom.
--      Kills the one-shot 999999999 mint.
--   2. Per-user/day positive-grant cap (ledger) — bounds a scripted loop
--      to a daily total well above any realistic legitimate day (even
--      day-100 of BOTH streaks plus inventory liquidation lands ~6000).
--      Ceiling 25000 never clips a real user while still throttling an
--      automated mint. Negative deltas (purchases/refunds) are unaffected
--      and still clamp the final balance at 0.
--
-- Ceilings are centralized here as tunable constants.
-- The durable fix is event-sourced server-side grants (amount derived
-- from the triggering event, never passed by the client) — a larger
-- economy refactor tracked as a follow-up. This migration removes the
-- exploit without that refactor.
--
-- Paste-safe per repo convention: bare columns in single-table
-- statements, public.<table>, auth.uid(), no alias.column tokens.

-- Per-user/day ledger of POSITIVE grants only (spending is never capped).
CREATE TABLE IF NOT EXISTS public.flex_coin_grant_ledger (
  user_id uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day     date    NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  granted integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

ALTER TABLE public.flex_coin_grant_ledger ENABLE ROW LEVEL SECURITY;

-- Owner may read their own ledger; writes happen only inside the RPC.
DROP POLICY IF EXISTS "flex_coin_grant_ledger: owner read" ON public.flex_coin_grant_ledger;
CREATE POLICY "flex_coin_grant_ledger: owner read"
  ON public.flex_coin_grant_ledger FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.increment_flex_coins(p_delta INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_max_per_call CONSTANT INTEGER := 2500;    -- > largest legit grant (2000); kills one-shot mint
  v_max_per_day  CONSTANT INTEGER := 25000;   -- >> realistic max legit day (~6000); throttles loops
  v_requested    INTEGER;
  v_before       INTEGER;
  v_after        INTEGER;
  v_credit       INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_delta IS NULL OR p_delta = 0 THEN RETURN; END IF;

  -- Negative deltas (purchases, refunds) are not throttled; the final
  -- balance still clamps at 0 so a race can't go negative.
  IF p_delta < 0 THEN
    UPDATE public.user_profiles
       SET flex_coins = GREATEST(0, COALESCE(flex_coins, 0) + p_delta)
     WHERE id = v_uid;
    RETURN;
  END IF;

  v_requested := LEAST(p_delta, v_max_per_call);

  -- Today's prior positive-grant total (default 0).
  SELECT COALESCE(granted, 0) INTO v_before
    FROM public.flex_coin_grant_ledger
   WHERE user_id = v_uid
     AND day = (now() AT TIME ZONE 'utc')::date;
  v_before := COALESCE(v_before, 0);

  v_after  := LEAST(v_max_per_day, v_before + v_requested);
  v_credit := v_after - v_before;   -- amount that fits under the daily cap
  IF v_credit <= 0 THEN RETURN; END IF;

  INSERT INTO public.flex_coin_grant_ledger (user_id, day, granted)
  VALUES (v_uid, (now() AT TIME ZONE 'utc')::date, v_credit)
  ON CONFLICT (user_id, day)
  DO UPDATE SET granted = LEAST(v_max_per_day, public.flex_coin_grant_ledger.granted + v_credit);

  UPDATE public.user_profiles
     SET flex_coins = GREATEST(0, COALESCE(flex_coins, 0) + v_credit)
   WHERE id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_flex_coins(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_flex_coins(INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
