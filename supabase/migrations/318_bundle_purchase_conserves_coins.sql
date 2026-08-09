-- 318_bundle_purchase_conserves_coins.sql
--
-- purchase_bundle minted Flex Coins on every sale.
--
-- The buyer was debited the DISCOUNTED total and every seller was credited
-- their FULL asking price:
--
--   UPDATE user_profiles SET flex_coins = flex_coins - v_discounted ...  -- buyer
--   UPDATE user_profiles SET flex_coins = flex_coins + v_price      ...  -- seller
--
-- so each purchase created `total_price - discounted_price` coins out of
-- nothing. discount_pct is CHECK (1..75), so up to 75% of the bundle's face
-- value was minted per sale.
--
-- This is NOT dormant, despite there being no create-bundle screen in the
-- app. `bundles: seller manage` is FOR ALL TO authenticated with
-- `auth.uid() = seller_user_id`, so any signed-in user can INSERT a bundle
-- straight through PostgREST; and `marketplace: sellers can update own
-- listings` carries no column guard, so the same user can point their own
-- listings at it and set asking_price to whatever they like. Two accounts —
-- one lists and bundles, the other buys — net a mint on every call, bounded
-- only by the 50,000/24h credit ceiling that flex_coin_ledger_and_cap()
-- enforces per recipient.
--
-- Audited before writing this: marketplace_bundles is empty (0 rows), no
-- listing carries a bundle_id, and flex_coin_ledger holds no row sourced
-- from purchase_bundle. Nothing has been minted yet. This closes the hole
-- before the create-bundle flow that would open it in the product.
--
-- THE INVARIANT: what the buyer pays is exactly what the sellers receive.
-- Sellers are paid pro-rata on asking_price out of the discounted total, and
-- the discount is borne by the sellers who chose to offer it — which is what
-- a discount is. Integer division cannot lose or invent a coin: every share
-- but the last is floored, and the last row takes the remainder, so the
-- distributed total is `v_charge` by construction. A closing assertion fails
-- the transaction if a future edit ever breaks that.
--
-- Paste-safety (see CLAUDE.md): no `alias.column` tokens, no %ROWTYPE record
-- access, every statement single-table with bare columns.

