-- 255_atomic_capsule_open.sql
--
-- Close the roll/grant gap for good.
--
-- THE GAP
--
-- Opening a capsule has been two round trips since migration 028:
--
--   1. claim_capsule_loot   — spends the capsule, rolls rarity/category,
--                             persists the roll, returns it
--   2. finalize_capsule_claim — inserts the inventory row, on Claim
--
-- Between them the capsule is gone and the item does not exist. A reload,
-- a crash, a backgrounded PWA, or a reveal that never reaches its Claim
-- button destroys the reward. Measured on a live account: 5 of 21 opened
-- capsules stranded that way, including an epic and two rares. Migration
-- 254 cleaned up a backlog; a client-side sweep now auto-grants strays.
-- Both are mops. This is the leak.
--
-- WHY IT WAS TWO STEPS
--
-- The server owns the ROLL (rarity, category, variant) because that's
-- what carries value. The client owns picking WHICH item of that tier,
-- because the catalog lives in JS — 113 entries across stickers, branded
-- items, titles, frames and themes. Neither half could complete the
-- transaction alone.
--
-- THE FIX
--
-- The client sends a candidate menu up front: one item per
-- "category:rarity" bucket, chosen before the roll and therefore without
-- knowing the outcome. The server rolls, looks up the bucket it landed
-- on, and inserts the inventory row in the SAME transaction that spends
-- the capsule. One call. Either both happen or neither does.
--
-- The alternative was mirroring the whole catalog into a table so the
-- server could pick unaided. Rejected: it duplicates a 113-row catalog
-- that changes whenever lootCatalog.js does, and catalog/schema drift is
-- already the most common defect class in this repo (see CLAUDE.md). A
-- menu passed per-call cannot drift from the catalog that built it.
--
-- TRUST BOUNDARY — UNCHANGED
--
-- item_rarity is written from the SERVER's roll, never from the payload,
-- exactly as finalize_capsule_claim already did. A tampered client can
-- still choose which same-tier item it receives — that was true before
-- and is why the client-side pick was acceptable in the first place. What
-- it cannot do is influence the tier, grant without spending a capsule,
-- or grant twice.
--
-- The old two-step RPCs are left in place: the frontend auto-deploys from
-- main while this SQL is pasted by hand, so there is a window where a new
-- client meets an old database. The client falls back to them on 42883.

