-- 031_coin_shop_purchase.sql
--
-- Atomic purchase from the coin shop. The previous client flow had every
-- exploit the marketplace had before migration 025 fixed it:
--   • Client-supplied price (could be patched to 0 in DevTools).
--   • Read-modify-write on flex_coins (concurrent purchases double-spent;
--     concurrent grants between read and write wiped out).
--   • Refund-after-failed-grant was also RMW (any coins earned between
--     debit and refund were silently erased).
--
-- Coin Shop is a SEPARATE economy surface from the player-to-player
-- marketplace, so a separate RPC. Catalog lives server-side in this
-- function — clients pass only the SKU, prices are NOT trusted from
-- the client.
--
-- Returns:
--   { success: true,  sku, price, new_balance, granted_kind, granted_id? }
--   { success: false, error: '<reason>', new_balance?: int }

CREATE OR REPLACE FUNCTION public.purchase_shop_item(p_sku TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_email        TEXT := auth.email();
  v_price        INTEGER;
  v_kind         TEXT;       -- 'capsule' or 'streak_freeze'
  v_subtype      TEXT;       -- e.g. 'standard' / 'premium' / 'elite' for capsules
  v_amount       INTEGER;    -- for streak_freeze quantity
  v_balance      INTEGER;
  v_new_balance  INTEGER;
  v_capsule_id   UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Server-owned catalog. NEVER trust client prices.
  CASE p_sku
    WHEN 'capsule_standard' THEN
      v_price := 100; v_kind := 'capsule';       v_subtype := 'standard';
    WHEN 'capsule_premium' THEN
      v_price := 350; v_kind := 'capsule';       v_subtype := 'premium';
    WHEN 'capsule_elite' THEN
      v_price := 1000; v_kind := 'capsule';      v_subtype := 'elite';
    WHEN 'streak_freeze' THEN
      v_price := 200; v_kind := 'streak_freeze'; v_amount := 1;
    ELSE
      RAISE EXCEPTION 'unknown_sku: %', p_sku USING ERRCODE = '22023';
  END CASE;

  -- Lock the buyer's profile row for the duration of the transaction.
  -- Concurrent purchases / coin grants serialize on this lock.
  SELECT COALESCE(flex_coins, 0) INTO v_balance
    FROM public.user_profiles
   WHERE id = v_uid
     FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'buyer profile not found' USING ERRCODE = '22023';
  END IF;

  IF v_balance < v_price THEN
    RAISE EXCEPTION 'insufficient_coins: have %, need %', v_balance, v_price
      USING ERRCODE = '22023';
  END IF;

  -- Debit AND grant inside the same transaction. If the grant fails
  -- (RAISE from inside the IF/THEN branches), the entire transaction
  -- rolls back and the debit is automatically undone.
  v_new_balance := v_balance - v_price;
  UPDATE public.user_profiles
     SET flex_coins = v_new_balance
   WHERE id = v_uid;

  IF v_kind = 'capsule' THEN
    INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
    VALUES (v_uid, v_email, v_subtype)
    RETURNING id INTO v_capsule_id;

    RETURN jsonb_build_object(
      'success',       true,
      'sku',           p_sku,
      'price',         v_price,
      'new_balance',   v_new_balance,
      'granted_kind',  'capsule',
      'granted_id',    v_capsule_id,
      'granted_subtype', v_subtype
    );

  ELSIF v_kind = 'streak_freeze' THEN
    UPDATE public.user_profiles
       SET streak_freezes_available = COALESCE(streak_freezes_available, 0) + v_amount
     WHERE id = v_uid;

    RETURN jsonb_build_object(
      'success',      true,
      'sku',          p_sku,
      'price',        v_price,
      'new_balance',  v_new_balance,
      'granted_kind', 'streak_freeze',
      'granted_amount', v_amount
    );
  END IF;

  -- Unreachable — CASE above raises for unknown SKUs.
  RAISE EXCEPTION 'unhandled_grant_kind: %', v_kind USING ERRCODE = '22023';
END;
$$;

GRANT EXECUTE ON FUNCTION public.purchase_shop_item(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
