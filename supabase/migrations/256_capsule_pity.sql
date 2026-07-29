-- 256_capsule_pity.sql
--
-- Real pity. The streak counter stops being trivia and becomes a promise.
--
-- WHY
--
-- Standard capsules are 0.2% legendary. That is ~347 standard capsules for
-- a coin-flip at one legendary, and standards are what players actually
-- accumulate (level-ups, daily chest). At a couple a week a legendary is a
-- multi-year event, which is indistinguishable from unreachable.
--
-- Measured complaint that prompted this: 20 capsules (10 standard, 5
-- premium, 5 elite) returned 2 epics and no legendary. That was NOT a bug
-- — P(zero legendary) for that mix is 64% and the epic+ count landed
-- exactly on its 2.1 expectation. Independent rolls simply produce long
-- barren stretches, and no amount of correct math makes 20 opens with
-- nothing to show feel like anything other than a waste.
--
-- Softening the base curve would have been the smaller change. Pity is the
-- better one: it bounds the worst case instead of shifting the average, so
-- an unlucky player is protected without an average player being flooded.
--
-- THE MECHANIC
--
--   • Every capsule opened increments both counters.
--   • Epic or better  -> resets the epic counter.
--   • Legendary or better -> resets BOTH (legendary is also epic+).
--   • Hard floor: 30 opens without epic+ guarantees epic+.
--   • Hard ceiling: 90 opens without legendary+ guarantees legendary+.
--   • Soft pity: from open 61, legendary weight climbs each open so the
--     90 is approached rather than hit as a cliff.
--
-- Counters are per USER, not per capsule type — "opens since" is what the
-- UI says and what a player counts.
--
-- CONCURRENCY
--
-- The profile row is locked FOR UPDATE before the counters are read. This
-- matters: a batch open fires N calls in parallel, and without the lock
-- all N would read the same counter, all increment to +1, and pity would
-- barely move across a ten-pull. The lock serialises opens per user, which
-- is the correct behaviour even though it costs a little latency.
--
-- DISCLOSURE
--
-- The thresholds are returned by get_capsule_pity() rather than hardcoded
-- in the client. The odds panel exists because loot-box disclosure is
-- legally required in several markets, and the rates already live in two
-- places (lootCatalog.js for display, the SQL tables for the roll). Adding
-- a third hardcoded copy in the UI would guarantee drift; letting the
-- server state its own rules cannot drift.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS pity_since_epic      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pity_since_legendary INTEGER NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- Where the user stands, and the rules they're standing against.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_capsule_pity()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_epic      INTEGER := 0;
  v_legendary INTEGER := 0;