CREATE OR REPLACE FUNCTION public.open_capsule_atomic(
  p_capsule_id UUID,
  p_candidates JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_email        TEXT;
  v_type         TEXT;
  v_rarity       TEXT;
  v_category     TEXT;
  v_variant      TEXT;
  v_key          TEXT;
  v_pick         JSONB;
  v_item_id      TEXT;
  v_item_name    TEXT;
  v_item_emoji   TEXT;
  v_item_type    TEXT;
  v_inventory_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_capsule_id IS NULL THEN
    RAISE EXCEPTION 'capsule_id required' USING ERRCODE = '22023';
  END IF;
  IF p_candidates IS NULL OR jsonb_typeof(p_candidates) <> 'object' THEN
    RAISE EXCEPTION 'candidates required' USING ERRCODE = '22023';
  END IF;

  -- Spend the capsule. Only the FIRST caller flips the flag and gets a row
  -- back; a concurrent tab or a replay sees nothing and bails.
  UPDATE public.user_capsules
     SET is_opened = TRUE,
         opened_at = now()
   WHERE id = p_capsule_id
     AND user_id = v_uid
     AND is_opened = FALSE
  RETURNING capsule_type INTO v_type;

  IF v_type IS NULL THEN
    RAISE EXCEPTION 'capsule not found or already opened' USING ERRCODE = '22023';
  END IF;
  v_type := COALESCE(v_type, 'standard');

  -- ── Rarity roll. Identical tables to claim_capsule_loot (mig 028);
  --    mirrors CAPSULE_ODDS in src/lib/lootCatalog.js. ──────────────────
  IF v_type = 'premium' THEN
    v_rarity := public._weighted_pick(
      ARRAY['common','uncommon','rare','epic','legendary','animated']::TEXT[],
      ARRAY[0.350, 0.380, 0.190, 0.065, 0.013, 0.002]::NUMERIC[]);
  ELSIF v_type = 'elite' THEN
    v_rarity := public._weighted_pick(
      ARRAY['common','uncommon','rare','epic','legendary','animated']::TEXT[],
      ARRAY[0.100, 0.250, 0.350, 0.220, 0.070, 0.010]::NUMERIC[]);
  ELSE
    v_rarity := public._weighted_pick(
      ARRAY['common','uncommon','rare','epic','legendary','animated']::TEXT[],
      ARRAY[0.600, 0.280, 0.100, 0.018, 0.002, 0.000]::NUMERIC[]);
  END IF;

  -- ── Category roll ────────────────────────────────────────────────────
  IF v_type = 'premium' THEN
    v_category := public._weighted_pick(
      ARRAY['theme','title','frame','sticker']::TEXT[],
      ARRAY[0.08, 0.12, 0.10, 0.70]::NUMERIC[]);
  ELSIF v_type = 'elite' THEN
    v_category := public._weighted_pick(
      ARRAY['theme','title','frame','sticker']::TEXT[],
      ARRAY[0.18, 0.20, 0.17, 0.45]::NUMERIC[]);
  ELSE
    v_category := public._weighted_pick(
      ARRAY['theme','title','frame','sticker']::TEXT[],
      ARRAY[0.03, 0.05, 0.04, 0.88]::NUMERIC[]);
  END IF;

  -- ── Variant roll (stickers only) ─────────────────────────────────────
  IF v_category = 'sticker' THEN
    IF v_type = 'premium' THEN
      v_variant := public._weighted_pick(
        ARRAY['plain','foil','gold','diamond']::TEXT[],
        ARRAY[0.90, 0.08, 0.02, 0.00]::NUMERIC[]);
    ELSIF v_type = 'elite' THEN
      v_variant := public._weighted_pick(
        ARRAY['plain','foil','gold','diamond']::TEXT[],
        ARRAY[0.80, 0.14, 0.05, 0.01]::NUMERIC[]);
    ELSE
      v_variant := public._weighted_pick(
        ARRAY['plain','foil','gold','diamond']::TEXT[],
        ARRAY[0.97, 0.03, 0.00, 0.00]::NUMERIC[]);
    END IF;
    IF v_variant = 'plain' THEN v_variant := NULL; END IF;
  ELSE
    v_variant := NULL;
  END IF;

  -- ── Resolve the roll against the client's menu ────────────────────────
  v_key  := v_category || ':' || v_rarity;
  v_pick := p_candidates -> v_key;

  -- A tier with no entry for the rolled category still owes the user
  -- something — the capsule is already spent. Degrade to a sticker of the
  -- same tier, which is where the value lives.
  IF v_pick IS NULL THEN
    v_pick := p_candidates -> ('sticker:' || v_rarity);
    IF v_pick IS NOT NULL THEN
      v_category := 'sticker';
    END IF;
  END IF;
  IF v_pick IS NULL THEN
    RAISE EXCEPTION 'no_candidate_for_roll' USING ERRCODE = '22023';
  END IF;

  v_item_id    := v_pick ->> 'id';
  v_item_name  := v_pick ->> 'name';
  v_item_emoji := COALESCE(v_pick ->> 'emoji', '');
  v_item_type  := COALESCE(v_pick ->> 'type', v_category);

  IF v_item_id IS NULL OR v_item_name IS NULL THEN
    RAISE EXCEPTION 'bad_candidate' USING ERRCODE = '22023';
  END IF;

  -- Guest sessions carry auth.email() = '', which orphans the row from
  -- every read that filters on user_email. Resolve the canonical address.
  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;
  IF v_email IS NULL OR v_email = '' THEN
    v_email := 'guest_' || v_uid || '@flexyn.guest';
  END IF;

  -- ── Grant, in the same transaction that spent the capsule ────────────
  -- item_rarity comes from the SERVER roll, never from the payload.
  INSERT INTO public.user_inventory
    (user_id, user_email, item_id, item_name, item_emoji, item_rarity, item_type, variant, acquired_via)
  VALUES
    (v_uid, v_email, v_item_id, v_item_name, v_item_emoji, v_rarity, v_item_type, v_variant, 'capsule')
  RETURNING id INTO v_inventory_id;

  UPDATE public.user_capsules
     SET rolled_rarity   = v_rarity,
         rolled_category = v_category,
         rolled_variant  = v_variant,
         finalized_at    = now()
   WHERE id = p_capsule_id;

  RETURN jsonb_build_object(
    'capsule_id',   p_capsule_id,
    'capsule_type', v_type,
    'rarity',       v_rarity,
    'category',     v_category,
    'variant',      v_variant,
    'inventory_id', v_inventory_id,
    'item_id',      v_item_id,
    'item_name',    v_item_name,
    'item_emoji',   v_item_emoji,
    'item_type',    v_item_type
  );
END;
$$;

REVOKE ALL ON FUNCTION public.open_capsule_atomic(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_capsule_atomic(UUID, JSONB) TO authenticated;
