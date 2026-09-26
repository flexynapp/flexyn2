-- 074_fix_finalize_capsule_column.sql
--
-- Two corrections to migration 070's atomic capsule grants:
--
-- 1. CRITICAL: finalize_capsule_claim's INSERT INTO public.user_inventory
--    referenced a non-existent column `source`. The actual column
--    (defined in migration 009) is `acquired_via`. PL/pgSQL doesn't
--    validate column references inside SQL strings at function-creation
--    time — the function compiled successfully — but every runtime
--    call failed with `column "source" does not exist`.
--
--    Impact: a user clicks "open capsule" → the client calls
--    claim_capsule_loot (server rolls the loot + sets is_opened=true)
--    → then calls finalize_capsule_claim with the rolled item →
--    finalize crashed. The capsule was permanently opened but no
--    user_inventory row was ever written, and the loot is gone.
--    rolled_rarity / rolled_category / rolled_variant ARE persisted
--    on user_capsules during the roll, but the client throws away
--    the wonItem on the toast error, so re-finalize is impractical.
--    Affected users may need a manual replacement capsule.
--
-- 2. Level-1 over-grant in grant_level_up_rewards. Fresh users have
--    `level_capsules_awarded_through = 0` (DEFAULT) and start at
--    current_level = 1. When they hit level 2, the FOR loop ran
--    `v_prev_through + 1 .. p_new_level` = 1..2, granting two
--    standard capsules + 100 coins for a single level-up. The
--    welcome capsule (grantWelcomeCapsule on first device baseline)
--    is already the level-1 acknowledgment, so a fresh user got
--    1 welcome + 2 level-up standards = 3 standards on their first
--    level-up. The floor now skips level 1 — fresh user gets the
--    intended 1 welcome + 1 level-up = 2.
--    Existing users with awarded_through ≥ 1 are unaffected.
--
-- Both fixes use CREATE OR REPLACE so this migration is idempotent
-- and safe to re-run. The companion edits to 070 itself are for any
-- future fresh deployments that run migrations in order; this 074
-- file is the path for hosts that already applied broken 070.


-- ── Fix 1: finalize_capsule_claim column name ───────────────────────────

CREATE OR REPLACE FUNCTION public.finalize_capsule_claim(
  p_capsule_id   UUID,
  p_item_id      TEXT,
  p_item_name    TEXT,
  p_item_emoji   TEXT,
  p_item_rarity  TEXT,
  p_item_type    TEXT,
  p_variant      TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_email        TEXT;
  v_capsule      public.user_capsules%ROWTYPE;
  v_inventory_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_capsule_id IS NULL OR p_item_id IS NULL OR p_item_name IS NULL THEN
    RAISE EXCEPTION 'capsule_id, item_id, item_name required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_capsule
    FROM public.user_capsules
   WHERE id = p_capsule_id
     AND user_id = v_uid
   FOR UPDATE;

  IF v_capsule.id IS NULL THEN
    RAISE EXCEPTION 'capsule not found' USING ERRCODE = '22023';
  END IF;
  IF v_capsule.is_opened IS NOT TRUE THEN
    RAISE EXCEPTION 'capsule not yet opened' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;

  -- THE FIX: column is `acquired_via`, not `source`.
  INSERT INTO public.user_inventory
    (user_id, user_email, item_id, item_name, item_emoji, item_rarity,
     item_type, variant, acquired_via)
  VALUES
    (v_uid, v_email, p_item_id, p_item_name, p_item_emoji, p_item_rarity,
     p_item_type, p_variant, 'capsule')
  RETURNING id INTO v_inventory_id;

  RETURN jsonb_build_object(
    'success',      TRUE,
    'inventory_id', v_inventory_id,
    'capsule_id',   p_capsule_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_capsule_claim(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;


-- ── Fix 2: grant_level_up_rewards skip-level-1 ──────────────────────────

CREATE OR REPLACE FUNCTION public.grant_level_up_rewards(p_new_level INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid             UUID := auth.uid();
  v_email           TEXT;
  v_prev_through    INT;
  v_lvl             INT;
  v_standard_count  INT := 0;
  v_premium_count   INT := 0;
  v_elite_count     INT := 0;
  v_coins_total     INT := 0;
  v_new_balance     INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_new_level IS NULL OR p_new_level < 1 THEN
    RAISE EXCEPTION 'invalid level' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(level_capsules_awarded_through, 0), email
    INTO v_prev_through, v_email
    FROM public.user_profiles
   WHERE id = v_uid
   FOR UPDATE;

  -- Atomic CAS — only the FIRST caller advances the counter.
  UPDATE public.user_profiles
     SET level_capsules_awarded_through = p_new_level
   WHERE id = v_uid
     AND COALESCE(level_capsules_awarded_through, 0) = v_prev_through
     AND v_prev_through < p_new_level;

  IF NOT FOUND THEN
    SELECT flex_coins INTO v_new_balance
      FROM public.user_profiles WHERE id = v_uid;
    RETURN jsonb_build_object(
      'already_granted', TRUE,
      'awarded_through', v_prev_through,
      'standard',        0,
      'premium',         0,
      'elite',           0,
      'coins',           0,
      'new_balance',     COALESCE(v_new_balance, 0)
    );
  END IF;

  -- Grant the gap. Level 1 is intentionally skipped: the welcome
  -- capsule already covers it (LevelUpManager.grantWelcomeCapsule
  -- fires on first device baseline). Without the floor, a fresh
  -- user hitting level 2 received 2 standards from this RPC, double
  -- the intended single level-up reward.
  FOR v_lvl IN GREATEST(v_prev_through + 1, 2) .. p_new_level LOOP
    INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
      VALUES (v_uid, v_email, 'standard');
    v_standard_count := v_standard_count + 1;
    v_coins_total := v_coins_total + 50;

    IF v_lvl % 5 = 0 THEN
      INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
        VALUES (v_uid, v_email, 'premium');
      v_premium_count := v_premium_count + 1;
      v_coins_total := v_coins_total + 100;
    END IF;

    IF v_lvl % 10 = 0 THEN
      INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
        VALUES (v_uid, v_email, 'elite');
      v_elite_count := v_elite_count + 1;
    END IF;
  END LOOP;

  UPDATE public.user_profiles
     SET flex_coins = COALESCE(flex_coins, 0) + v_coins_total
   WHERE id = v_uid
  RETURNING flex_coins INTO v_new_balance;

  RETURN jsonb_build_object(
    'already_granted', FALSE,
    'awarded_through', p_new_level,
    'standard',        v_standard_count,
    'premium',         v_premium_count,
    'elite',           v_elite_count,
    'coins',           v_coins_total,
    'new_balance',     COALESCE(v_new_balance, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_level_up_rewards(INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
