-- Coin credits report what actually landed, and gifts stop losing coins.
--
-- increment_flex_coins silently clamps at the 25,000/day mint ledger, and
-- the flex_coin_ledger_and_cap trigger clamps any credit past 50,000 in 24
-- hours. Both are correct limits. But increment_flex_coins returns void, so
-- the login and workout streak paths could only assume their grant landed
-- and toasted "+N coins" when the cap had paid 0 (2026-09-27 audit, 22).
--
-- gift_flex_coins had the same blind spot in a worse place: it debited the
-- sender the full amount, credited the recipient through the clamping
-- trigger, and never checked. A gift to someone near their limit destroyed
-- the difference (audit 23). It also looked the recipient up in
-- auth.users.email, which is NULL for every guest, so no guest could ever
-- receive a gift.
--
-- 1. credit_flex_coins(p_delta) RETURNS integer: the same credit as
--    increment_flex_coins, measured as the balance change. Callers show that
--    number. increment_flex_coins is unchanged for its existing callers.
-- 2. gift_flex_coins: if the recipient would be credited less than the gift,
--    nothing moves and it returns RECIPIENT_AT_LIMIT. Guests resolve through
--    user_profiles.email.

CREATE OR REPLACE FUNCTION public.credit_flex_coins(p_delta integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_before integer;
  v_after  integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_delta IS NULL OR p_delta <= 0 THEN
    RETURN 0;
  END IF;
  SELECT COALESCE(flex_coins, 0) INTO v_before
    FROM public.user_profiles WHERE id = v_uid FOR UPDATE;
  PERFORM public.increment_flex_coins(p_delta);
  SELECT COALESCE(flex_coins, 0) INTO v_after
    FROM public.user_profiles WHERE id = v_uid;
  RETURN GREATEST(0, COALESCE(v_after, 0) - COALESCE(v_before, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.credit_flex_coins(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credit_flex_coins(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gift_flex_coins(p_recipient_id uuid, p_amount integer, p_message text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sender UUID := auth.uid();
  v_sender_balance INTEGER;
  v_sender_username TEXT;
  v_recipient_email TEXT;
  v_recipient_lang  TEXT;
  v_recipient_before INTEGER;
  v_recipient_after  INTEGER;
  v_gift_id UUID;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_recipient_id IS NULL THEN
    RAISE EXCEPTION 'recipient_id required' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount < 1 OR p_amount > 10000 THEN
    RAISE EXCEPTION 'amount must be 1..10000' USING ERRCODE = '22023';
  END IF;
  IF p_recipient_id = v_sender THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SELF_GIFT');
  END IF;

  SELECT flex_coins, username
    INTO v_sender_balance, v_sender_username
    FROM public.user_profiles
    WHERE id = v_sender
    FOR UPDATE;

  IF v_sender_balance IS NULL THEN
    RAISE EXCEPTION 'sender profile missing' USING ERRCODE = '22023';
  END IF;
  IF v_sender_balance < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_FUNDS',
      'balance', v_sender_balance);
  END IF;

  -- Guests have no auth.users email; their profile carries the address.
  SELECT COALESCE(NULLIF(u.email, ''), prof.email), prof.preferred_language,
         COALESCE(prof.flex_coins, 0)
    INTO v_recipient_email, v_recipient_lang, v_recipient_before
    FROM public.user_profiles prof
    LEFT JOIN auth.users u ON u.id = prof.id
   WHERE prof.id = p_recipient_id
   FOR UPDATE OF prof;
  IF v_recipient_email IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RECIPIENT_NOT_FOUND');
  END IF;

  BEGIN
    UPDATE public.user_profiles
       SET flex_coins = GREATEST(0, COALESCE(flex_coins, 0) - p_amount)
     WHERE id = v_sender;

    UPDATE public.user_profiles
       SET flex_coins = COALESCE(flex_coins, 0) + p_amount
     WHERE id = p_recipient_id
    RETURNING COALESCE(flex_coins, 0) INTO v_recipient_after;

    -- The ledger trigger clamps credits past the recipient's 24h ceiling.
    -- A short credit would destroy the difference, so undo the transfer.
    IF v_recipient_after - v_recipient_before < p_amount THEN
      RAISE EXCEPTION 'recipient_at_limit' USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'recipient_at_limit' THEN RAISE; END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'RECIPIENT_AT_LIMIT');
  END;

  INSERT INTO public.coin_gifts (sender_id, recipient_id, amount, message)
  VALUES (v_sender, p_recipient_id, p_amount, NULLIF(p_message, ''))
  RETURNING id INTO v_gift_id;

  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (p_recipient_id,
     v_recipient_email,
     'coin_gift',
     'You received a coin gift!',
     COALESCE('@' || NULLIF(v_sender_username, '') || ' sent you ' || p_amount::text || ' coins',
              'You received ' || p_amount::text || ' coins'),
     '💰',
     '/hub',
     jsonb_build_object(
       'amount',         p_amount,
       'senderId',       v_sender,
       'senderUsername', v_sender_username,
       'giftMessage',    NULLIF(p_message, ''),
       'giftId',         v_gift_id
     ));

  RETURN jsonb_build_object('ok', true, 'giftId', v_gift_id, 'amount', p_amount);
END;
$$;

-- Prove it as real signed-in users. Rolled back at the end.
DO $$
DECLARE
  a uuid := gen_random_uuid();   -- sender
  g uuid := gen_random_uuid();   -- guest recipient (no auth email)
  v_got  integer;
  v_res  jsonb;
  v_bal  integer;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    VALUES (a, 'probe_gift_' || a || '@probe.invalid', 'authenticated', 'authenticated', false),
           (g, NULL, 'authenticated', 'authenticated', true);
    INSERT INTO public.user_profiles (id, email)
    VALUES (a, 'probe_gift_' || a || '@probe.invalid'),
           (g, 'guest_' || g || '@flexyn.guest')
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', a, 'role', 'authenticated')::text, true);

    -- credit_flex_coins reports a full credit, then 0 at the mint ledger cap.
    SET LOCAL ROLE authenticated;
    v_got := public.credit_flex_coins(500);
    RESET ROLE;
    IF v_got <> 500 THEN RAISE EXCEPTION 'credit reported % instead of 500', v_got; END IF;
    UPDATE public.flex_coin_grant_ledger SET granted = 25000
     WHERE user_id = a AND day = (now() AT TIME ZONE 'utc')::date;
    SET LOCAL ROLE authenticated;
    v_got := public.credit_flex_coins(100);
    RESET ROLE;
    IF v_got <> 0 THEN RAISE EXCEPTION 'a capped credit reported % instead of 0', v_got; END IF;

    -- A guest can receive a gift.
    SET LOCAL ROLE authenticated;
    v_res := public.gift_flex_coins(g, 100, NULL);
    RESET ROLE;
    IF (v_res->>'ok')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'a gift to a guest failed: %', v_res;
    END IF;

    -- A recipient at their 24h ceiling: refused, sender keeps the coins.
    INSERT INTO public.flex_coin_ledger (user_id, delta, balance_after, actor, source, clamped)
    VALUES (g, 50000, 50100, 'postgres', 'probe', false);
    SET LOCAL ROLE authenticated;
    v_res := public.gift_flex_coins(g, 100, NULL);
    RESET ROLE;
    SELECT flex_coins INTO v_bal FROM public.user_profiles WHERE id = a;
    IF v_res->>'error' IS DISTINCT FROM 'RECIPIENT_AT_LIMIT' OR v_bal <> 400 THEN
      RAISE EXCEPTION 'a capped gift was not refused cleanly: % (sender balance %)', v_res, v_bal;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'probe_rollback';
  EXCEPTION WHEN raise_exception THEN
    RESET ROLE;
    IF SQLERRM <> 'probe_rollback' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
END
$$;
