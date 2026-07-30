-- 267_loot_catalog_server_authority.sql
--
-- Fixes L2 and L3 from docs/loot-system-audit-2026-07-29.md.
--
-- ── L2: the client chose which item it won ───────────────────────────────
--
-- The server decided your RARITY. The client decided WHICH ITEM that was.
--
--   open_capsule_atomic  built `category || ':' || rarity` and then keyed into
--                        p_candidates — a pool supplied by the caller. A
--                        crafted pool maps every key to the same item.
--   finalize_capsule_claim took p_item_id / p_item_name / p_item_emoji /
--                        p_item_type verbatim, validated against nothing.
--
-- So any cosmetic in the game was obtainable from a single common pull, and
-- item_name was an unvalidated client string that surfaces in marketplace
-- listings other users see.
--
-- Fixed by giving the database the catalogue. loot_catalog holds the 75-item
-- DROP POOL, generated from src/lib/lootCatalog.js, lootThemes.js,
-- lootTitles.js and lootFrames.js. Both entry points now derive the item from
-- it and the capsule's own stored roll. Every client-supplied item argument is
-- ignored.
--
-- WHAT IS DELIBERATELY NOT IN HERE. The pool mirrors
-- lootRoll.pickItemForRoll, which is what the old client candidate menu was
-- built from:
--
--   • BRANDED_ITEMS (flx_*, 38 of them) are the purchasable Daily Flexyn
--     Drop, sold by purchase_branded_item. getItemsByRarity is documented
--     "stickers only for drops" and filters ITEMS alone, so branded items
--     have never been capsule loot. Seeding them would have quietly made 38
--     purchase-only cosmetics free from capsules. CapsuleOpener does fold
--     them into the spinning REEL for visual variety, which is what makes
--     this easy to get wrong — the reel is not the drop pool.
--   • cap_* items are type 'capsule', excluded by the same sticker filter.
--
-- Deliberately NOT changing any signature. Capsule opening is a multi-path
-- flow — CapsuleOpener falls back from open_capsule_atomic to
-- claim_capsule_loot, inventoryFlow finalises, and capsuleRecovery re-runs
-- finalize_capsule_claim to rescue capsules stranded between the roll and the
-- claim. Changing arities would break the recovery path and strand real
-- users' capsules. p_candidates and the p_item_* arguments stay in place and
-- become inert.
--
-- ── L3: pity existed on only one of the two roll paths ───────────────────
--
-- open_capsule_atomic held the pity counters under FOR UPDATE and guaranteed
-- epic at 30 / legendary at 90. claim_capsule_loot neither read nor
-- incremented them, so opening through the fallback path forfeited the
-- guarantee AND failed to advance it for later pulls. Migration 256's promise
-- was conditional on which RPC the client happened to call.
--
-- _roll_capsule_rarity is now the single roller. Both paths call it, so the
-- odds and the pity are identical whichever one runs — the same
-- "exists once" rule migration 261 applied to the level curve.
--
-- Paste-safety: no dotted alias.column or record .id tokens (CLAUDE.md §7).

-- ── The catalogue ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loot_catalog (
  item_id     TEXT PRIMARY KEY,
  item_name   TEXT NOT NULL,
  item_emoji  TEXT NOT NULL DEFAULT '',
  item_type   TEXT NOT NULL,
  item_rarity TEXT NOT NULL
);

COMMENT ON TABLE public.loot_catalog IS
  'Every rollable loot item. Generated from src/lib/lootCatalog.js + lootThemes/lootTitles/lootFrames. The database picks drops from here; client-supplied item ids are never trusted.';

