-- 121_marketplace_wishlist.sql
--
-- "Save for later" on marketplace listings. Per-viewer per-listing row;
-- RLS restricts to owner-only reads/writes so wishlists are private.
-- Listings that get sold or cancelled stay in the wishlist (as a
-- "watch the seller in case they relist" signal) — we filter the
-- rendered list to active rows client-side.

CREATE TABLE IF NOT EXISTS public.marketplace_wishlist (
  user_id     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id  UUID         NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_wishlist_user
  ON public.marketplace_wishlist(user_id, created_at DESC);

ALTER TABLE public.marketplace_wishlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketplace_wishlist: owner read" ON public.marketplace_wishlist;
CREATE POLICY "marketplace_wishlist: owner read"
  ON public.marketplace_wishlist FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "marketplace_wishlist: owner insert" ON public.marketplace_wishlist;
CREATE POLICY "marketplace_wishlist: owner insert"
  ON public.marketplace_wishlist FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "marketplace_wishlist: owner delete" ON public.marketplace_wishlist;
CREATE POLICY "marketplace_wishlist: owner delete"
  ON public.marketplace_wishlist FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.marketplace_wishlist TO authenticated;

NOTIFY pgrst, 'reload schema';
