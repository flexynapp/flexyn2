-- 122_marketplace_featured.sql
--
-- Editorial "Featured this week" slot on marketplace listings. An
-- admin (from Wave E's is_app_admin) marks a listing as featured
-- with an expiration; the marketplace renders a top rail collecting
-- every listing where now() < featured_until.
--
-- Schema
--   marketplace_listings.is_featured BOOLEAN — fast index filter
--   marketplace_listings.featured_until TIMESTAMPTZ — auto-expiry
--
-- Why both columns: is_featured powers the partial index for
-- "where is_featured = TRUE" — order-of-magnitude faster than
-- scanning every listing every render.

ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS is_featured    BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS featured_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_marketplace_listings_featured
  ON public.marketplace_listings(featured_until)
  WHERE is_featured = TRUE;

-- ─────────────────────────────────────────────────────────────────────
-- Admin RPC: set_featured(listing, until)
--
-- Gated on is_app_admin (mig 103). Sets/clears both flags atomically.
-- Pass NULL `until` to clear the feature.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_listing_featured(
  p_listing_id UUID,
  p_until      TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_app_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.marketplace_listings
     SET is_featured    = (p_until IS NOT NULL AND p_until > now()),
         featured_until = p_until
   WHERE id = p_listing_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_listing_featured(UUID, TIMESTAMPTZ) TO authenticated;

NOTIFY pgrst, 'reload schema';
