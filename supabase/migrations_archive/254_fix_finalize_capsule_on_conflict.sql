-- 254_fix_finalize_capsule_on_conflict.sql
--
-- CRITICAL: every capsule claim has been destroying its loot.
--
-- Migration 198 rewrote finalize_capsule_claim with:
--
--     ON CONFLICT (user_id, item_id, variant) DO UPDATE SET acquired_at = now()
--
-- but there is no unique constraint or index on
-- user_inventory (user_id, item_id, variant) — not in any migration in
-- this repo. Postgres therefore rejects the whole statement at runtime:
--
--     42P10  there is no unique or exclusion constraint matching the
--            ON CONFLICT specification
--
-- The failure lands AFTER claim_capsule_loot has already flipped
-- is_opened = true and persisted the rolled rarity, so the capsule is
-- consumed and the inventory row is never written. The user watches the
-- reel, sees their prize, taps Claim, and gets "Could not save item."
-- The item is gone.
--
-- Confirmed live before writing this: an account with 2 opened capsules
-- had 0 finalized_at values and 0 rows in user_inventory.
--
-- THE FIX IS TO DROP THE ON CONFLICT, NOT TO ADD THE INDEX.
--
-- Adding a unique index on (user_id, item_id, variant) would "resolve"
-- the error while silently destroying the duplicate economy: a user is
-- supposed to be able to hold several copies of the same sticker. The
-- bag renders a ×N count per stack, the per-card action is literally
-- "Sell extra", the phase-4 bulk action is "Sell all duplicates", and
-- every player-to-player sale on the marketplace is someone offloading a
-- spare copy. A uniqueness constraint would cap every item at one and
-- turn the second pull of anything into a no-op UPDATE of acquired_at.
-- (It also wouldn't behave as intended anyway: `variant` is nullable and
-- NULLs never conflict in a standard unique index, so foil/gold copies
-- would still slip past it.)
--
-- The idempotency that 198 was actually reaching for is already enforced,
-- and enforced correctly, four lines above the INSERT: user_capsules
-- .finalized_at is checked and raises 'capsule already claimed'. The
-- ON CONFLICT was redundant as well as invalid.
--
-- Body is otherwise byte-identical to 198.

CREATE OR REPLACE FUNCTION public.finalize_capsule_claim(
  p_capsule_id uuid, p_item_id text, p_item_name text, p_item_emoji text,
  p_item_rarity text, p_item_type text, p_variant text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid            UUID := auth.uid();
  v_email          TEXT;
  v_is_opened      BOOLEAN;
  v_rolled_rarity  TEXT;
  v_rolled_variant TEXT;
  v_finalized      TIMESTAMPTZ;
  v_inventory_id   UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF p_capsule_id IS NULL OR p_item_id IS NULL OR p_item_name IS NULL THEN
    RAISE EXCEPTION 'capsule_id, item_id, item_name required' USING ERRCODE = '22023';
  END IF;

  SELECT is_opened, rolled_rarity, rolled_variant, finalized_at
    INTO v_is_opened, v_rolled_rarity, v_rolled_variant, v_finalized
    FROM public.user_capsules
   WHERE id = p_capsule_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'capsule not found' USING ERRCODE = '22023'; END IF;
  IF v_is_opened IS NOT TRUE THEN RAISE EXCEPTION 'capsule not yet opened' USING ERRCODE = '22023'; END IF;
  IF v_rolled_rarity IS NULL THEN RAISE EXCEPTION 'capsule roll missing — call claim_capsule_loot first' USING ERRCODE = '22023'; END IF;
  -- This, not the ON CONFLICT, is what makes the claim one-shot.
  IF v_finalized IS NOT NULL THEN RAISE EXCEPTION 'capsule already claimed' USING ERRCODE = '22023'; END IF;

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;

  -- Plain INSERT. Duplicates are the intended outcome of pulling the same
  -- item twice; the bag stacks them and the marketplace exists to trade
  -- the spares.
  INSERT INTO public.user_inventory
    (user_id, user_email, item_id, item_name, item_emoji, item_rarity, item_type, variant, acquired_via)
  VALUES
    (v_uid, v_email, p_item_id, p_item_name, p_item_emoji, v_rolled_rarity, p_item_type, v_rolled_variant, 'capsule')
  RETURNING id INTO v_inventory_id;

  UPDATE public.user_capsules SET finalized_at = now() WHERE id = p_capsule_id;

  RETURN jsonb_build_object(
    'ok', true, 'inventory_id', v_inventory_id, 'item_id', p_item_id,
    'item_rarity', v_rolled_rarity, 'item_variant', v_rolled_variant);
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_capsule_claim(uuid, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_capsule_claim(uuid, text, text, text, text, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Recovery for loot already destroyed
-- ─────────────────────────────────────────────────────────────────────────────
-- Capsules that were opened while 198 was live are stranded: is_opened is
-- true and the roll is recorded, but finalized_at is NULL and no inventory
-- row exists. The rolled RARITY is known; the specific item is not (the
-- client picks that from the catalog at reveal time and it was never
-- persisted).
--
-- Rather than invent an item server-side, reset those capsules so the
-- owner can simply open them again and get a fresh roll. Same rarity odds,
-- nothing conjured, no double-grant risk — the WHERE clause only touches
-- rows that provably never produced an item.
UPDATE public.user_capsules
   SET is_opened = FALSE,
       opened_at = NULL,
       rolled_rarity = NULL,
       rolled_category = NULL,
       rolled_variant = NULL
 WHERE is_opened = TRUE
   AND finalized_at IS NULL;
