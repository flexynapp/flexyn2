-- 320_marketplace_bundle_conservation_and_listing_guard.sql
--
-- Two marketplace holes found in the 2026-08-09 audit. Both are the same
-- shape as the crews/leagues bugs in migs 245-247: **a row-scoped policy
-- constrains WHICH ROW, never WHICH COLUMN.**
--
-- ── 1. purchase_bundle minted coins ──────────────────────────────────────────
--
-- It charged the buyer `total * (1 - discount)` and credited each seller
-- their FULL asking_price. The difference was created out of nothing, on
-- every bundle sale, at up to 75% (the discount_pct ceiling). Two accounts
-- could farm it directly: A lists items at any price, bundles them at 75%
-- off, B buys, A receives 100% of a total B paid 25% of. Bounded only by
-- mig 264's rolling 50k/24h credit clamp, which caps the rate and does not
-- close the hole.
--
-- Fixed by making the seller's take BE what the buyer paid. That is also
-- what a bundle deal means: mig 134's own head says "a seller can group
-- marketplace listings ... and offer a percentage discount", so the discount
-- is the seller's promotion and comes out of the seller's proceeds. Debit
-- and credit are now the same integer by construction, so no rounding split
-- can reintroduce a drift.
--
-- ── 2. Anyone could edit their own listing's trust-bearing columns ───────────
--
-- `marketplace_listings` carried `FOR UPDATE TO authenticated` scoped to
-- `seller_user_id = auth.uid()` with no column restriction, so straight from
-- the browser a seller could:
--   • set is_featured / featured_until on their own listing — self-serve
--     promotion, and featured listings float above every sort in the feed;
--   • change asking_price on a LIVE listing — the buyer's confirm dialog
--     shows the price their client cached while purchase_listing charges the
--     row's current value, so 10 coins on screen can bill 10,000;
--   • set bundle_id to ANOTHER user's bundle, injecting a listing into a
--     deal they do not own.
-- Re-selling a sold item was already safe: purchase_listing re-checks the
-- inventory row against the seller and cancels the listing instead.
--
-- UPDATE is REVOKED rather than narrowed, matching the crews decision in
-- mig 246. Nothing in the client needs it: create / cancel / purchase all go
-- through RPCs, `completeListing` in src/lib/data/marketplace.js has zero
-- callers, and the pre-078 fallback in `cancelListing` is unreachable (078
-- is deployed). The one documented flow that did need it — mig 134 step 2,
-- "seller links listings via update marketplace_listings SET bundle_id" —
-- gets `set_listing_bundle()` below, which validates both sides. No bundle
-- UI exists yet and there are 0 bundle rows in production, so nothing live
-- is being taken away.
--
-- A guard trigger pins the same columns as defence in depth, for the day a
-- future migration re-adds an UPDATE policy without thinking about columns.
-- The `current_user IN ('postgres','service_role')` bypass is safe here
-- because every SECURITY DEFINER function that writes this table is
-- postgres-owned — verified against pg_proc.proowner for
-- create_marketplace_listing, cancel_marketplace_listing, purchase_listing
-- and purchase_bundle. Do NOT copy this pattern to another table without
-- re-running that check: a non-postgres-owned definer function would have
-- its writes silently pinned to OLD values with no error raised.
--
-- ── Also fixed here, same function, found while rewriting ────────────────────
--
-- purchase_bundle transferred inventory with `SET user_id = buyer` and never
-- touched `user_email`. user_inventory carries both keys and the Bag reads
-- it BY EMAIL (`inventory.listItems(userEmail)` → `.eq('user_email', …)`),
-- so a bundle purchase moved the item to a buyer who could not see it while
-- it stayed visible in the seller's bag. purchase_listing has always set
-- both; this now matches it.
--
-- Error names are unchanged (bundle_not_found, bundle_not_available,
-- cannot_buy_own_bundle, bundle_empty, insufficient_coins) — MarketplaceFeed
-- maps its user-facing copy off these strings.
--
-- NOTE ON MIGRATION 134: its file still defines purchase_bundle against
-- `public.user_profiles WHERE user_id = …`, a column that does not exist on
-- that table (the key is `id`). The INSTALLED function was a later corrected
-- version. Do not re-run 134 — this migration supersedes its function body.

