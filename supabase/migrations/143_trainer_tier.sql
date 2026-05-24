-- 143_trainer_tier.sql
--
-- Proprietary Creator / Trainer Tier — paywalled regimen marketplace.
--
-- DESIGN NOTES (read before extending):
--   • Adapted from the original spec, which referenced a non-existent
--     `public.profiles` table and a generic `marketplace_listings`.
--     Flexyn's identity table is `user_profiles` (its `id` already
--     equals auth.uid()), and `marketplace_listings` already exists as
--     a COIN-based peer-to-peer table (mig 009). To avoid colliding
--     with that, the trainer tier uses dedicated tables:
--       - trainer_listings   (paywalled programs for sale)
--       - trainer_purchases  (access grants / receipts)
--
--   • PAYMENT RAIL: built toward Stripe Connect (real money). Stripe
--     is NOT live yet — no keys configured. The checkout Edge Function
--     runs in MOCK mode until STRIPE_SECRET_KEY is set, simulating a
--     successful payment so the gated-content flow works end-to-end
--     for the prototype. Columns (stripe_connect_id,
--     stripe_payment_intent_id) are in place for the real integration.
--
--   • FULFILLMENT IS SERVER-ONLY. trainer_purchases has NO authenticated
--     INSERT policy — rows are written exclusively by the checkout
--     Edge Function using the service-role key AFTER validating payment
--     (or, in mock mode, simulating it). A user cannot self-grant access
--     by calling an RPC directly. This is the paywall's real defense.
--
-- All statements are idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS /
-- CREATE OR REPLACE) so re-running the deploy bundle is safe.

-- ── 1. user_profiles: trainer status + Stripe merchant link ────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_trainer        BOOLEAN DEFAULT FALSE;
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS stripe_connect_id TEXT DEFAULT NULL;
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS trainer_bio       TEXT DEFAULT NULL;

-- ── 2. regimens: free-content flag for the gated read policy ───────
-- The spec's gated RLS references is_public_free; the column didn't
-- exist. Default FALSE so existing regimens stay private to their
-- owner unless explicitly published free or sold.
ALTER TABLE public.regimens
  ADD COLUMN IF NOT EXISTS is_public_free BOOLEAN DEFAULT FALSE;

-- ── 3. trainer_listings — paywalled programs ───────────────────────
CREATE TABLE IF NOT EXISTS public.trainer_listings (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id   UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    regimen_id   UUID REFERENCES public.regimens(id) ON DELETE SET NULL,
    title        TEXT NOT NULL,
    description  TEXT,
    price_cents  INTEGER NOT NULL CHECK (price_cents >= 100),  -- $1.00 minimum
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    -- denormalized rollups for the studio dashboard (kept fresh by
    -- the purchase trigger below) so revenue reads don't scan
    -- trainer_purchases every render.
    sales_count  INTEGER NOT NULL DEFAULT 0,
    gross_cents  BIGINT  NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trainer_listings_trainer_idx
  ON public.trainer_listings (trainer_id);
CREATE INDEX IF NOT EXISTS trainer_listings_published_idx
  ON public.trainer_listings (is_published) WHERE is_published = TRUE;

ALTER TABLE public.trainer_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trainer_listings: public read published" ON public.trainer_listings;
DROP POLICY IF EXISTS "trainer_listings: trainer reads own"     ON public.trainer_listings;
DROP POLICY IF EXISTS "trainer_listings: trainer insert own"    ON public.trainer_listings;
DROP POLICY IF EXISTS "trainer_listings: trainer update own"    ON public.trainer_listings;
DROP POLICY IF EXISTS "trainer_listings: trainer delete own"    ON public.trainer_listings;

-- Anyone authenticated can browse published listings (the storefront).
CREATE POLICY "trainer_listings: public read published"
  ON public.trainer_listings FOR SELECT TO authenticated
  USING (is_published = TRUE);

-- A trainer can always read their own listings (incl. drafts).
CREATE POLICY "trainer_listings: trainer reads own"
  ON public.trainer_listings FOR SELECT TO authenticated
  USING (trainer_id = auth.uid());

-- Insert/update/delete gated to the owning trainer. The is_trainer
-- flag is checked at insert so non-trainers can't create listings.
CREATE POLICY "trainer_listings: trainer insert own"
  ON public.trainer_listings FOR INSERT TO authenticated
  WITH CHECK (
    trainer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
       WHERE up.id = auth.uid() AND up.is_trainer = TRUE
    )
  );

CREATE POLICY "trainer_listings: trainer update own"
  ON public.trainer_listings FOR UPDATE TO authenticated
  USING (trainer_id = auth.uid())
  WITH CHECK (trainer_id = auth.uid());

