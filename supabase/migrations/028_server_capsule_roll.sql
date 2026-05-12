-- 028_server_capsule_roll.sql
--
-- Closes the most severe exploit in the audit: capsule rolls were entirely
-- client-side via Math.random(), trivially patchable in DevTools to force
-- animated rarity every open. Combined with the non-atomic open+grant flow,
-- a determined user could reopen capsules indefinitely until they hit a
-- jackpot.
--
-- This migration moves the AUTHORITATIVE rolls server-side:
--   • rarity (common → animated)
--   • category (which loot pool: sticker / theme / title / frame)
--   • variant (foil / gold / diamond — sticker only)
-- The client still picks the specific item within the rolled rarity from
-- its catalog — items within the same rarity tier are equivalent in
-- value, so the residual cheat surface is "pick which specific legendary
-- to grant" rather than "pick the rarity tier itself". That residual is
-- bounded by capsule supply and acceptable for a v1 hardening.
--
-- The capsule row is atomically locked + claimed via `UPDATE … WHERE
-- is_opened=false RETURNING …` so a concurrent open can't double-roll.

ALTER TABLE public.user_capsules
  ADD COLUMN IF NOT EXISTS rolled_rarity   TEXT,
  ADD COLUMN IF NOT EXISTS rolled_category TEXT,
  ADD COLUMN IF NOT EXISTS rolled_variant  TEXT;

-- Helper: pick a random key from a weighted bag. Each `keys[i]` has weight
-- `weights[i]`. Returns the key. Weights don't need to sum to 1.
CREATE OR REPLACE FUNCTION public._weighted_pick(keys TEXT[], weights NUMERIC[])
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_sum NUMERIC := 0;
  v_roll NUMERIC;
  v_cum  NUMERIC := 0;
  v_i    INT;
BEGIN
  IF keys IS NULL OR array_length(keys, 1) IS NULL THEN
    RETURN NULL;
  END IF;
  FOR v_i IN 1..array_length(weights, 1) LOOP
    v_sum := v_sum + weights[v_i];
  END LOOP;
  IF v_sum <= 0 THEN
    RETURN keys[1];
  END IF;
  v_roll := random() * v_sum;
  FOR v_i IN 1..array_length(keys, 1) LOOP
    v_cum := v_cum + weights[v_i];
    IF v_roll < v_cum THEN
      RETURN keys[v_i];
    END IF;
  END LOOP;
  RETURN keys[array_length(keys, 1)]; -- floating-point edge
END;
$$;