INSERT INTO public.loot_catalog (item_id, item_name, item_emoji, item_type, item_rarity) VALUES
  ('stk_muscle','Flex','💪','sticker','common'),('stk_fire','On Fire','🔥','sticker','common'),('stk_star','Star','⭐','sticker','common'),
  ('stk_thumbs','Solid','👍','sticker','common'),('stk_target','Bullseye','🎯','sticker','common'),('stk_crown','Crown','👑','sticker','uncommon'),
  ('stk_rocket','Launch','🚀','sticker','uncommon'),('stk_diamond','Diamond','💎','sticker','uncommon'),('stk_zap','Zap','⚡','sticker','uncommon'),
  ('stk_trophy','Trophy','🏆','sticker','uncommon'),('stk_dragon','Dragon','🐉','sticker','rare'),('stk_eagle','Eagle','🦅','sticker','rare'),
  ('stk_wave','Wave','🌊','sticker','rare'),('stk_galaxy','Galaxy','🌌','sticker','epic'),('stk_orb','Crystal Orb','🔮','sticker','epic'),
  ('stk_lion','Lion','🦁','sticker','epic'),('stk_glow','Radiance','🌟','sticker','legendary'),('stk_comet','Comet','💫','sticker','legendary'),
  ('stk_sparkle','Sparkle','✨','sticker','animated'),('loot_coral','Coral Rush','🪸','theme','common'),('loot_mint','Mint Frost','🌿','theme','common'),
  ('loot_rose','Rose Quartz','🌸','theme','common'),('loot_dusk','Dusk Protocol','🌅','theme','uncommon'),('loot_tidal','Tidal Force','🌊','theme','uncommon'),
  ('loot_nebula','Nebula','🌌','theme','rare'),('loot_ember','Ember Core','🔥','theme','rare'),('loot_aurora','Aurora','🌠','theme','epic'),
  ('loot_cyberpunk','Cyberpunk','🤖','theme','epic'),('loot_prism','Prismatic','💎','theme','legendary'),('loot_solar','Solar Flare','☀️','theme','common'),
  ('loot_jade','Jade Stone','🟢','theme','common'),('loot_sunset','Sunset Pulse','🌅','theme','uncommon'),('loot_arctic','Arctic Glow','❄️','theme','uncommon'),
  ('loot_volcano','Volcanic','🌋','theme','rare'),('loot_galaxy','Galactic','🌌','theme','epic'),('loot_zen','Zen Garden','🪨','theme','common'),
  ('loot_abyss','Deep Ocean Abyss','🦑','theme','rare'),('loot_storm','Storm Chaser','⛈️','theme','epic'),('loot_kingdom','Underwater Kingdom','🔱','theme','legendary'),
  ('loot_dragon','Dragon''s Lair','🐉','theme','mythic'),('loot_mirage','Desert Mirage','🏜️','theme','uncommon'),('loot_summit','Mountain Summit','🏔️','theme','uncommon'),
  ('loot_temple','Ancient Temple','🏛️','theme','rare'),('loot_waterfall','Waterfall Sanctuary','🏞️','theme','rare'),('loot_lunar','Lunar Colony','🌕','theme','epic'),
  ('loot_enchanted','Enchanted Forest','🍄','theme','epic'),('t_grinder','The Grinder','⚙️','title','common'),('t_athlete','Athlete','🏃','title','common'),
  ('t_consistent','Consistent','📅','title','common'),('t_committed','Committed','🤝','title','common'),('t_lifter','Lifter','🏋️','title','common'),
  ('t_iron_will','Iron Will','🛡️','title','uncommon'),('t_beast_mode','Beast Mode','🐺','title','uncommon'),('t_hustler','The Hustler','💼','title','uncommon'),
  ('t_iron_wolf','Iron Wolf','🐾','title','uncommon'),('t_relentless','Relentless','🔁','title','uncommon'),('t_iron_king','Iron King','👑','title','rare'),
  ('t_apex','Apex','🦅','title','rare'),('t_warlord','Warlord','⚔️','title','rare'),('t_storm_chaser','Storm Chaser','⚡','title','rare'),
  ('t_phoenix','Phoenix','🔥','title','epic'),('t_titan','Titan','🗿','title','epic'),('t_marathon_god','Marathon God','🏛️','title','epic'),
  ('t_immortal','Immortal','🌌','title','legendary'),('t_chosen_one','The Chosen One','✨','title','legendary'),('f_steel','Steel Edge','🔘','frame','common'),
  ('f_amber','Amber Edge','🟠','frame','common'),('f_emerald','Emerald Edge','🟢','frame','common'),('f_sunset','Sunset Glow','🌅','frame','uncommon'),
  ('f_ocean','Ocean Tide','🌊','frame','uncommon'),('f_forest','Forest Path','🌲','frame','uncommon'),('f_gold_shimmer','Gold Shimmer','🌟','frame','rare'),
  ('f_crimson','Crimson Tide','🔴','frame','rare'),('f_rainbow','Rainbow Aura','🌈','frame','epic'),('f_legendary_aura','Legendary Aura','👑','frame','legendary')
