-- 321_seller_can_delete_own_listing.sql
--
-- Sellers keep the ability to delete their own listings. This migration does
-- not take it away — it makes it work, because the raw DELETE policy that
-- provided it silently corrupted the seller's own inventory.
--
-- ── What the raw policy did ──────────────────────────────────────────────────
--
-- `marketplace: sellers can delete own listings` is a plain
-- `DELETE ... USING (seller_user_id = auth.uid())`. Deleting the row is the
-- whole of what it does, and a listing is not the whole of what listing a
-- thing changes:
--
--   * `user_inventory.is_listed` stays TRUE. `cancel_marketplace_listing`
--     clears it in the same transaction and is the only thing that ever does.
--     An item stuck at is_listed=true is filtered out of the Bag's listable
--     set, so it is invisible AND cannot be re-listed — the exact orphan mig
--     078 was written to prevent, reachable again through the other door.
--   * Any `trade_offers` row aimed at the listing is left `pending` with the
--     OFFERER's item still escrowed (`create_trade_offer` sets
--     `escrow_offer_id` + `is_listed`). `trade_offers.listing_id` has no
--     foreign key, so nothing cascades and nothing tells them. They can still
--     withdraw by hand, but they are holding an offer against a listing that
--     no longer exists, and that is not a state we should be able to create.
--
-- ── What replaces it ─────────────────────────────────────────────────────────
--
-- Same shape migration 320 used for UPDATE: the policy and the table GRANT
-- both go, and the capability comes back as an RPC that does the whole job in
-- one transaction. The seller can still delete; they just cannot leave debris
-- behind while doing it.
--
-- Completed listings are refused, and that is the one place this is narrower
-- than the old policy. A completed row is not really the seller's listing any
-- more: the item belongs to the buyer, and `priceStatsForItem` reads exactly
-- these rows to answer "what has this actually sold for" — the panel the next
-- seller prices against. Deleting one edits shared history to remove a sale
-- that happened. `item_sold_counts` is a separate increment-only table and is
-- unaffected either way. Cancel or delete before it sells; after it sells, it
-- is a receipt.
--
-- Paste-safety (see CLAUDE.md): every statement single-table with bare
-- columns, scalar SELECT ... INTO rather than %ROWTYPE.

-- ── 1. Remove the raw path ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "marketplace: sellers can delete own listings"
  ON public.marketplace_listings;

REVOKE DELETE ON public.marketplace_listings FROM authenticated;

-- ── 2. Give it back as an RPC that cleans up after itself ────────────────────
CREATE OR REPLACE FUNCTION public.delete_my_listing(p_listing_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_seller    UUID;
  v_status    TEXT;
  v_inv       UUID;
  v_offer     UUID;
  v_offer_inv UUID;
  v_offers    INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_listing_id IS NULL THEN
    RAISE EXCEPTION 'listing_id required' USING ERRCODE = '22023';
  END IF;

  SELECT seller_user_id, status, inventory_id
    INTO v_seller, v_status, v_inv
    FROM public.marketplace_listings
   WHERE id = p_listing_id
     FOR UPDATE;

  -- Idempotent: deleting something already gone is the outcome the caller
  -- wanted, and a second tap on a slow connection should not raise.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'already_gone', true,
                              'listing_id', p_listing_id);
  END IF;

  -- seller_user_id, not seller_email: create_marketplace_listing stamps
  -- seller_email from auth.email(), which is '' for a guest account, so an
  -- email comparison never matches for them. Same reasoning as ListingCard.
  IF v_seller IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_your_listing' USING ERRCODE = '42501';
  END IF;

  IF v_status = 'completed' THEN
    RAISE EXCEPTION 'completed_sale_cannot_be_deleted' USING ERRCODE = '42501';
  END IF;

  -- Release every pending offer aimed at this listing BEFORE the row goes,
  -- so no one is left holding an escrowed item against a listing that no
  -- longer exists. Mirrors what respond_to_trade_offer does to the offers it
  -- supersedes.
  FOR v_offer, v_offer_inv IN
    SELECT id, from_inventory_id
      FROM public.trade_offers
     WHERE listing_id = p_listing_id
       AND status = 'pending'
       FOR UPDATE
  LOOP
    UPDATE public.trade_offers
       SET status = 'cancelled', responded_at = now()
     WHERE id = v_offer;

    UPDATE public.user_inventory
       SET escrow_offer_id = NULL, is_listed = FALSE
     WHERE id = v_offer_inv AND escrow_offer_id = v_offer;

    v_offers := v_offers + 1;
  END LOOP;

  -- Then the seller's own item — the step the raw DELETE never had.
  -- `escrow_offer_id IS NULL` so an item tied up in some other trade is not
  -- quietly un-escrowed as a side effect of tidying up a listing.
  IF v_inv IS NOT NULL THEN
    UPDATE public.user_inventory
       SET is_listed = FALSE
     WHERE id = v_inv
       AND user_id = v_uid
       AND escrow_offer_id IS NULL;
  END IF;

  -- marketplace_wishlist.listing_id is ON DELETE CASCADE, so anyone who
  -- hearted this listing simply stops having it saved. That is correct.
  DELETE FROM public.marketplace_listings WHERE id = p_listing_id;

  RETURN jsonb_build_object(
    'deleted',          true,
    'listing_id',       p_listing_id,
    'inventory_id',     v_inv,
    'offers_cancelled', v_offers);
END;
$function$;

-- Same ACL the other marketplace RPCs carry.
REVOKE ALL ON FUNCTION public.delete_my_listing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_my_listing(uuid) TO authenticated, service_role;