CREATE POLICY "trainer_listings: trainer delete own"
  ON public.trainer_listings FOR DELETE TO authenticated
  USING (trainer_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_listings TO authenticated;

-- ── 4. trainer_purchases — access grants / receipts ────────────────
CREATE TABLE IF NOT EXISTS public.trainer_purchases (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    listing_id               UUID NOT NULL REFERENCES public.trainer_listings(id) ON DELETE RESTRICT,
    trainer_id               UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    regimen_id               UUID REFERENCES public.regimens(id) ON DELETE SET NULL,
    stripe_payment_intent_id TEXT UNIQUE NOT NULL,
    amount_paid_cents        INTEGER NOT NULL CHECK (amount_paid_cents >= 0),
    platform_fee_cents       INTEGER NOT NULL CHECK (platform_fee_cents >= 0),  -- 15% native cut
    trainer_payout_cents     INTEGER NOT NULL CHECK (trainer_payout_cents >= 0), -- 85% trainer cut
    is_mock                  BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE = simulated (no real Stripe charge)
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Split must reconcile: amount = platform fee + trainer payout.
    CONSTRAINT trainer_purchase_split_balances
      CHECK (amount_paid_cents = platform_fee_cents + trainer_payout_cents),
    -- One purchase per (user, listing) — can't buy the same program twice.
    UNIQUE (user_id, listing_id)
);

CREATE INDEX IF NOT EXISTS trainer_purchases_user_idx     ON public.trainer_purchases (user_id);
CREATE INDEX IF NOT EXISTS trainer_purchases_trainer_idx  ON public.trainer_purchases (trainer_id);
CREATE INDEX IF NOT EXISTS trainer_purchases_listing_idx  ON public.trainer_purchases (listing_id);

ALTER TABLE public.trainer_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trainer_purchases: buyer reads own"    ON public.trainer_purchases;
DROP POLICY IF EXISTS "trainer_purchases: trainer reads sales" ON public.trainer_purchases;

-- Buyer can read their own receipts (drives "owned" state in the UI).
CREATE POLICY "trainer_purchases: buyer reads own"
  ON public.trainer_purchases FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Trainer can read purchases of their own listings (revenue dashboard).
CREATE POLICY "trainer_purchases: trainer reads sales"
  ON public.trainer_purchases FOR SELECT TO authenticated
  USING (trainer_id = auth.uid());

-- NOTE: deliberately NO authenticated INSERT/UPDATE/DELETE policy.
-- Fulfillment is written ONLY by the checkout Edge Function using the
-- service-role key (which bypasses RLS) after validating payment.
-- This is what stops a user from self-granting paid access.
GRANT SELECT ON public.trainer_purchases TO authenticated;

-- ── 5. Gated regimen read — extend, don't replace ──────────────────
-- The existing "regimens: owner full access" policy (mig 001) is
-- FOR ALL and stays untouched. Permissive policies are OR'd, so this
-- additional SELECT policy widens read access to: free programs, and
-- programs the caller has purchased through the trainer marketplace.
DROP POLICY IF EXISTS "regimens: gated marketplace read" ON public.regimens;
CREATE POLICY "regimens: gated marketplace read"
  ON public.regimens FOR SELECT TO authenticated
  USING (
    is_public_free = TRUE
    OR EXISTS (
      SELECT 1
        FROM public.trainer_listings tl
        JOIN public.trainer_purchases tp ON tp.listing_id = tl.id
       WHERE tl.regimen_id = public.regimens.id
         AND tp.user_id = auth.uid()
    )
  );

-- ── 6. Purchase rollup trigger — keep listing stats fresh ──────────
CREATE OR REPLACE FUNCTION public.trainer_listing_stats_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.trainer_listings
       SET sales_count = sales_count + 1,
           gross_cents = gross_cents + NEW.amount_paid_cents
     WHERE id = NEW.listing_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.trainer_listings
       SET sales_count = GREATEST(0, sales_count - 1),
           gross_cents = GREATEST(0, gross_cents - OLD.amount_paid_cents)
     WHERE id = OLD.listing_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_trainer_listing_stats ON public.trainer_purchases;
CREATE TRIGGER trg_trainer_listing_stats
  AFTER INSERT OR DELETE ON public.trainer_purchases
  FOR EACH ROW EXECUTE FUNCTION public.trainer_listing_stats_sync();

-- ── 7. Revenue summary RPC for the Trainer Studio dashboard ────────
CREATE OR REPLACE FUNCTION public.get_my_trainer_revenue()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT jsonb_build_object(
    'gross_cents',  COALESCE(SUM(tp.amount_paid_cents), 0),
    'payout_cents', COALESCE(SUM(tp.trainer_payout_cents), 0),
    'fee_cents',    COALESCE(SUM(tp.platform_fee_cents), 0),
    'sales',        COUNT(*)
  )
  FROM public.trainer_purchases tp
  WHERE tp.trainer_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_trainer_revenue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_trainer_revenue() TO authenticated;

NOTIFY pgrst, 'reload schema';
