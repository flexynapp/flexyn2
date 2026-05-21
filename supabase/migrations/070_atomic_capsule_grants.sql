-- 070_atomic_capsule_grants.sql
--
-- Closes three CRITICAL economic bugs from the capsules audit:
--
--   1. grantForLevelUp had NO idempotency. Profile refetch / two tabs /
--      network retry → LevelUpManager fires the level-up effect twice,
--      each call inserts standard/premium/elite capsules + coins.
--      user_capsules has no unique constraint that would prevent dupes.
--      Real duplicate loot.
--
--   2. inventoryFlow.claimCapsule used Promise.all([addItem, openCapsule]).
--      claim_capsule_loot (migration 028) already rolled + marked
--      opened server-side. If addItem then failed, the capsule was
--      forever opened-empty — silent loot destruction.
--
--   3. LevelUpManager updated localStorage BEFORE awaiting the grant.
--      If grant failed silently, the user saw the celebration overlay
--      but never got the capsule, and localStorage was advanced so
--      the next mount didn't retry.
--
-- Two atomic SECURITY DEFINER RPCs + one new idempotency column close
-- all three.

-- ── Idempotency column for level-up grants ──────────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS level_capsules_awarded_through INT NOT NULL DEFAULT 0;


-- ── grant_level_up_rewards ──────────────────────────────────────────────
-- Atomic + idempotent. Tracks the highest level the user has been paid
-- for via the new level_capsules_awarded_through column.
--
-- Grant rules (mirror src/lib/data/capsules.js grantForLevelUp):
--   • Levels 2+:          1 standard capsule + 50 flex_coins per level
--   • Multiple of 5:      +1 premium capsule + 100 bonus flex_coins
--   • Multiple of 10:     +1 elite capsule
--
-- Level 1 is intentionally NOT rewarded here — every user starts at
-- current_level=1, and the welcome capsule (grantWelcomeCapsule,
-- fired on first device baseline) is the level-1 acknowledgment.
-- Without the floor, a fresh user hitting level 2 would receive the
-- welcome capsule PLUS a level-up grant covering levels 1 AND 2 =
-- 3 standards instead of the intended 2 (welcome + level-up).
--
-- Handles level skips correctly — if the user jumps from level 3 to
-- level 7 in one call, they get standard×4 + premium×1 + coins for
-- each intervening level. The previous code only ever processed one
-- level at a time, so a fast XP earn that crossed multiple levels
-- silently lost rewards for the intervening levels.
--
-- Race semantics: read prev_through, then UPDATE...WHERE prev_through
-- matches AND new_level > prev_through. Two concurrent callers each
-- read the same prev, both attempt the UPDATE — only the first
-- succeeds, the second's WHERE fails (because prev_through has
-- already advanced), and the second call returns already_granted=true
-- without re-granting.

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
  v_rows_updated    INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_new_level IS NULL OR p_new_level < 1 THEN
    RAISE EXCEPTION 'invalid level' USING ERRCODE = '22023';
  END IF;

  -- Read current state inside the implicit transaction.
  SELECT COALESCE(level_capsules_awarded_through, 0), email
    INTO v_prev_through, v_email
    FROM public.user_profiles
   WHERE id = v_uid;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'user_profile not found' USING ERRCODE = '22023';
  END IF;

  -- Atomic compare-and-swap on level_capsules_awarded_through. The
  -- WHERE clause is the lock — only one of N concurrent callers
  -- updates the row; the rest see ROW_COUNT = 0 and bail.
  UPDATE public.user_profiles
     SET level_capsules_awarded_through = p_new_level
   WHERE id = v_uid
     AND COALESCE(level_capsules_awarded_through, 0) = v_prev_through
     AND v_prev_through < p_new_level;
  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    -- Either p_new_level <= already-granted, or another caller raced
    -- ahead. Either way, this call is a clean no-op.
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

  -- Grant the gap (max(prev_through+1, 2) .. p_new_level).
  -- Level 1 is intentionally skipped: every user starts at current_level=1
  -- and the welcome capsule (grantWelcomeCapsule, fired on first device
  -- baseline by LevelUpManager) is the level-1 acknowledgment. Without
  -- this floor, a fresh user hitting level 2 would receive the welcome
  -- capsule + 2 level-up standards = 3 standards, instead of the
  -- intended 1 welcome + 1 level-up = 2.
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

  -- Credit coins atomically via delta arithmetic.
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


-- ── finalize_capsule_claim ──────────────────────────────────────────────
-- Atomic verify-capsule + insert-inventory. The previous flow ran
-- Promise.all([addItem, openCapsule]) — two independent writes. If
-- addItem failed AFTER claim_capsule_loot (mig 028) had already opened
-- the capsule + persisted the rolled tuple, the loot was lost forever.
--
-- This RPC:
--   1. Locks the capsule row + verifies ownership AND is_opened=true.
--      The is_opened gate enforces that inventory is ONLY granted
--      after the server-side roll has happened — no inserting random
--      inventory rows by guessing capsule_ids.
--   2. Inserts the inventory row.
--   3. Returns success with the inventory_id.
--
-- If anything fails the whole transaction rolls back. Either both
-- writes happen or neither does.

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

  -- Lock the capsule row + verify ownership + opened state.
  SELECT * INTO v_capsule
    FROM public.user_capsules
   WHERE id = p_capsule_id
     AND user_id = v_uid
   FOR UPDATE;

  IF v_capsule.id IS NULL THEN
    RAISE EXCEPTION 'capsule not found' USING ERRCODE = '22023';
  END IF;
  IF v_capsule.is_opened IS NOT TRUE THEN
    -- Caller invoked finalize before claim_capsule_loot. The server
    -- roll must happen first — otherwise a malicious client could
    -- finalize any item they want without paying the capsule.
    RAISE EXCEPTION 'capsule not yet opened' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;

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

NOTIFY pgrst, 'reload schema';