ON CONFLICT (item_id) DO UPDATE
  SET item_name   = EXCLUDED.item_name,
      item_emoji  = EXCLUDED.item_emoji,
      item_type   = EXCLUDED.item_type,
      item_rarity = EXCLUDED.item_rarity;

CREATE INDEX IF NOT EXISTS idx_loot_catalog_type_rarity
  ON public.loot_catalog (item_type, item_rarity);

REVOKE ALL ON public.loot_catalog FROM PUBLIC;
REVOKE ALL ON public.loot_catalog FROM anon;
GRANT SELECT ON public.loot_catalog TO authenticated;

-- ── One roller, shared by both open paths (L3) ───────────────────────────
CREATE OR REPLACE FUNCTION public._roll_capsule_rarity(p_uid uuid, p_capsule_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $_roll_capsule_rarity$
DECLARE
  v_type       TEXT := COALESCE(p_capsule_type, 'standard');
  v_rarity     TEXT;
  v_since_epic INTEGER;
  v_since_leg  INTEGER;
  v_leg_bonus  NUMERIC := 0;
  v_pity       TEXT := 'none';
  v_epic_at    CONSTANT INTEGER := 30;
  v_leg_at     CONSTANT INTEGER := 90;
  v_soft_from  CONSTANT INTEGER := 61;
BEGIN
  SELECT COALESCE(pity_since_epic, 0), COALESCE(pity_since_legendary, 0)
    INTO v_since_epic, v_since_leg
    FROM public.user_profiles WHERE id = p_uid FOR UPDATE;

  v_since_epic := COALESCE(v_since_epic, 0) + 1;
  v_since_leg  := COALESCE(v_since_leg, 0) + 1;

  IF v_since_leg >= v_leg_at THEN
    v_rarity := 'legendary';
    v_pity   := 'legendary_guaranteed';
  ELSIF v_since_epic >= v_epic_at THEN
    IF v_type = 'premium' THEN
      v_rarity := public._weighted_pick(ARRAY['epic','legendary','animated']::TEXT[],
                                        ARRAY[0.065, 0.013, 0.002]::NUMERIC[]);
    ELSIF v_type = 'elite' THEN
      v_rarity := public._weighted_pick(ARRAY['epic','legendary','animated']::TEXT[],
                                        ARRAY[0.220, 0.070, 0.010]::NUMERIC[]);
    ELSE
      v_rarity := public._weighted_pick(ARRAY['epic','legendary','animated']::TEXT[],
                                        ARRAY[0.018, 0.002, 0.000]::NUMERIC[]);
    END IF;
    v_pity := 'epic_guaranteed';
  ELSE
    IF v_since_leg >= v_soft_from THEN
      v_leg_bonus := (v_since_leg - (v_soft_from - 1)) * 0.03;
      v_pity := 'soft';
    END IF;
    IF v_type = 'premium' THEN
      v_rarity := public._weighted_pick(
        ARRAY['common','uncommon','rare','epic','legendary','animated']::TEXT[],
        ARRAY[0.350, 0.380, 0.190, 0.065, 0.013 + v_leg_bonus, 0.002]::NUMERIC[]);
    ELSIF v_type = 'elite' THEN
      v_rarity := public._weighted_pick(
        ARRAY['common','uncommon','rare','epic','legendary','animated']::TEXT[],
        ARRAY[0.100, 0.250, 0.350, 0.220, 0.070 + v_leg_bonus, 0.010]::NUMERIC[]);
    ELSE
      v_rarity := public._weighted_pick(
        ARRAY['common','uncommon','rare','epic','legendary','animated']::TEXT[],
        ARRAY[0.600, 0.280, 0.100, 0.018, 0.002 + v_leg_bonus, 0.000]::NUMERIC[]);
    END IF;
  END IF;

  IF v_rarity IN ('legendary', 'mythic', 'animated') THEN
    v_since_leg  := 0;
    v_since_epic := 0;
  ELSIF v_rarity = 'epic' THEN
    v_since_epic := 0;
  END IF;

  UPDATE public.user_profiles
     SET pity_since_epic = v_since_epic, pity_since_legendary = v_since_leg
   WHERE id = p_uid;

  RETURN jsonb_build_object('rarity', v_rarity, 'pity', v_pity,
                            'since_epic', v_since_epic, 'since_legendary', v_since_leg);
END;
$_roll_capsule_rarity$;

REVOKE ALL ON FUNCTION public._roll_capsule_rarity(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._roll_capsule_rarity(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public._roll_capsule_rarity(uuid, text) FROM authenticated;

-- ── Category + variant roll ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._roll_capsule_shape(p_capsule_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $_roll_capsule_shape$
DECLARE
  v_type     TEXT := COALESCE(p_capsule_type, 'standard');
  v_category TEXT;
  v_variant  TEXT;
BEGIN
  IF v_type = 'premium' THEN
    v_category := public._weighted_pick(ARRAY['theme','title','frame','sticker']::TEXT[],
                                        ARRAY[0.08, 0.12, 0.10, 0.70]::NUMERIC[]);
  ELSIF v_type = 'elite' THEN
    v_category := public._weighted_pick(ARRAY['theme','title','frame','sticker']::TEXT[],
                                        ARRAY[0.18, 0.20, 0.17, 0.45]::NUMERIC[]);
  ELSE
    v_category := public._weighted_pick(ARRAY['theme','title','frame','sticker']::TEXT[],
                                        ARRAY[0.03, 0.05, 0.04, 0.88]::NUMERIC[]);
  END IF;

  IF v_category = 'sticker' THEN
    IF v_type = 'premium' THEN
      v_variant := public._weighted_pick(ARRAY['plain','foil','gold','diamond']::TEXT[],
                                         ARRAY[0.90, 0.08, 0.02, 0.00]::NUMERIC[]);
    ELSIF v_type = 'elite' THEN
      v_variant := public._weighted_pick(ARRAY['plain','foil','gold','diamond']::TEXT[],
                                         ARRAY[0.80, 0.14, 0.05, 0.01]::NUMERIC[]);
    ELSE
      v_variant := public._weighted_pick(ARRAY['plain','foil','gold','diamond']::TEXT[],
                                         ARRAY[0.97, 0.03, 0.00, 0.00]::NUMERIC[]);
    END IF;
    IF v_variant = 'plain' THEN v_variant := NULL; END IF;
  ELSE
    v_variant := NULL;
  END IF;

  RETURN jsonb_build_object('category', v_category, 'variant', v_variant);
END;
$_roll_capsule_shape$;

REVOKE ALL ON FUNCTION public._roll_capsule_shape(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._roll_capsule_shape(text) FROM anon;
REVOKE ALL ON FUNCTION public._roll_capsule_shape(text) FROM authenticated;

-- ── Item pick, from the catalogue only (L2) ──────────────────────────────
-- Falls back the way the old client pool did: exact (category, rarity), then
-- any sticker of that rarity, then anything of that rarity. theme/title/frame
-- have no 'animated' tier, so without a fallback an animated roll on those
-- categories would have nothing to award.
CREATE OR REPLACE FUNCTION public._pick_loot_item(p_rarity text, p_category text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $_pick_loot_item$
DECLARE
  v_row jsonb;
BEGIN
  SELECT jsonb_build_object('item_id', item_id, 'item_name', item_name,
                            'item_emoji', item_emoji, 'item_type', item_type)
    INTO v_row
    FROM public.loot_catalog
   WHERE item_rarity = p_rarity AND item_type = p_category AND item_type <> 'capsule'
   ORDER BY random() LIMIT 1;
  IF v_row IS NOT NULL THEN RETURN v_row; END IF;

  SELECT jsonb_build_object('item_id', item_id, 'item_name', item_name,
                            'item_emoji', item_emoji, 'item_type', item_type)
    INTO v_row
    FROM public.loot_catalog
   WHERE item_rarity = p_rarity AND item_type = 'sticker'
   ORDER BY random() LIMIT 1;
  IF v_row IS NOT NULL THEN RETURN v_row; END IF;

  SELECT jsonb_build_object('item_id', item_id, 'item_name', item_name,
                            'item_emoji', item_emoji, 'item_type', item_type)
    INTO v_row
    FROM public.loot_catalog
   WHERE item_rarity = p_rarity AND item_type <> 'capsule'
   ORDER BY random() LIMIT 1;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'no catalogue item for rarity %', p_rarity USING ERRCODE = '22023';
  END IF;
  RETURN v_row;
END;
$_pick_loot_item$;

REVOKE ALL ON FUNCTION public._pick_loot_item(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._pick_loot_item(text, text) FROM anon;
REVOKE ALL ON FUNCTION public._pick_loot_item(text, text) FROM authenticated;

-- ── open_capsule_atomic: same signature, p_candidates now inert ──────────
CREATE OR REPLACE FUNCTION public.open_capsule_atomic(p_capsule_id uuid, p_candidates jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $open_capsule_atomic$
DECLARE
  v_uid          UUID := auth.uid();
  v_email        TEXT;
  v_type         TEXT;
  v_roll         JSONB;
  v_shape        JSONB;
  v_item         JSONB;
  v_rarity       TEXT;
  v_category     TEXT;
  v_variant      TEXT;
  v_inventory_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_capsule_id IS NULL THEN
    RAISE EXCEPTION 'capsule_id required' USING ERRCODE = '22023';
  END IF;
  -- p_candidates is accepted and IGNORED. It used to decide which item the
  -- caller received; the catalogue does that now. Kept so the existing
  -- client and the recovery path keep working unchanged.

  UPDATE public.user_capsules
     SET is_opened = TRUE, opened_at = now()
   WHERE id = p_capsule_id AND user_id = v_uid AND is_opened = FALSE
  RETURNING capsule_type INTO v_type;

  IF v_type IS NULL THEN
    RAISE EXCEPTION 'capsule not found or already opened' USING ERRCODE = '22023';
  END IF;
  v_type := COALESCE(v_type, 'standard');

  v_roll     := public._roll_capsule_rarity(v_uid, v_type);
  v_rarity   := v_roll ->> 'rarity';
  v_shape    := public._roll_capsule_shape(v_type);
  v_category := v_shape ->> 'category';
  v_variant  := v_shape ->> 'variant';
  v_item     := public._pick_loot_item(v_rarity, v_category);
  v_category := COALESCE(v_item ->> 'item_type', v_category);

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;
  IF v_email IS NULL OR v_email = '' THEN
    v_email := 'guest_' || v_uid || '@flexyn.guest';
  END IF;

  INSERT INTO public.user_inventory
    (user_id, user_email, item_id, item_name, item_emoji, item_rarity, item_type, variant, acquired_via)
  VALUES
    (v_uid, v_email, v_item ->> 'item_id', v_item ->> 'item_name', v_item ->> 'item_emoji',
     v_rarity, v_category, v_variant, 'capsule')
  RETURNING id INTO v_inventory_id;

  UPDATE public.user_capsules
     SET rolled_rarity = v_rarity, rolled_category = v_category,
         rolled_variant = v_variant, finalized_at = now()
   WHERE id = p_capsule_id;

  RETURN jsonb_build_object(
    'capsule_id', p_capsule_id, 'capsule_type', v_type,
    'rarity', v_rarity, 'category', v_category, 'variant', v_variant,
    'inventory_id', v_inventory_id,
    'item_id', v_item ->> 'item_id', 'item_name', v_item ->> 'item_name',
    'item_emoji', v_item ->> 'item_emoji', 'item_type', v_category,
    'pity', v_roll ->> 'pity',
    'since_epic', (v_roll ->> 'since_epic')::INTEGER,
    'since_legendary', (v_roll ->> 'since_legendary')::INTEGER
  );
END;
$open_capsule_atomic$;

REVOKE ALL ON FUNCTION public.open_capsule_atomic(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_capsule_atomic(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.open_capsule_atomic(uuid, jsonb) TO authenticated;

-- ── claim_capsule_loot: now shares the roller, so it gains pity (L3) ────
CREATE OR REPLACE FUNCTION public.claim_capsule_loot(p_capsule_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $claim_capsule_loot$
DECLARE
  v_uid      UUID := auth.uid();
  v_type     TEXT;
  v_roll     JSONB;
  v_shape    JSONB;
  v_rarity   TEXT;
  v_category TEXT;
  v_variant  TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_capsule_id IS NULL THEN
    RAISE EXCEPTION 'capsule_id required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.user_capsules SET is_opened = true, opened_at = now()
   WHERE id = p_capsule_id AND user_id = v_uid AND is_opened = false
  RETURNING capsule_type INTO v_type;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'capsule not found or already opened' USING ERRCODE = '22023';
  END IF;
  v_type := COALESCE(v_type, 'standard');

  -- Was an inline weighted pick with NO pity read or increment, so opening
  -- through this path forfeited the epic-at-30 / legendary-at-90 guarantee
  -- and left the counters unmoved for later pulls.
  v_roll     := public._roll_capsule_rarity(v_uid, v_type);
  v_rarity   := v_roll ->> 'rarity';
  v_shape    := public._roll_capsule_shape(v_type);
  v_category := v_shape ->> 'category';
  v_variant  := v_shape ->> 'variant';

  UPDATE public.user_capsules
     SET rolled_rarity = v_rarity, rolled_category = v_category, rolled_variant = v_variant
   WHERE id = p_capsule_id;

  RETURN jsonb_build_object('capsule_id', p_capsule_id, 'capsule_type', v_type,
                            'rarity', v_rarity, 'category', v_category, 'variant', v_variant,
                            'pity', v_roll ->> 'pity');
END;
$claim_capsule_loot$;

REVOKE ALL ON FUNCTION public.claim_capsule_loot(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_capsule_loot(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_capsule_loot(uuid) TO authenticated;

-- ── finalize_capsule_claim: item now comes from the catalogue (L2) ───────
CREATE OR REPLACE FUNCTION public.finalize_capsule_claim(
  p_capsule_id uuid, p_item_id text, p_item_name text, p_item_emoji text,
  p_item_rarity text, p_item_type text, p_variant text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $finalize_capsule_claim$
DECLARE
  v_uid            UUID := auth.uid();
  v_email          TEXT;
  v_is_opened      BOOLEAN;
  v_rolled_rarity  TEXT;
  v_rolled_variant TEXT;
  v_rolled_cat     TEXT;
  v_finalized      TIMESTAMPTZ;
  v_item           JSONB;
  v_inventory_id   UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF p_capsule_id IS NULL THEN
    RAISE EXCEPTION 'capsule_id required' USING ERRCODE = '22023';
  END IF;
  -- p_item_id / p_item_name / p_item_emoji / p_item_type / p_item_rarity /
  -- p_variant are all accepted and IGNORED. They are what made any cosmetic
  -- claimable from any roll. The item is derived from the catalogue and this
  -- capsule's own stored roll instead. Arguments retained so the recovery
  -- path in capsuleRecovery.js keeps working.

  SELECT is_opened, rolled_rarity, rolled_variant, rolled_category, finalized_at
    INTO v_is_opened, v_rolled_rarity, v_rolled_variant, v_rolled_cat, v_finalized
    FROM public.user_capsules
   WHERE id = p_capsule_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'capsule not found' USING ERRCODE = '22023'; END IF;
  IF v_is_opened IS NOT TRUE THEN
    RAISE EXCEPTION 'capsule not yet opened' USING ERRCODE = '22023';
  END IF;
  IF v_rolled_rarity IS NULL THEN
    RAISE EXCEPTION 'capsule roll missing — call claim_capsule_loot first' USING ERRCODE = '22023';
  END IF;
  IF v_finalized IS NOT NULL THEN
    RAISE EXCEPTION 'capsule already claimed' USING ERRCODE = '22023';
  END IF;

  v_item := public._pick_loot_item(v_rolled_rarity, COALESCE(v_rolled_cat, 'sticker'));

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;
  IF v_email IS NULL OR v_email = '' THEN
    v_email := 'guest_' || v_uid || '@flexyn.guest';
  END IF;

  INSERT INTO public.user_inventory
    (user_id, user_email, item_id, item_name, item_emoji, item_rarity, item_type, variant, acquired_via)
  VALUES
    (v_uid, v_email, v_item ->> 'item_id', v_item ->> 'item_name', v_item ->> 'item_emoji',
     v_rolled_rarity, COALESCE(v_item ->> 'item_type', v_rolled_cat), v_rolled_variant, 'capsule')
  RETURNING id INTO v_inventory_id;

  UPDATE public.user_capsules SET finalized_at = now() WHERE id = p_capsule_id;

  RETURN jsonb_build_object(
    'ok', true, 'inventory_id', v_inventory_id,
    'item_id', v_item ->> 'item_id', 'item_name', v_item ->> 'item_name',
    'item_emoji', v_item ->> 'item_emoji',
    'item_rarity', v_rolled_rarity, 'item_variant', v_rolled_variant);
END;
$finalize_capsule_claim$;

REVOKE ALL ON FUNCTION public.finalize_capsule_claim(uuid, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_capsule_claim(uuid, text, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.finalize_capsule_claim(uuid, text, text, text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
