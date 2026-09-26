-- 165_daily_flexyn_drop.sql
--
-- "Today's Flexyn Drop" — the daily-rotating branded merch on the
-- Marketplace. Three items rotate every 24 h, deterministically by
-- day-of-year so every user sees the same lineup. This migration:
--
--   1. Adds a `user_branded_items` table so we can track ownership
--      of stickers / titles / frames that aren't loot-capsule
--      contents.
--   2. Adds purchase_branded_item(p_sku) — server-owned price table,
--      atomic debit + grant, paste-safe (scalar SELECT INTO, no
--      dotted record access).
--
-- Idempotent. DROP POLICY IF EXISTS guards every CREATE POLICY.
-- Paste-safe per CLAUDE.md: bare columns + CTE-renamed join keys,
-- no 3-part schema.table.column, no %ROWTYPE record access.

-- ── Inventory table ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_branded_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email   TEXT NOT NULL,
  sku          TEXT NOT NULL,
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_user_branded_items_user_id
  ON public.user_branded_items (user_id);

ALTER TABLE public.user_branded_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "branded_items: read own" ON public.user_branded_items;
CREATE POLICY "branded_items: read own"
  ON public.user_branded_items FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.user_branded_items TO authenticated;


-- ── Purchase RPC ──────────────────────────────────────────────────
-- Server-owned price table inside the function body. Same paste-safe
-- rules as migration 031: scalar SELECT INTO, bare columns, no
-- record-field dotted access.

CREATE OR REPLACE FUNCTION public.purchase_branded_item(p_sku TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_email        TEXT := auth.email();
  v_price        INTEGER;
  v_balance      INTEGER;
  v_new_balance  INTEGER;
  v_already      INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  CASE p_sku
    -- Common (25)
    WHEN 'flx_dumbbell' THEN v_price := 25;
    WHEN 'flx_band'     THEN v_price := 25;
    WHEN 'flx_chalk'    THEN v_price := 25;
    WHEN 'flx_shoes'    THEN v_price := 25;
    WHEN 'flx_water'    THEN v_price := 25;
    WHEN 'flx_apple'    THEN v_price := 25;
    WHEN 'flx_egg'      THEN v_price := 25;
    WHEN 'flx_alarm'    THEN v_price := 25;
    WHEN 'flx_pencil'   THEN v_price := 25;
    WHEN 'flx_sweat'    THEN v_price := 25;
    -- Uncommon (50)
    WHEN 'flx_logo'     THEN v_price := 50;
    WHEN 'flx_day_one'  THEN v_price := 50;
    WHEN 'flx_keychain' THEN v_price := 50;
    WHEN 'flx_bottle'   THEN v_price := 50;
    WHEN 'flx_muscle'   THEN v_price := 50;
    WHEN 'flx_lightbolt' THEN v_price := 50;
    WHEN 'flx_target'   THEN v_price := 50;
    WHEN 'flx_med1'     THEN v_price := 50;
    WHEN 'flx_med2'     THEN v_price := 50;
    WHEN 'flx_med3'     THEN v_price := 50;
    -- Rare (80-120)
    WHEN 'flx_og'       THEN v_price := 120;
    WHEN 'flx_anvil'    THEN v_price := 80;
    WHEN 'flx_belt'     THEN v_price := 100;
    WHEN 'flx_swords'   THEN v_price := 100;
    WHEN 'flx_shield'   THEN v_price := 100;
    WHEN 'flx_rocket'   THEN v_price := 100;
    WHEN 'flx_diamond'  THEN v_price := 100;
    WHEN 'flx_runner'   THEN v_price := 100;
    -- Epic (200)
    WHEN 'flx_streak'   THEN v_price := 200;
    WHEN 'flx_dragon'   THEN v_price := 200;
    WHEN 'flx_eagle'    THEN v_price := 200;
    WHEN 'flx_galaxy'   THEN v_price := 200;
    WHEN 'flx_lion'     THEN v_price := 200;
    -- Legendary (400)
    WHEN 'flx_crown'    THEN v_price := 400;
    WHEN 'flx_trophy'   THEN v_price := 400;
    WHEN 'flx_radiance' THEN v_price := 400;
    WHEN 'flx_comet'    THEN v_price := 400;
    -- Animated (1000)
    WHEN 'flx_sparkles' THEN v_price := 1000;
    ELSE
      RAISE EXCEPTION 'unknown_sku: %', p_sku USING ERRCODE = '22023';
  END CASE;

  -- Refuse re-purchase of an already-owned branded item.
  SELECT COUNT(*) INTO v_already
    FROM public.user_branded_items
   WHERE user_id = v_uid
     AND sku = p_sku;
  IF v_already > 0 THEN
    RAISE EXCEPTION 'already_owned' USING ERRCODE = '22023';
  END IF;

  -- Lock the buyer's profile row; concurrent purchases serialize.
  SELECT COALESCE(flex_coins, 0) INTO v_balance
    FROM public.user_profiles
   WHERE id = v_uid
   FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'buyer_profile_not_found' USING ERRCODE = '22023';
  END IF;

  IF v_balance < v_price THEN
    RAISE EXCEPTION 'insufficient_coins: have %, need %', v_balance, v_price
      USING ERRCODE = '22023';
  END IF;

  v_new_balance := v_balance - v_price;
  UPDATE public.user_profiles
     SET flex_coins = v_new_balance
   WHERE id = v_uid;

  INSERT INTO public.user_branded_items (user_id, user_email, sku)
  VALUES (v_uid, v_email, p_sku);

  RETURN jsonb_build_object(
    'success',     true,
    'sku',         p_sku,
    'price',       v_price,
    'new_balance', v_new_balance
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.purchase_branded_item(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