CREATE OR REPLACE FUNCTION public.purchase_bundle(p_bundle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_buyer_id      UUID := auth.uid();
  v_buyer_email   TEXT := NULLIF(public.current_user_email(), '');
  v_bundle_status TEXT;
  v_bundle_seller UUID;
  v_discount_pct  NUMERIC;
  v_lid           UUID;
  v_price         INTEGER;
  v_inv           UUID;
  v_seller        UUID;
  v_total_price   INTEGER := 0;
  v_charge        INTEGER;
  v_buyer_coins   INTEGER;
  v_listing_ids   UUID[] := '{}';
  v_count         INTEGER;
  v_idx           INTEGER := 0;
  v_share         INTEGER;
  v_paid_out      INTEGER := 0;
BEGIN
  IF v_buyer_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT status, seller_user_id, discount_pct
    INTO v_bundle_status, v_bundle_seller, v_discount_pct
    FROM public.marketplace_bundles
   WHERE id = p_bundle_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bundle_not_found';
  END IF;
  IF v_bundle_status <> 'active' THEN
    RAISE EXCEPTION 'bundle_not_available';
  END IF;
  IF v_bundle_seller = v_buyer_id THEN
    RAISE EXCEPTION 'cannot_buy_own_bundle';
  END IF;

  -- Lock the sale rows and total their asking prices.
  --
  -- Only listing_type = 'sale' takes part, as before: the RPC never charged
  -- for a trade listing and never transferred one, so counting them would
  -- inflate the total the discount is taken from.
  FOR v_lid, v_price, v_seller IN
    SELECT id, asking_price, seller_user_id
      FROM public.marketplace_listings
     WHERE bundle_id = p_bundle_id
       AND status = 'active'
       AND listing_type = 'sale'
     ORDER BY id
       FOR UPDATE
  LOOP
    -- The bundle's own seller is checked above, but a listing inside it can
    -- name a different one. If any of them is the buyer, they would pay into
    -- the bundle and be credited back out of it in the same transaction.
    IF v_seller = v_buyer_id THEN
      RAISE EXCEPTION 'cannot_buy_own_bundle';
    END IF;
    v_total_price := v_total_price + GREATEST(0, COALESCE(v_price, 0));
    v_listing_ids := array_append(v_listing_ids, v_lid);
  END LOOP;

  v_count := array_length(v_listing_ids, 1);
  IF v_count IS NULL THEN
    RAISE EXCEPTION 'bundle_empty';
  END IF;

  -- A bundle of free items costs nothing. The old GREATEST(1, ...) floor
  -- applied even at a zero total, which charged a coin nobody could be paid
  -- — a sink rather than a mint, but still a break in conservation.
  IF v_total_price <= 0 THEN
    v_charge := 0;
  ELSE
    v_charge := GREATEST(1, ROUND(v_total_price * (1 - v_discount_pct / 100.0)));
  END IF;

  SELECT COALESCE(flex_coins, 0) INTO v_buyer_coins
    FROM public.user_profiles
   WHERE id = v_buyer_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'buyer profile not found' USING ERRCODE = '22023';
  END IF;
  IF v_buyer_coins < v_charge THEN
    RAISE EXCEPTION 'insufficient_coins';
  END IF;

  IF v_charge > 0 THEN
    UPDATE public.user_profiles
       SET flex_coins = flex_coins - v_charge
     WHERE id = v_buyer_id;
  END IF;

  -- Distribute exactly v_charge. Ordered so the split is deterministic; the
  -- final row is handed the remainder rather than its floored share, which
  -- is what makes the total land on v_charge and not one coin under it per
  -- listing.
  FOR v_lid, v_price, v_inv, v_seller IN
    SELECT id, asking_price, inventory_id, seller_user_id
      FROM public.marketplace_listings
     WHERE id = ANY(v_listing_ids)
     ORDER BY asking_price DESC NULLS LAST, id
  LOOP
    v_idx := v_idx + 1;
    IF v_idx = v_count THEN
      v_share := v_charge - v_paid_out;
    ELSIF v_total_price > 0 THEN
      v_share := FLOOR(v_charge::numeric * GREATEST(0, COALESCE(v_price, 0)) / v_total_price);
    ELSE
      v_share := 0;
    END IF;
    v_paid_out := v_paid_out + v_share;

    IF v_share > 0 THEN
      UPDATE public.user_profiles
         SET flex_coins = COALESCE(flex_coins, 0) + v_share
       WHERE id = v_seller;
    END IF;

    -- user_email is denormalized for delivery and purchase_listing already
    -- keeps it in step on a transfer; this path never did, so a bundled item
    -- kept the seller's address after changing hands.
    UPDATE public.user_inventory
       SET user_id = v_buyer_id, user_email = v_buyer_email, is_listed = false
     WHERE id = v_inv;

    UPDATE public.marketplace_listings
       SET status = 'completed'
     WHERE id = v_lid;
  END LOOP;

  -- Conservation, asserted rather than assumed. Unreachable as written; it
  -- exists so a later edit to the split cannot quietly reopen the mint.
  IF v_paid_out <> v_charge THEN
    RAISE EXCEPTION 'bundle_payout_imbalance: charged %, distributed %',
      v_charge, v_paid_out USING ERRCODE = '23514';
  END IF;

  UPDATE public.marketplace_bundles
     SET status = 'completed'
   WHERE id = p_bundle_id;

  RETURN jsonb_build_object(
    'bundle_id',     p_bundle_id,
    'listing_count', v_count,
    'total_price',   v_total_price,
    'paid_price',    v_charge,
    'buyer_coins',   v_buyer_coins - v_charge);
END;
$function$;

-- Note on the ceiling: flex_coin_ledger_and_cap() may still clamp a seller's
-- credit if they are at their 50,000/24h limit, which leaves that purchase a
-- net sink. That is the app-wide convention for every credit path (CLAUDE.md,
-- migration 264) and is deliberately not special-cased here — a clamp can
-- only ever destroy coins, never create them.
