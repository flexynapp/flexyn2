-- 078_atomic_cancel_listing.sql
--
-- Closes a real orphan-inventory bug in src/components/hub/MarketplaceFeed.jsx:
--
--   await marketplace.cancelListing(listing.id);              // sets status=cancelled
--   await inventory.setListed(listing.inventory_id, false);   // releases inventory
--
-- These are two independent writes from the client. If the first
-- succeeds and the second fails (network blip, RLS denial, tab close
-- in the middle), the listing row is cancelled but the inventory row
-- stays is_listed=true forever. The item then:
--   • doesn't appear in the user's bag (filter is is_listed=false)
--   • can't be re-listed (create_marketplace_listing rejects with
--     "item already listed")
--   • can't be sold/traded
-- Effectively the item is dead — orphaned from both surfaces.
--
-- Atomic RPC takes a single write that flips both fields under one
-- transaction. Locks the listing row + inventory row, validates the
-- caller is the seller (RLS-equivalent check inside the function
-- because SECURITY DEFINER bypasses RLS).

CREATE OR REPLACE FUNCTION public.cancel_marketplace_listing(p_listing_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_email   TEXT;
  v_listing public.marketplace_listings%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_listing_id IS NULL THEN
    RAISE EXCEPTION 'listing_id required' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;

  -- Lock the listing row. Concurrent cancels serialize.
  SELECT * INTO v_listing
    FROM public.marketplace_listings
   WHERE id = p_listing_id
   FOR UPDATE;

  IF v_listing.id IS NULL THEN
    RAISE EXCEPTION 'listing not found' USING ERRCODE = '22023';
  END IF;

  -- Ownership check. SECURITY DEFINER bypasses RLS so we re-implement
  -- it here. Either the user_id OR the legacy seller_email column
  -- can identify the owner depending on which migration era the
  -- listing was created in.
  IF v_listing.seller_user_id IS DISTINCT FROM v_uid
     AND v_listing.seller_email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'not your listing' USING ERRCODE = '42501';
  END IF;

  -- Already cancelled / completed — idempotent return.
  IF v_listing.status <> 'active' THEN
    RETURN jsonb_build_object(
      'success',          TRUE,
      'already_inactive', TRUE,
      'listing_id',       p_listing_id,
      'status',           v_listing.status
    );
  END IF;

  -- Flip both fields in one transaction. If either UPDATE fails the
  -- transaction rolls back and the caller can retry without the
  -- orphan-inventory state landing.
  UPDATE public.marketplace_listings
     SET status = 'cancelled'
   WHERE id = p_listing_id;

  IF v_listing.inventory_id IS NOT NULL THEN
    UPDATE public.user_inventory
       SET is_listed = FALSE
     WHERE id = v_listing.inventory_id;
  END IF;

  RETURN jsonb_build_object(
    'success',          TRUE,
    'already_inactive', FALSE,
    'listing_id',       p_listing_id,
    'inventory_id',     v_listing.inventory_id,
    'status',           'cancelled'
  );
END;
$$;

REVOKE ALL  ON FUNCTION public.cancel_marketplace_listing(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_marketplace_listing(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