-- ── 1. purchase_bundle — conserve coins ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.purchase_bundle(p_bundle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_buyer_id      UUID := auth.uid();
  v_buyer_email   TEXT;
  v_bundle_status TEXT;
  v_bundle_seller UUID;
  v_discount_pct  NUMERIC;
  v_lid           UUID;
  v_price         INTEGER;
  v_inv           UUID;
  v_total_price   INTEGER := 0;
  v_discounted    INTEGER;
  v_buyer_coins   INTEGER;
  v_listing_ids   UUID[] := '{}';
BEGIN
  IF v_buyer_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  v_buyer_email := NULLIF(public.current_user_email(), '');

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

  -- Only the BUNDLE OWNER's own listings are part of the deal.
  --
  -- The old body took every listing carrying this bundle_id regardless of
  -- who owned it, and the UPDATE policy let any seller point their own
  -- listing at any bundle — so a third party could inject an item into
  -- someone else's discounted deal and be paid out of it. Restricting the
  -- set here makes that injection inert even if a listing still carries a
  -- foreign bundle_id: it is simply not sold, and stays active.
  FOR v_lid, v_price IN
    SELECT id, asking_price
      FROM public.marketplace_listings
     WHERE bundle_id = p_bundle_id
       AND seller_user_id = v_bundle_seller
       AND status = 'active'
       AND listing_type = 'sale'
       FOR UPDATE
  LOOP
    v_total_price := v_total_price + COALESCE(v_price, 0);
    v_listing_ids := array_append(v_listing_ids, v_lid);
  END LOOP;

  IF array_length(v_listing_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'bundle_empty';
  END IF;

  v_discounted := GREATEST(1, ROUND(v_total_price * (1 - v_discount_pct / 100)));

  SELECT COALESCE(flex_coins, 0) INTO v_buyer_coins
    FROM public.user_profiles
   WHERE id = v_buyer_id
     FOR UPDATE;
  IF v_buyer_coins IS NULL THEN
    RAISE EXCEPTION 'buyer profile not found' USING ERRCODE = '22023';
  END IF;
  IF v_buyer_coins < v_discounted THEN
    RAISE EXCEPTION 'insufficient_coins';
  END IF;

  UPDATE public.user_profiles
     SET flex_coins = flex_coins - v_discounted
   WHERE id = v_buyer_id;

  -- THE FIX. One credit, of exactly what the buyer was debited.
  --
  -- Every listing in v_listing_ids belongs to v_bundle_seller by the WHERE
  -- clause above, so there is a single payee and no pro-rata split to round.
  -- The debit and the credit are the same variable: a bundle sale can no
  -- longer create or destroy a coin, whatever the discount is set to.
  --
  -- Mig 264's ledger trigger still applies to this credit and may clamp it
  -- against the rolling 24h ceiling — that is deliberate and unchanged.
  UPDATE public.user_profiles
     SET flex_coins = COALESCE(flex_coins, 0) + v_discounted
   WHERE id = v_bundle_seller;

  FOR v_lid, v_inv IN
    SELECT id, inventory_id
      FROM public.marketplace_listings
     WHERE id = ANY(v_listing_ids)
  LOOP
    -- user_email as well as user_id: the Bag reads user_inventory by email,
    -- so transferring only the uuid moved the item somewhere the buyer
    -- could not see and the seller still could.
    UPDATE public.user_inventory
       SET user_id    = v_buyer_id,
           user_email = v_buyer_email,
           is_listed  = false
     WHERE id = v_inv;

    UPDATE public.marketplace_listings
       SET status = 'completed'
     WHERE id = v_lid;
  END LOOP;

  UPDATE public.marketplace_bundles
     SET status = 'completed'
   WHERE id = p_bundle_id;

  RETURN jsonb_build_object(
    'bundle_id',     p_bundle_id,
    'listing_count', array_length(v_listing_ids, 1),
    'total_price',   v_total_price,
    'paid_price',    v_discounted,
    'buyer_coins',   v_buyer_coins - v_discounted
  );
END;
$function$;

-- Mirrors the ACL the other marketplace RPCs already carry
-- (postgres / authenticated / service_role, PUBLIC revoked). CREATE OR
-- REPLACE preserves the existing ACL, so this is belt-and-braces.
REVOKE ALL ON FUNCTION public.purchase_bundle(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purchase_bundle(UUID) TO authenticated, service_role;

-- ── 2. Take client UPDATE off marketplace_listings ───────────────────────────

DROP POLICY IF EXISTS "marketplace: sellers can update own listings"
  ON public.marketplace_listings;

REVOKE UPDATE ON public.marketplace_listings FROM authenticated;

-- Defence in depth. Pins every column a seller must not be able to move,
-- for the day a future migration re-adds an UPDATE policy. Bypasses only
-- for postgres / service_role — see the head comment for why that is safe
-- on THIS table specifically.
CREATE OR REPLACE FUNCTION public.marketplace_listings_guard_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  NEW.seller_user_id   := OLD.seller_user_id;
  NEW.seller_email     := OLD.seller_email;
  NEW.seller_username  := OLD.seller_username;
  NEW.inventory_id     := OLD.inventory_id;
  NEW.item_id          := OLD.item_id;
  NEW.item_name        := OLD.item_name;
  NEW.item_emoji       := OLD.item_emoji;
  NEW.item_rarity      := OLD.item_rarity;
  NEW.listing_type     := OLD.listing_type;
  NEW.asking_price     := OLD.asking_price;
  NEW.trade_for_rarity := OLD.trade_for_rarity;
  NEW.status           := OLD.status;
  NEW.created_at       := OLD.created_at;
  NEW.available_from   := OLD.available_from;
  NEW.available_until  := OLD.available_until;
  NEW.bundle_id        := OLD.bundle_id;
  NEW.is_featured      := OLD.is_featured;
  NEW.featured_until   := OLD.featured_until;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS marketplace_listings_guard_write_tr
  ON public.marketplace_listings;
CREATE TRIGGER marketplace_listings_guard_write_tr
  BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_listings_guard_write();

-- ── 3. The one legitimate seller edit, as an RPC ─────────────────────────────
--
-- Mig 134 step 2 of the bundle flow. Validates BOTH sides against the
-- caller, which is the part the old blanket UPDATE policy could not do:
-- the listing must be yours AND the bundle must be yours. Pass NULL to
-- unlink. Deliberately refuses to move a listing that is no longer active,
-- so a completed sale cannot be retro-fitted into a bundle.
CREATE OR REPLACE FUNCTION public.set_listing_bundle(
  p_listing_id UUID,
  p_bundle_id  UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid            UUID := auth.uid();
  v_listing_seller UUID;
  v_listing_status TEXT;
  v_bundle_seller  UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_listing_id IS NULL THEN
    RAISE EXCEPTION 'listing_id required' USING ERRCODE = '22023';
  END IF;

  SELECT seller_user_id, status INTO v_listing_seller, v_listing_status
    FROM public.marketplace_listings
   WHERE id = p_listing_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing not found' USING ERRCODE = '22023';
  END IF;
  IF v_listing_seller <> v_uid THEN
    RAISE EXCEPTION 'not_your_listing' USING ERRCODE = '42501';
  END IF;
  IF v_listing_status <> 'active' THEN
    RAISE EXCEPTION 'listing is %', v_listing_status USING ERRCODE = '22023';
  END IF;

  IF p_bundle_id IS NOT NULL THEN
    SELECT seller_user_id INTO v_bundle_seller
      FROM public.marketplace_bundles
     WHERE id = p_bundle_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bundle_not_found';
    END IF;
    IF v_bundle_seller <> v_uid THEN
      RAISE EXCEPTION 'not_your_bundle' USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.marketplace_listings
     SET bundle_id = p_bundle_id
   WHERE id = p_listing_id;
END;
$function$;

-- Every public-schema function is a PostgREST endpoint and is EXECUTE-able
-- by PUBLIC until revoked — see the scheduled-workouts note in CLAUDE.md.
REVOKE ALL ON FUNCTION public.set_listing_bundle(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_listing_bundle(UUID, UUID) TO authenticated, service_role;

-- ── Verified against production in a rolled-back transaction, 2026-08-09 ─────
--
-- Applying a migration cleanly is not evidence its functions work — mig 275's
-- ON CONFLICT bug shipped through exactly that check. Every line below was
-- executed as a real `authenticated` user inside BEGIN … ROLLBACK:
--
--   Bundle of 2 listings at 1000 each, 50% off.
--     buyer 10075 → 9075 (−1000), seller 555 → 1555 (+1000), ledger unclamped.
--     Conserved. The old body paid the seller 2000 and minted the other 1000.
--     Both inventory rows moved to the buyer WITH user_email set (2 of 2).
--   Seller sets is_featured on own listing ......... blocked, 42501
--   Seller rewrites asking_price on own listing .... blocked, 42501
--   set_listing_bundle into someone else's bundle .. blocked, not_your_bundle
--   set_listing_bundle into own bundle ............. ok, bundle_id set
--   purchase_listing through the new trigger ....... ok, status completed,
--                                                    inventory moved to buyer
--   cancel_marketplace_listing through it .......... ok, status cancelled
--
-- The last two are the regression that matters: the guard trigger fires on
-- every UPDATE, and if the postgres bypass were wrong it would silently pin
-- `status` back to OLD and every purchase and cancel would no-op with no
-- error raised anywhere.