BEGIN
  IF v_uid IS NOT NULL THEN
    SELECT COALESCE(pity_since_epic, 0), COALESCE(pity_since_legendary, 0)
      INTO v_epic, v_legendary
      FROM public.user_profiles
     WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object(
    'since_epic',       COALESCE(v_epic, 0),
    'since_legendary',  COALESCE(v_legendary, 0),
    'epic_at',          30,
    'legendary_at',     90,
    'soft_pity_from',   61
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_capsule_pity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_capsule_pity() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- open_capsule_atomic, now pity-aware.
-- Body is migration 255's, with the rarity roll replaced. Everything else
-- — the single-transaction grant, the candidate menu, the guest-safe
-- email, the server-owned rarity — is unchanged.
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_since_epic   INTEGER;
  v_since_leg    INTEGER;
  v_leg_bonus    NUMERIC := 0;
  v_pity         TEXT := 'none';
  v_epic_at      CONSTANT INTEGER := 30;
  v_leg_at       CONSTANT INTEGER := 90;
  v_soft_from    CONSTANT INTEGER := 61;
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

  -- Lock the profile so parallel opens in a batch can't all read the same
  -- counter. Without this a ten-pull advances pity by one.
  SELECT COALESCE(pity_since_epic, 0), COALESCE(pity_since_legendary, 0)
    INTO v_since_epic, v_since_leg
    FROM public.user_profiles
   WHERE id = v_uid
     FOR UPDATE;

  v_since_epic := COALESCE(v_since_epic, 0) + 1;
  v_since_leg  := COALESCE(v_since_leg, 0) + 1;

  -- ── Rarity, with pity ────────────────────────────────────────────────
  IF v_since_leg >= v_leg_at THEN
    v_rarity := 'legendary';
    v_pity   := 'legendary_guaranteed';

  ELSIF v_since_epic >= v_epic_at THEN
    -- Guaranteed epic+, distributed by this capsule type's own relative
    -- weights among the top tiers — an elite's guarantee is likelier to
    -- pay out legendary than a standard's, which is the right shape.
    IF v_type = 'premium' THEN
      v_rarity := public._weighted_pick(
        ARRAY['epic','legendary','animated']::TEXT[],
        ARRAY[0.065, 0.013, 0.002]::NUMERIC[]);
    ELSIF v_type = 'elite' THEN
      v_rarity := public._weighted_pick(
        ARRAY['epic','legendary','animated']::TEXT[],
        ARRAY[0.220, 0.070, 0.010]::NUMERIC[]);
    ELSE
      v_rarity := public._weighted_pick(
        ARRAY['epic','legendary','animated']::TEXT[],
        ARRAY[0.018, 0.002, 0.000]::NUMERIC[]);
    END IF;
    v_pity := 'epic_guaranteed';

  ELSE
    -- Soft pity: from open 61 the legendary weight climbs, so the hard
    -- ceiling at 90 is approached rather than hit as a cliff.
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

  -- ── Counter resets ───────────────────────────────────────────────────
  IF v_rarity IN ('legendary', 'mythic', 'animated') THEN
    v_since_leg  := 0;
    v_since_epic := 0;   -- legendary is also epic-or-better
  ELSIF v_rarity = 'epic' THEN
    v_since_epic := 0;
  END IF;

  UPDATE public.user_profiles
     SET pity_since_epic      = v_since_epic,
         pity_since_legendary = v_since_leg
   WHERE id = v_uid;

  -- ── Category roll (unchanged from 255) ───────────────────────────────
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

  -- ── Variant roll (stickers only, unchanged) ──────────────────────────
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

  -- ── Resolve against the client's candidate menu ──────────────────────
  v_key  := v_category || ':' || v_rarity;
  v_pick := p_candidates -> v_key;

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

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;
  IF v_email IS NULL OR v_email = '' THEN
    v_email := 'guest_' || v_uid || '@flexyn.guest';
  END IF;

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
    'capsule_id',      p_capsule_id,
    'capsule_type',    v_type,
    'rarity',          v_rarity,
    'category',        v_category,
    'variant',         v_variant,
    'inventory_id',    v_inventory_id,
    'item_id',         v_item_id,
    'item_name',       v_item_name,
    'item_emoji',      v_item_emoji,
    'item_type',       v_item_type,
    'pity',            v_pity,
    'since_epic',      v_since_epic,
    'since_legendary', v_since_leg
  );
END;
$$;

REVOKE ALL ON FUNCTION public.open_capsule_atomic(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_capsule_atomic(UUID, JSONB) TO authenticated;

-- Seed the counters from history so nobody starts at zero having already
-- opened hundreds. Counts opens since each user's most recent qualifying
-- pull; a user with no qualifying pull gets their total open count, which
-- is exactly "how long they've been waiting".
--
-- Written with fully-qualified public.user_profiles.id rather than a short
-- alias: the paste pipeline this SQL is delivered through mangles
-- alias.column tokens into a 42601 syntax error (see CLAUDE.md).
UPDATE public.user_profiles
   SET pity_since_epic = COALESCE((
         SELECT count(*)
           FROM public.user_capsules
          WHERE user_id = public.user_profiles.id
            AND is_opened = TRUE
            AND opened_at > COALESCE((
                  SELECT max(opened_at)
                    FROM public.user_capsules
                   WHERE user_id = public.user_profiles.id
                     AND rolled_rarity IN ('epic','legendary','mythic','animated')
                ), '-infinity'::timestamptz)
       ), 0),
       pity_since_legendary = COALESCE((
         SELECT count(*)
           FROM public.user_capsules
          WHERE user_id = public.user_profiles.id
            AND is_opened = TRUE
            AND opened_at > COALESCE((
                  SELECT max(opened_at)
                    FROM public.user_capsules
                   WHERE user_id = public.user_profiles.id
                     AND rolled_rarity IN ('legendary','mythic','animated')
                ), '-infinity'::timestamptz)
       ), 0)
 WHERE EXISTS (
   SELECT 1 FROM public.user_capsules
    WHERE user_id = public.user_profiles.id
      AND is_opened = TRUE
 );
