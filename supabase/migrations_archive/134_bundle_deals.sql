-- 134_bundle_deals.sql
--
-- Bundle deals: a seller can group marketplace listings into a named
-- bundle and offer a percentage discount when a buyer purchases all
-- items together. The bundle is identified by a UUID stored on each
-- member listing; the discount_pct lives on the bundle row so it
-- applies uniformly to all members.
--
-- Schema:
--   marketplace_bundles   — one row per bundle deal
--   marketplace_listings  — gains bundle_id FK (nullable)
--
-- Client flow:
--   1. Seller creates a bundle (POST → insert marketplace_bundles).
--   2. Seller links listings via update marketplace_listings SET bundle_id.
--   3. Buyer sees grouped cards with "Bundle deal — X% off" badge.
--   4. Buyer taps "Buy bundle" → purchase_bundle RPC atomically processes
--      all member listings in one transaction.

-- ── marketplace_bundles ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.marketplace_bundles (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_email    TEXT        NOT NULL,
  title           TEXT        NOT NULL,
  discount_pct    INTEGER     NOT NULL DEFAULT 10 CHECK (discount_pct BETWEEN 1 AND 75),
  status          TEXT        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mktplace_bundles_seller
  ON public.marketplace_bundles(seller_email, status);

ALTER TABLE public.marketplace_bundles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bundles: read all" ON public.marketplace_bundles;
CREATE POLICY "bundles: read all"
  ON public.marketplace_bundles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "bundles: seller manage" ON public.marketplace_bundles;
CREATE POLICY "bundles: seller manage"
  ON public.marketplace_bundles FOR ALL TO authenticated
  USING (auth.uid() = seller_user_id)
  WITH CHECK (auth.uid() = seller_user_id);

GRANT SELECT, INSERT, UPDATE ON public.marketplace_bundles TO authenticated;

-- ── marketplace_listings — add bundle_id ─────────────────────────────────────

ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS bundle_id UUID REFERENCES public.marketplace_bundles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mktplace_listings_bundle
  ON public.marketplace_listings(bundle_id)
  WHERE bundle_id IS NOT NULL;

-- ── purchase_bundle RPC ───────────────────────────────────────────────────────
-- Atomically purchases all active sale listings in a bundle.
-- Deducts the total price × (1 - discount_pct/100) from the buyer's
-- flex_coins in one UPDATE, transfers each item, and marks all listings
-- + the bundle as completed.

CREATE OR REPLACE FUNCTION public.purchase_bundle(
  p_bundle_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_buyer_id   UUID := auth.uid();
  v_bundle     RECORD;
  v_listings   RECORD;
  v_total_price INTEGER := 0;
  v_discounted  INTEGER;
  v_buyer_coins INTEGER;
  v_listing_ids UUID[] := '{}';
BEGIN
  -- Lock + fetch bundle
  SELECT * INTO v_bundle FROM public.marketplace_bundles
   WHERE id = p_bundle_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bundle_not_found';
  END IF;
  IF v_bundle.status <> 'active' THEN
    RAISE EXCEPTION 'bundle_not_available';
  END IF;
  IF v_bundle.seller_user_id = v_buyer_id THEN
    RAISE EXCEPTION 'cannot_buy_own_bundle';
  END IF;

  -- Collect active sale listings in bundle
  FOR v_listings IN
    SELECT id, asking_price, inventory_id, seller_user_id
      FROM public.marketplace_listings
     WHERE bundle_id = p_bundle_id
       AND status = 'active'
       AND listing_type = 'sale'
     FOR UPDATE
  LOOP
    v_total_price := v_total_price + COALESCE(v_listings.asking_price, 0);
    v_listing_ids := array_append(v_listing_ids, v_listings.id);
  END LOOP;

  IF array_length(v_listing_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'bundle_empty';
  END IF;

  -- Apply discount
  v_discounted := GREATEST(1, ROUND(v_total_price * (1 - v_bundle.discount_pct::numeric / 100)));

  -- Check buyer balance
  SELECT flex_coins INTO v_buyer_coins FROM public.user_profiles
   WHERE user_id = v_buyer_id FOR UPDATE;
  IF v_buyer_coins < v_discounted THEN
    RAISE EXCEPTION 'insufficient_coins';
  END IF;

  -- Deduct buyer
  UPDATE public.user_profiles SET flex_coins = flex_coins - v_discounted
   WHERE user_id = v_buyer_id;

  -- Process each listing
  FOR v_listings IN
    SELECT id, asking_price, inventory_id, seller_user_id
      FROM public.marketplace_listings
     WHERE id = ANY(v_listing_ids)
  LOOP
    -- Credit seller
    UPDATE public.user_profiles SET flex_coins = flex_coins + COALESCE(v_listings.asking_price, 0)
     WHERE user_id = v_listings.seller_user_id;

    -- Transfer item
    UPDATE public.user_inventory SET user_id = v_buyer_id, is_listed = false
     WHERE id = v_listings.inventory_id;

    -- Mark listing completed
    UPDATE public.marketplace_listings SET status = 'completed'
     WHERE id = v_listings.id;
  END LOOP;

  -- Mark bundle completed
  UPDATE public.marketplace_bundles SET status = 'completed'
   WHERE id = p_bundle_id;

  RETURN jsonb_build_object(
    'bundle_id',    p_bundle_id,
    'listing_count', array_length(v_listing_ids, 1),
    'total_price',  v_total_price,
    'paid_price',   v_discounted,
    'buyer_coins',  v_buyer_coins - v_discounted
  );
END;
$func$;

REVOKE ALL ON FUNCTION public.purchase_bundle(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purchase_bundle(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
