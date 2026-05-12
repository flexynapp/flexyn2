-- 025_marketplace_atomic_purchase.sql
--
-- Marketplace integrity hardening. Three issues addressed:
--
-- 1. CLIENT-ORCHESTRATED PURCHASES (race + cheat surface).
--    The old client flow did: read buyer coins → deduct → insert buyer
--    item → delete seller item → credit seller → mark listing complete,
--    as 5 separate writes with no transaction. Any failure mid-flight
--    (network drop after step 2) left the buyer charged with no item.
--    Worse: two buyers racing on the same listing both passed the
--    `status='active'` check and both consumed the item. And a tampered
--    client could skip the deduct step entirely.
--
--    The purchase_listing RPC below performs all five steps inside a
--    single transaction with a row-level lock on the listing. It validates
--    on the server that the buyer can afford it and that the listing is
--    still active before doing any writes. Other failures roll everything
--    back via SQL transaction semantics.
--
-- 2. LISTING OWNERSHIP NOT VALIDATED on creation.
--    RLS only checked `seller_user_id = auth.uid()`, not that the seller
--    actually owns the referenced `inventory_id`. A malicious client could
--    list someone else's inventory row. The create_marketplace_listing
--    RPC below validates ownership before inserting.
--
-- 3. NO PRICE FLOOR.
--    Clients could submit `asking_price = 0` or negative. CHECK constraint
--    below enforces price >= 1 for sale listings.

-- ── Price floor ──────────────────────────────────────────────────────────────
-- Drop+recreate if it already exists; idempotent across re-runs.
ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_price_positive;
ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_price_positive
  CHECK (
    listing_type <> 'sale'
    OR (asking_price IS NOT NULL AND asking_price >= 1)
  );

