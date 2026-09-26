-- 253_trade_escrow.sql
--
-- Real trading. Until now "trading" was a chat message: TradeOfferDialog
-- embedded a [TRADE_OFFER_V1] JSON blob in a DM, and Accept sent a text
-- reply. Nothing moved. The two users were expected to hand-deliver items
-- to each other afterwards, and TradeHistory reconstructed the whole
-- record by string-parsing hub_messages bodies.
--
-- That means today a "trade" can silently half-complete: A accepts, B
-- never delivers, and there is no record either party can point at. It
-- also means the offered item stayed freely sellable the entire time the
-- offer was open, so the same sticker could be promised to three people
-- and sold to the marketplace before any of them accepted.
--
-- This migration adds:
--   • public.trade_offers            — the real record, replacing DM parsing
--   • user_inventory.escrow_offer_id — the offered item is locked on send
--   • create / respond / cancel RPCs — SECURITY DEFINER, atomic
--   • a BEFORE DELETE guard          — escrowed items cannot be sold away
--
-- ESCROW DESIGN NOTE: escrow sets BOTH escrow_offer_id AND is_listed=true.
-- Deliberate. Every already-deployed guard in the economy keys off
-- is_listed (create_marketplace_listing rejects listed items, the bag
-- filters them out of the sell UI), so reusing it means an escrowed item
-- inherits all of that protection without re-issuing four other RPCs that
-- would each need re-verifying. escrow_offer_id is what makes the lock
-- releasable precisely, and is what the DELETE guard reads.
--
-- The DELETE guard is not optional: migration 197 revoked INSERT and
-- UPDATE on user_inventory from authenticated but left DELETE, and
-- inventory.sellItem() deletes the row directly from the client. Without
-- the trigger a user could escrow an item in an offer and then sell it out
-- from under the counterparty before they accepted.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Escrow column
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.user_inventory
  ADD COLUMN IF NOT EXISTS escrow_offer_id UUID;

