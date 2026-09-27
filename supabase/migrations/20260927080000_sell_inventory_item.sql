-- Selling an item becomes one server-side transaction.
--
-- The Bag sold an item in two client calls: delete the inventory row, then
-- increment_flex_coins(price) with a price the client computed. Three
-- failures followed from that (2026-09-27 codebase audit, item 14):
--   * increment_flex_coins silently clamps at the 25,000/day mint ceiling,
--     so past the cap the item was deleted and 0 coins were credited, while
--     the toast still said "+N coins";
--   * a failure between the two calls lost the item for nothing;
--   * two tabs selling the same row could both reach the credit step.
-- And the price itself came from the client.
--
-- sell_inventory_item(p_inventory_id) locks the caller's row, prices it
-- from the same table the Bag displays (half the rarity's base value, times
-- the variant multiplier), credits through increment_flex_coins so the mint
-- ledger and caps still apply, and measures what was actually credited. If
-- the cap would pay less than the price, it raises and the whole sale rolls
-- back: the item stays in the bag. A second sell of the same row finds
-- nothing to lock and raises, so it can never pay twice.
--
-- Prices mirror src/lib/lootCatalog.js RARITY.baseCoins / 2 and
-- VARIANTS.sellMultiplier. Unknown rarities sell for 2, as in the client.

CREATE OR REPLACE FUNCTION public.sell_inventory_item(p_inventory_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_row     public.user_inventory%ROWTYPE;
  v_price   integer;
  v_before  integer;
  v_after   integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row
    FROM public.user_inventory
   WHERE id = p_inventory_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item not found' USING ERRCODE = 'P0002';
  END IF;
  IF COALESCE(v_row.is_listed, FALSE) OR v_row.escrow_offer_id IS NOT NULL THEN
    RAISE EXCEPTION 'item is listed or held in a trade' USING ERRCODE = '55006';
  END IF;

  v_price := (CASE v_row.item_rarity
                WHEN 'common'    THEN 2
                WHEN 'uncommon'  THEN 7
                WHEN 'rare'      THEN 20
                WHEN 'epic'      THEN 50
                WHEN 'legendary' THEN 125
                WHEN 'mythic'    THEN 250
                WHEN 'animated'  THEN 250
                ELSE 2
              END)
           * (CASE v_row.variant
                WHEN 'foil'    THEN 2
                WHEN 'gold'    THEN 5
                WHEN 'diamond' THEN 10
                ELSE 1
              END);

  SELECT COALESCE(flex_coins, 0) INTO v_before
    FROM public.user_profiles WHERE id = v_uid FOR UPDATE;

  DELETE FROM public.user_inventory WHERE id = v_row.id;
  PERFORM public.increment_flex_coins(v_price);

  SELECT COALESCE(flex_coins, 0) INTO v_after
    FROM public.user_profiles WHERE id = v_uid;
  IF v_after - v_before < v_price THEN
    RAISE EXCEPTION 'daily coin limit reached' USING ERRCODE = 'P0001',
      HINT = 'daily_coin_cap';
  END IF;

  RETURN jsonb_build_object('coins', v_price, 'new_balance', v_after);
END;
$$;

REVOKE ALL ON FUNCTION public.sell_inventory_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sell_inventory_item(uuid) TO authenticated, service_role;

-- Prove it as a real signed-in user with a seeded item: a sale pays the
-- table price, a second sale of the same row is refused, and a sale past
-- the daily cap is refused with the item kept. Rolled back at the end.
DO $$
DECLARE
  a      uuid := gen_random_uuid();
  v_item uuid;
  v_res  jsonb;
  v_left integer;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, aud, role)
    VALUES (a, 'probe_sell_' || a || '@probe.invalid', 'authenticated', 'authenticated');
    INSERT INTO public.user_profiles (id, email)
    VALUES (a, 'probe_sell_' || a || '@probe.invalid')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.user_inventory (user_id, user_email, item_id, item_name, item_rarity, item_type, variant)
    VALUES (a, 'probe_sell_' || a || '@probe.invalid', 'probe', 'Probe', 'epic', 'sticker', 'gold')
    RETURNING id INTO v_item;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', a, 'role', 'authenticated')::text, true);

    SET LOCAL ROLE authenticated;
    v_res := public.sell_inventory_item(v_item);
    RESET ROLE;
    IF (v_res->>'coins')::int <> 250 OR (v_res->>'new_balance')::int <> 250 THEN
      RAISE EXCEPTION 'an epic gold sticker did not pay 250: %', v_res;
    END IF;

    BEGIN
      SET LOCAL ROLE authenticated;
      PERFORM public.sell_inventory_item(v_item);
      RESET ROLE;
      RAISE EXCEPTION 'the same item sold twice';
    EXCEPTION WHEN no_data_found THEN RESET ROLE;
    END;

    -- Fill today's mint ledger to the cap, then try to sell again.
    INSERT INTO public.flex_coin_grant_ledger (user_id, day, granted)
    VALUES (a, (now() AT TIME ZONE 'utc')::date, 25000)
    ON CONFLICT (user_id, day) DO UPDATE SET granted = 25000;
    INSERT INTO public.user_inventory (user_id, user_email, item_id, item_name, item_rarity, item_type)
    VALUES (a, 'probe_sell_' || a || '@probe.invalid', 'probe', 'Probe', 'rare', 'sticker')
    RETURNING id INTO v_item;
    BEGIN
      SET LOCAL ROLE authenticated;
      PERFORM public.sell_inventory_item(v_item);
      RESET ROLE;
      RAISE EXCEPTION 'a sale past the daily cap went through';
    EXCEPTION WHEN raise_exception THEN
      RESET ROLE;
      IF SQLERRM <> 'daily coin limit reached' THEN RAISE; END IF;
    END;
    SELECT count(*) INTO v_left FROM public.user_inventory WHERE id = v_item;
    IF v_left <> 1 THEN
      RAISE EXCEPTION 'the capped sale deleted the item';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'probe_rollback';
  EXCEPTION WHEN raise_exception THEN
    RESET ROLE;
    IF SQLERRM <> 'probe_rollback' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
END
$$;
