-- 057_prestige.sql
-- Prestige System: max-level reset with permanent status symbols.

DO $$
BEGIN
  -- prestige_level: 0 = not yet prestiged, 1-10 = prestige tier
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'prestige_level'
  ) THEN
    ALTER TABLE public.user_profiles ADD COLUMN prestige_level INT NOT NULL DEFAULT 0;
  END IF;

  -- lifetime_xp: never resets, increments alongside total_xp
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'lifetime_xp'
  ) THEN
    ALTER TABLE public.user_profiles ADD COLUMN lifetime_xp INT NOT NULL DEFAULT 0;
  END IF;

  -- prestiged_at: array of timestamps, one per prestige event
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'prestiged_at'
  ) THEN
    ALTER TABLE public.user_profiles ADD COLUMN prestiged_at TIMESTAMPTZ[] NOT NULL DEFAULT '{}';
  END IF;

  -- prestige_dismissed: tracks if the user dismissed the prompt without prestiging
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'prestige_dismissed'
  ) THEN
    ALTER TABLE public.user_profiles ADD COLUMN prestige_dismissed BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

-- Sync lifetime_xp for existing users who already have total_xp
-- (safe to run multiple times — only updates rows where lifetime_xp = 0 and total_xp > 0)
UPDATE public.user_profiles
SET lifetime_xp = total_xp
WHERE lifetime_xp = 0 AND total_xp > 0;

-- Function: perform a prestige reset atomically
CREATE OR REPLACE FUNCTION public.perform_prestige(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile   RECORD;
  v_new_level INT;
  v_coins     INT;
BEGIN
  SELECT prestige_level, total_xp INTO v_profile
  FROM public.user_profiles
  WHERE id = p_user_id;

  IF v_profile IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user not found');
  END IF;

  IF v_profile.prestige_level >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'max prestige reached');
  END IF;

  v_new_level := v_profile.prestige_level + 1;

  -- Coin reward scales with tier: 500 * tier
  v_coins := v_new_level * 500;

  UPDATE public.user_profiles
  SET
    prestige_level    = v_new_level,
    total_xp          = 0,           -- reset current XP
    current_level     = 1,           -- reset display level
    prestige_dismissed = FALSE,
    prestiged_at      = array_append(COALESCE(prestiged_at, '{}'), NOW()),
    flex_coins        = COALESCE(flex_coins, 0) + v_coins
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'ok',           true,
    'prestige_level', v_new_level,
    'coins_awarded',  v_coins
  );
END;
$$;