-- Main RPC.
-- Returns JSONB: { rarity, category, variant?, capsule_type }
-- The client maps (category, rarity) to a specific item from its catalog.
CREATE OR REPLACE FUNCTION public.claim_capsule_loot(p_capsule_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_capsule   public.user_capsules%ROWTYPE;
  v_rarity    TEXT;
  v_category  TEXT;
  v_variant   TEXT;
  v_capsule_type TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_capsule_id IS NULL THEN
    RAISE EXCEPTION 'capsule_id required' USING ERRCODE = '22023';
  END IF;

  -- Atomic claim: only the FIRST caller flips is_opened=true AND gets
  -- the row back. Subsequent calls (concurrent tab, replay) see no
  -- rows and bail. Restricts to caller-owned via user_id = v_uid.
  UPDATE public.user_capsules
     SET is_opened = true,
         opened_at = now()
   WHERE id = p_capsule_id
     AND user_id = v_uid
     AND is_opened = false
  RETURNING * INTO v_capsule;

  IF v_capsule.id IS NULL THEN
    RAISE EXCEPTION 'capsule not found or already opened' USING ERRCODE = '22023';
  END IF;

  v_capsule_type := COALESCE(v_capsule.capsule_type, 'standard');

  -- ── Rarity roll (per capsule_type) ─────────────────────────────────────
  -- Mirrors CAPSULE_ODDS in src/lib/lootCatalog.js. Kept in sync manually.
  IF v_capsule_type = 'premium' THEN
    v_rarity := public._weighted_pick(
      ARRAY['common','uncommon','rare','epic','legendary','animated']::TEXT[],
      ARRAY[0.350, 0.380, 0.190, 0.065, 0.013, 0.002]::NUMERIC[]
    );
  ELSIF v_capsule_type = 'elite' THEN
    v_rarity := public._weighted_pick(
      ARRAY['common','uncommon','rare','epic','legendary','animated']::TEXT[],
      ARRAY[0.100, 0.250, 0.350, 0.220, 0.070, 0.010]::NUMERIC[]
    );
  ELSE -- 'standard' fallback
    v_rarity := public._weighted_pick(
      ARRAY['common','uncommon','rare','epic','legendary','animated']::TEXT[],
      ARRAY[0.600, 0.280, 0.100, 0.018, 0.002, 0.000]::NUMERIC[]
    );
  END IF;

  -- ── Category roll (sticker vs theme vs title vs frame) ────────────────
  -- Probabilities: themes/titles/frames are bonus drops on top of the
  -- always-sticker default. We invert that here: roll category once and
  -- always return a single category. Sums to 1.0 per type below.
  --   standard: theme 0.03, title 0.05, frame 0.04, sticker 0.88
  --   premium:  theme 0.08, title 0.12, frame 0.10, sticker 0.70
  --   elite:    theme 0.18, title 0.20, frame 0.17, sticker 0.45
  IF v_capsule_type = 'premium' THEN
    v_category := public._weighted_pick(
      ARRAY['theme','title','frame','sticker']::TEXT[],
      ARRAY[0.08, 0.12, 0.10, 0.70]::NUMERIC[]
    );
  ELSIF v_capsule_type = 'elite' THEN
    v_category := public._weighted_pick(
      ARRAY['theme','title','frame','sticker']::TEXT[],
      ARRAY[0.18, 0.20, 0.17, 0.45]::NUMERIC[]
    );
  ELSE
    v_category := public._weighted_pick(
      ARRAY['theme','title','frame','sticker']::TEXT[],
      ARRAY[0.03, 0.05, 0.04, 0.88]::NUMERIC[]
    );
  END IF;

  -- ── Variant roll (sticker only) ───────────────────────────────────────
  IF v_category = 'sticker' THEN
    IF v_capsule_type = 'premium' THEN
      v_variant := public._weighted_pick(
        ARRAY['plain','foil','gold','diamond']::TEXT[],
        ARRAY[0.90, 0.08, 0.02, 0.00]::NUMERIC[]
      );
    ELSIF v_capsule_type = 'elite' THEN
      v_variant := public._weighted_pick(
        ARRAY['plain','foil','gold','diamond']::TEXT[],
        ARRAY[0.80, 0.14, 0.05, 0.01]::NUMERIC[]
      );
    ELSE
      v_variant := public._weighted_pick(
        ARRAY['plain','foil','gold','diamond']::TEXT[],
        ARRAY[0.97, 0.03, 0.00, 0.00]::NUMERIC[]
      );
    END IF;
    IF v_variant = 'plain' THEN v_variant := NULL; END IF;
  ELSE
    v_variant := NULL;
  END IF;

  -- Persist the rolled values back onto the capsule row so the audit
  -- trail is recoverable AND so any inventory-validation trigger (future)
  -- can verify the granted item matches what the server rolled.
  UPDATE public.user_capsules
     SET rolled_rarity   = v_rarity,
         rolled_category = v_category,
         rolled_variant  = v_variant
   WHERE id = p_capsule_id;

  RETURN jsonb_build_object(
    'capsule_id',   p_capsule_id,
    'capsule_type', v_capsule_type,
    'rarity',       v_rarity,
    'category',     v_category,
    'variant',      v_variant
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_capsule_loot(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