CREATE INDEX IF NOT EXISTS idx_user_inventory_escrow
  ON public.user_inventory (escrow_offer_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Offers table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trade_offers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_inventory_id UUID NOT NULL,
  to_inventory_id   UUID NOT NULL,
  listing_id        UUID,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  -- Item snapshots. History has to survive the items changing hands
  -- again later, so the row cannot depend on reading inventory back.
  from_item_id      TEXT NOT NULL DEFAULT '',
  from_item_name    TEXT NOT NULL DEFAULT '',
  from_item_emoji   TEXT NOT NULL DEFAULT '',
  from_item_rarity  TEXT NOT NULL DEFAULT 'common',
  to_item_id        TEXT NOT NULL DEFAULT '',
  to_item_name      TEXT NOT NULL DEFAULT '',
  to_item_emoji     TEXT NOT NULL DEFAULT '',
  to_item_rarity    TEXT NOT NULL DEFAULT 'common',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trade_offers_from ON public.trade_offers (from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_offers_to   ON public.trade_offers (to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_offers_open ON public.trade_offers (status, to_inventory_id);

ALTER TABLE public.trade_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trades: parties can view own offers" ON public.trade_offers;
CREATE POLICY "trades: parties can view own offers"
  ON public.trade_offers FOR SELECT
  TO authenticated
  USING (from_user_id = auth.uid() OR to_user_id = auth.uid());

-- Writes go through the RPCs only. A client that could INSERT here could
-- mint an accepted trade for someone else's item.
REVOKE INSERT, UPDATE, DELETE ON public.trade_offers FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Escrowed items cannot be deleted (i.e. sold)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.block_escrowed_inventory_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.escrow_offer_id IS NOT NULL THEN
    RAISE EXCEPTION 'item_in_escrow';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_escrowed_delete ON public.user_inventory;
CREATE TRIGGER trg_block_escrowed_delete
  BEFORE DELETE ON public.user_inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.block_escrowed_inventory_delete();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. create_trade_offer
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_trade_offer(
  p_from_inventory_id UUID,
  p_to_inventory_id   UUID,
  p_listing_id        UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me            UUID := auth.uid();
  v_from_owner    UUID;
  v_from_listed   BOOLEAN;
  v_from_escrow   UUID;
  v_from_item     TEXT;
  v_from_name     TEXT;
  v_from_emoji    TEXT;
  v_from_rarity   TEXT;
  v_to_owner      UUID;
  v_to_escrow     UUID;
  v_to_item       TEXT;
  v_to_name       TEXT;
  v_to_emoji      TEXT;
  v_to_rarity     TEXT;
  v_offer_id      UUID;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_from_inventory_id = p_to_inventory_id THEN
    RAISE EXCEPTION 'cannot_trade_with_self';
  END IF;

  -- Offered item. Locked so two concurrent offers can't escrow it twice.
  SELECT user_id, is_listed, escrow_offer_id, item_id, item_name, item_emoji, item_rarity
    INTO v_from_owner, v_from_listed, v_from_escrow, v_from_item, v_from_name, v_from_emoji, v_from_rarity
    FROM public.user_inventory
   WHERE id = p_from_inventory_id
     FOR UPDATE;

  IF v_from_owner IS NULL THEN
    RAISE EXCEPTION 'offer_item_not_found';
  END IF;
  IF v_from_owner <> v_me THEN
    RAISE EXCEPTION 'not_your_item';
  END IF;
  IF v_from_escrow IS NOT NULL THEN
    RAISE EXCEPTION 'offer_item_in_escrow';
  END IF;
  IF v_from_listed THEN
    RAISE EXCEPTION 'offer_item_is_listed';
  END IF;

  -- Requested item. NOT locked for the life of the offer — several people
  -- are allowed to bid for the same item. Ownership is re-verified at
  -- accept time, which is the only moment it has to be true.
  SELECT user_id, escrow_offer_id, item_id, item_name, item_emoji, item_rarity
    INTO v_to_owner, v_to_escrow, v_to_item, v_to_name, v_to_emoji, v_to_rarity
    FROM public.user_inventory
   WHERE id = p_to_inventory_id;

  IF v_to_owner IS NULL THEN
    RAISE EXCEPTION 'target_item_not_found';
  END IF;
  IF v_to_owner = v_me THEN
    RAISE EXCEPTION 'cannot_trade_with_self';
  END IF;
  IF v_to_escrow IS NOT NULL THEN
    RAISE EXCEPTION 'target_item_in_escrow';
  END IF;

  INSERT INTO public.trade_offers (
    from_user_id, to_user_id, from_inventory_id, to_inventory_id, listing_id,
    from_item_id, from_item_name, from_item_emoji, from_item_rarity,
    to_item_id,   to_item_name,   to_item_emoji,   to_item_rarity
  ) VALUES (
    v_me, v_to_owner, p_from_inventory_id, p_to_inventory_id, p_listing_id,
    v_from_item, v_from_name, v_from_emoji, v_from_rarity,
    v_to_item,   v_to_name,   v_to_emoji,   v_to_rarity
  )
  RETURNING id INTO v_offer_id;

  -- Lock the offered item. is_listed piggybacks on every existing guard;
  -- escrow_offer_id is what releases it precisely later.
  UPDATE public.user_inventory
     SET escrow_offer_id = v_offer_id,
         is_listed = TRUE
   WHERE id = p_from_inventory_id;

  RETURN v_offer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_trade_offer(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_trade_offer(UUID, UUID, UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. respond_to_trade_offer — the actual swap
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.respond_to_trade_offer(
  p_offer_id UUID,
  p_accept   BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me           UUID := auth.uid();
  v_from_user    UUID;
  v_to_user      UUID;
  v_from_inv     UUID;
  v_to_inv       UUID;
  v_listing      UUID;
  v_status       TEXT;
  v_first        UUID;
  v_second       UUID;
  v_from_owner   UUID;
  v_from_escrow  UUID;
  v_to_owner     UUID;
  v_to_escrow    UUID;
  v_to_listed    BOOLEAN;
  v_from_email   TEXT;
  v_to_email     TEXT;
  v_other_id     UUID;
  v_other_inv    UUID;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT from_user_id, to_user_id, from_inventory_id, to_inventory_id, listing_id, status
    INTO v_from_user, v_to_user, v_from_inv, v_to_inv, v_listing, v_status
    FROM public.trade_offers
   WHERE id = p_offer_id
     FOR UPDATE;

  IF v_from_user IS NULL THEN
    RAISE EXCEPTION 'offer_not_found';
  END IF;
  IF v_to_user <> v_me THEN
    RAISE EXCEPTION 'not_your_offer';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'offer_not_pending';
  END IF;

  -- ── Decline ────────────────────────────────────────────────────────────
  IF NOT p_accept THEN
    UPDATE public.trade_offers
       SET status = 'declined', responded_at = now()
     WHERE id = p_offer_id;

    UPDATE public.user_inventory
       SET escrow_offer_id = NULL, is_listed = FALSE
     WHERE id = v_from_inv
       AND escrow_offer_id = p_offer_id;

    RETURN jsonb_build_object('status', 'declined', 'offer_id', p_offer_id);
  END IF;

  -- ── Accept ─────────────────────────────────────────────────────────────
  -- Lock both rows in a deterministic order so two trades sharing an item
  -- can't deadlock against each other.
  IF v_from_inv < v_to_inv THEN
    v_first := v_from_inv; v_second := v_to_inv;
  ELSE
    v_first := v_to_inv;   v_second := v_from_inv;
  END IF;

  PERFORM 1 FROM public.user_inventory WHERE id = v_first  FOR UPDATE;
  PERFORM 1 FROM public.user_inventory WHERE id = v_second FOR UPDATE;

  SELECT user_id, escrow_offer_id, user_email
    INTO v_from_owner, v_from_escrow, v_from_email
    FROM public.user_inventory
   WHERE id = v_from_inv;

  SELECT user_id, escrow_offer_id, is_listed, user_email
    INTO v_to_owner, v_to_escrow, v_to_listed, v_to_email
    FROM public.user_inventory
   WHERE id = v_to_inv;

  -- Re-verify everything. Between send and accept the sender may have had
  -- their item taken by another accepted trade, and the recipient may have
  -- sold theirs on the marketplace.
  IF v_from_owner IS NULL OR v_to_owner IS NULL THEN
    RAISE EXCEPTION 'item_no_longer_exists';
  END IF;
  IF v_from_owner <> v_from_user THEN
    RAISE EXCEPTION 'offer_item_changed_hands';
  END IF;
  IF v_from_escrow IS DISTINCT FROM p_offer_id THEN
    RAISE EXCEPTION 'offer_item_not_escrowed';
  END IF;
  IF v_to_owner <> v_to_user THEN
    RAISE EXCEPTION 'your_item_changed_hands';
  END IF;
  IF v_to_escrow IS NOT NULL THEN
    RAISE EXCEPTION 'your_item_in_escrow';
  END IF;

  -- Swap. Both rows clear escrow and listing state on the way across.
  UPDATE public.user_inventory
     SET user_id = v_to_user,
         user_email = v_to_email,
         escrow_offer_id = NULL,
         is_listed = FALSE,
         acquired_via = 'trade'
   WHERE id = v_from_inv;

  UPDATE public.user_inventory
     SET user_id = v_from_user,
         user_email = v_from_email,
         escrow_offer_id = NULL,
         is_listed = FALSE,
         acquired_via = 'trade'
   WHERE id = v_to_inv;

  UPDATE public.trade_offers
     SET status = 'accepted', responded_at = now()
   WHERE id = p_offer_id;

  -- The originating marketplace listing, if any, is now fulfilled.
  IF v_listing IS NOT NULL THEN
    UPDATE public.marketplace_listings
       SET status = 'completed'
     WHERE id = v_listing
       AND status = 'active';
  END IF;

  -- Any OTHER pending offer that involves either of these two items is now
  -- unfulfillable. Decline them and release their escrows rather than
  -- leaving them pending forever to fail later with a confusing error.
  FOR v_other_id, v_other_inv IN
    SELECT id, from_inventory_id
      FROM public.trade_offers
     WHERE status = 'pending'
       AND id <> p_offer_id
       AND (from_inventory_id IN (v_from_inv, v_to_inv)
         OR to_inventory_id   IN (v_from_inv, v_to_inv))
  LOOP
    UPDATE public.trade_offers
       SET status = 'cancelled', responded_at = now()
     WHERE id = v_other_id;

    UPDATE public.user_inventory
       SET escrow_offer_id = NULL, is_listed = FALSE
     WHERE id = v_other_inv
       AND escrow_offer_id = v_other_id;
  END LOOP;

  RETURN jsonb_build_object('status', 'accepted', 'offer_id', p_offer_id);
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_trade_offer(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_to_trade_offer(UUID, BOOLEAN) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. cancel_trade_offer — sender pulls a pending offer back
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_trade_offer(p_offer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me        UUID := auth.uid();
  v_from_user UUID;
  v_from_inv  UUID;
  v_status    TEXT;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT from_user_id, from_inventory_id, status
    INTO v_from_user, v_from_inv, v_status
    FROM public.trade_offers
   WHERE id = p_offer_id
     FOR UPDATE;

  IF v_from_user IS NULL THEN
    RAISE EXCEPTION 'offer_not_found';
  END IF;
  IF v_from_user <> v_me THEN
    RAISE EXCEPTION 'not_your_offer';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'offer_not_pending';
  END IF;

  UPDATE public.trade_offers
     SET status = 'cancelled', responded_at = now()
   WHERE id = p_offer_id;

  UPDATE public.user_inventory
     SET escrow_offer_id = NULL, is_listed = FALSE
   WHERE id = v_from_inv
     AND escrow_offer_id = p_offer_id;

  RETURN jsonb_build_object('status', 'cancelled', 'offer_id', p_offer_id);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_trade_offer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_trade_offer(UUID) TO authenticated;

GRANT SELECT ON public.trade_offers TO authenticated;