-- ── Atomic purchase ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purchase_listing(p_listing_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_buyer_uid    UUID := auth.uid();
  v_buyer_email  TEXT := auth.email();
  v_buyer_coins  INTEGER;
  v_listing      public.marketplace_listings%ROWTYPE;
  v_inventory    public.user_inventory%ROWTYPE;
  v_new_inv_id   UUID;
BEGIN
  IF v_buyer_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_listing_id IS NULL THEN
    RAISE EXCEPTION 'listing_id required' USING ERRCODE = '22023';
  END IF;

  -- 1. Lock the listing row for the duration of this transaction so a
  --    concurrent buyer can't also claim it.
  SELECT * INTO v_listing
    FROM public.marketplace_listings
   WHERE id = p_listing_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing not found' USING ERRCODE = '22023';
  END IF;
  IF v_listing.status <> 'active' THEN
    RAISE EXCEPTION 'listing is %', v_listing.status USING ERRCODE = '22023';
  END IF;
  IF v_listing.listing_type <> 'sale' THEN
    RAISE EXCEPTION 'only sale listings can be purchased via this RPC'
      USING ERRCODE = '22023';
  END IF;
  IF v_listing.seller_user_id = v_buyer_uid THEN
    RAISE EXCEPTION 'cannot purchase your own listing' USING ERRCODE = '22023';
  END IF;

  -- 2. Make sure the listed inventory item still exists and is owned by
  --    the seller. If the seller equipped/sold/lost the item by another
  --    path, the listing is stale — refund (no-op here, just fail) and
  --    cancel the listing so buyer gets a clear error.
  SELECT * INTO v_inventory
    FROM public.user_inventory
   WHERE id = v_listing.inventory_id
     AND user_id = v_listing.seller_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.marketplace_listings
       SET status = 'cancelled'
     WHERE id = p_listing_id;
    RAISE EXCEPTION 'item no longer available' USING ERRCODE = '22023';
  END IF;

  -- 3. Check buyer can afford it (lock buyer row).
  SELECT COALESCE(flex_coins, 0) INTO v_buyer_coins
    FROM public.user_profiles
   WHERE id = v_buyer_uid
     FOR UPDATE;
  IF v_buyer_coins IS NULL THEN
    RAISE EXCEPTION 'buyer profile not found' USING ERRCODE = '22023';
  END IF;
  IF v_buyer_coins < v_listing.asking_price THEN
    RAISE EXCEPTION 'insufficient_coins: have %, need %', v_buyer_coins, v_listing.asking_price
      USING ERRCODE = '22023';
  END IF;

  -- 4. Atomic state change inside this transaction:
  --    a. Deduct from buyer.
  --    b. Credit seller.
  --    c. Move inventory ownership to buyer (cheaper than delete+insert).
  --    d. Mark listing completed.
  UPDATE public.user_profiles
     SET flex_coins = flex_coins - v_listing.asking_price
   WHERE id = v_buyer_uid;

  UPDATE public.user_profiles
     SET flex_coins = COALESCE(flex_coins, 0) + v_listing.asking_price
   WHERE id = v_listing.seller_user_id;

  -- Transfer the existing inventory row. is_listed = false because it's
  -- no longer up for sale. user_id changes to the buyer.
  UPDATE public.user_inventory
     SET user_id     = v_buyer_uid,
         user_email  = v_buyer_email,
         is_listed   = false
   WHERE id = v_inventory.id
  RETURNING id INTO v_new_inv_id;

  UPDATE public.marketplace_listings
     SET status = 'completed'
   WHERE id = p_listing_id;

  RETURN jsonb_build_object(
    'listing_id',   p_listing_id,
    'inventory_id', v_new_inv_id,
    'price',        v_listing.asking_price,
    'buyer_coins',  v_buyer_coins - v_listing.asking_price
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.purchase_listing(UUID) TO authenticated;

-- ── Listing creation with ownership validation ───────────────────────────────
CREATE OR REPLACE FUNCTION public.create_marketplace_listing(
  p_inventory_id     UUID,
  p_listing_type     TEXT,
  p_asking_price     INTEGER,
  p_trade_for_rarity TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller_uid   UUID := auth.uid();
  v_seller_email TEXT := auth.email();
  v_inv          public.user_inventory%ROWTYPE;
  v_username     TEXT;
  v_listing_id   UUID;
BEGIN
  IF v_seller_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_listing_type NOT IN ('sale', 'trade') THEN
    RAISE EXCEPTION 'invalid listing_type: %', p_listing_type USING ERRCODE = '22023';
  END IF;
  IF p_listing_type = 'sale' AND (p_asking_price IS NULL OR p_asking_price < 1) THEN
    RAISE EXCEPTION 'sale listings require asking_price >= 1' USING ERRCODE = '22023';
  END IF;

  -- Validate ownership — caller MUST own this inventory row.
  SELECT * INTO v_inv
    FROM public.user_inventory
   WHERE id = p_inventory_id
     AND user_id = v_seller_uid
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory item not found or not owned by caller' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_inv.is_listed, false) THEN
    RAISE EXCEPTION 'item already listed' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(username, '') INTO v_username
    FROM public.user_profiles
   WHERE id = v_seller_uid;

  INSERT INTO public.marketplace_listings (
    seller_user_id, seller_email, seller_username,
    inventory_id, item_id, item_name, item_emoji, item_rarity,
    listing_type, asking_price, trade_for_rarity, status
  ) VALUES (
    v_seller_uid, v_seller_email, COALESCE(v_username, ''),
    p_inventory_id, v_inv.item_id, v_inv.item_name,
    COALESCE(v_inv.item_emoji, ''), COALESCE(v_inv.item_rarity, 'common'),
    p_listing_type, p_asking_price, p_trade_for_rarity, 'active'
  ) RETURNING id INTO v_listing_id;

  -- Mark the inventory row as listed so it doesn't appear in the bag.
  UPDATE public.user_inventory
     SET is_listed = true
   WHERE id = p_inventory_id;

  RETURN v_listing_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_marketplace_listing(UUID, TEXT, INTEGER, TEXT)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
