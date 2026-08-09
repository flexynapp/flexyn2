-- 319_marketplace_listing_terms_are_rpc_only.sql
--
-- `marketplace: sellers can update own listings` was an unrestricted UPDATE:
--
--   USING      (seller_user_id = auth.uid())
--   WITH CHECK (seller_user_id = auth.uid())
--
-- Row-level, but not column-level — Postgres RLS cannot express "these
-- columns only" — so a seller could rewrite EVERY field of their own listing
-- straight through PostgREST. Three consequences, in order of severity:
--
-- 1. **Self-promotion.** `is_featured` / `featured_until` drive the gold
--    ribbon and float the row to the top of the grid, and the only intended
--    writer is `set_listing_featured`, which raises `admin_only` unless
--    `is_app_admin(auth.uid())`. The policy handed every seller the thing the
--    RPC exists to withhold. An admin-only grant that any user can award
--    themselves is not an admin-only grant.
--
-- 2. **Bait and switch.** `item_name`, `item_emoji`, `item_rarity` and
--    `item_id` are denormalized onto the listing for display, while
--    `inventory_id` is what `purchase_listing` actually transfers. Nothing
--    tied them together after creation, so a seller could advertise a
--    legendary and hand over the common the inventory row really holds. The
--    buyer's own client shows them the forged rarity right up to the receipt.
--
-- 3. **Price switching.** `purchase_listing` re-reads the row `FOR UPDATE`
--    and charges what it finds, which is correct for concurrency and exactly
--    wrong here: the seller can raise `asking_price` under a buyer who is
--    looking at the old number, and the buyer pays the new one.
--
-- The fix is the shape migrations 142 and 173 already use for
-- `user_profiles`: the write path is the RPC, and the table refuses direct
-- client writes. Two independent layers, because either alone has a gap.
--
--   * The policy is DROPPED. Deny-by-default is what makes a column added
--     next year safe without anyone remembering this file.
--   * A BEFORE UPDATE trigger freezes the columns anyway, so if a permissive
--     policy is ever restored the terms of a live listing still cannot move.
--
-- Nothing legitimate loses a path. All six functions that write this table —
-- create_marketplace_listing, cancel_marketplace_listing, purchase_listing,
-- purchase_bundle, respond_to_trade_offer, set_listing_featured — are
-- SECURITY DEFINER and owned by postgres, so `current_user` inside them is
-- `postgres` and the trigger returns early, exactly as
-- user_profiles_block_privileged_updates does. The trigger is deliberately
-- NOT SECURITY DEFINER; that is what makes `current_user` mean the caller.
--
-- The only client code that wrote this table directly was dead: marketplace.js
-- `completeListing()` had no callers at all, and the direct UPDATE inside
-- `cancelListing()` is a pre-078 fallback that only runs when
-- `cancel_marketplace_listing` is missing — it is installed here. Both are
-- removed in the same commit so nothing is left pointing at a door that is
-- now shut.
--
-- Paste-safety (see CLAUDE.md): NEW. / OLD. are the allowed record prefixes;
-- every statement is single-table with bare columns.

-- ── 1. Remove the client's write path ────────────────────────────────────
DROP POLICY IF EXISTS "marketplace: sellers can update own listings"
  ON public.marketplace_listings;

-- ── 2. Freeze the terms regardless of policy ─────────────────────────────
CREATE OR REPLACE FUNCTION public.marketplace_listings_block_direct_updates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- SECURITY DEFINER RPCs run as their owner; this is the seam that lets the
  -- server keep writing while the client cannot.
  IF current_user = 'postgres' OR current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.is_featured IS DISTINCT FROM OLD.is_featured
     OR NEW.featured_until IS DISTINCT FROM OLD.featured_until THEN
    RAISE EXCEPTION 'featuring is RPC-only and admin-only (use set_listing_featured)'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.asking_price IS DISTINCT FROM OLD.asking_price
     OR NEW.trade_for_rarity IS DISTINCT FROM OLD.trade_for_rarity
     OR NEW.listing_type IS DISTINCT FROM OLD.listing_type THEN
    RAISE EXCEPTION 'listing terms are fixed once listed — cancel and re-list'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.inventory_id IS DISTINCT FROM OLD.inventory_id
     OR NEW.item_id IS DISTINCT FROM OLD.item_id
     OR NEW.item_name IS DISTINCT FROM OLD.item_name
     OR NEW.item_emoji IS DISTINCT FROM OLD.item_emoji
     OR NEW.item_rarity IS DISTINCT FROM OLD.item_rarity THEN
    RAISE EXCEPTION 'the item a listing points at cannot change (use create_marketplace_listing)'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.seller_user_id IS DISTINCT FROM OLD.seller_user_id
     OR NEW.seller_email IS DISTINCT FROM OLD.seller_email
     OR NEW.seller_username IS DISTINCT FROM OLD.seller_username THEN
    RAISE EXCEPTION 'listing ownership is RPC-only' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'listing status is RPC-only (use cancel_marketplace_listing)'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.bundle_id IS DISTINCT FROM OLD.bundle_id THEN
    RAISE EXCEPTION 'bundle membership is RPC-only' USING ERRCODE = '42501';
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'created_at is immutable' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- Postgres has no CREATE TRIGGER IF NOT EXISTS; guard so a re-run is clean.
DROP TRIGGER IF EXISTS marketplace_listings_block_direct_updates_tr
  ON public.marketplace_listings;
CREATE TRIGGER marketplace_listings_block_direct_updates_tr
  BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_listings_block_direct_updates();

-- Not addressed here, and worth knowing: `marketplace: sellers can delete own
-- listings` is still open, so a seller can DELETE a row rather than cancelling
-- it. That destroys the audit trail a completed sale leaves behind but mints
-- nothing and transfers nothing, so it is a separate question about whether
-- listings should be deletable at all.
