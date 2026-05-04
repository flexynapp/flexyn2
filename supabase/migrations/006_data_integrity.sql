-- ============================================================
-- Migration 006 — Data integrity fixes
-- Fixes: nutrition_logs (16 missing macro/micro/vitamin cols),
--        workout_logs (regimen_id, regimen_name, duration_minutes),
--        user_profiles (fitness_goals text[]),
--        increment_user_xp RPC (now also updates current_level),
--        cross-user copy_count increment for regimens/templates
-- ============================================================

-- ── nutrition_logs — add correctly-named macro/micro/vitamin columns ──────
ALTER TABLE public.nutrition_logs
  ADD COLUMN IF NOT EXISTS protein_g       numeric,
  ADD COLUMN IF NOT EXISTS carbs_g         numeric,
  ADD COLUMN IF NOT EXISTS fat_g           numeric,
  ADD COLUMN IF NOT EXISTS fiber_g         numeric,
  ADD COLUMN IF NOT EXISTS sodium_mg       numeric,
  ADD COLUMN IF NOT EXISTS sugar_g         numeric,
  ADD COLUMN IF NOT EXISTS cholesterol_mg  numeric,
  ADD COLUMN IF NOT EXISTS iron_mg         numeric,
  ADD COLUMN IF NOT EXISTS magnesium_mg    numeric,
  ADD COLUMN IF NOT EXISTS calcium_mg      numeric,
  ADD COLUMN IF NOT EXISTS potassium_mg    numeric,
  ADD COLUMN IF NOT EXISTS vitamin_a_iu    numeric,
  ADD COLUMN IF NOT EXISTS vitamin_c_mg    numeric,
  ADD COLUMN IF NOT EXISTS vitamin_d_iu    numeric,
  ADD COLUMN IF NOT EXISTS vitamin_b12_mcg numeric,
  ADD COLUMN IF NOT EXISTS water_oz        numeric DEFAULT 0;

-- Back-fill from old un-suffixed columns where new ones are null
UPDATE public.nutrition_logs SET
  protein_g  = protein  WHERE protein_g  IS NULL AND protein  IS NOT NULL;
UPDATE public.nutrition_logs SET
  carbs_g    = carbs    WHERE carbs_g    IS NULL AND carbs    IS NOT NULL;
UPDATE public.nutrition_logs SET
  fat_g      = fat      WHERE fat_g      IS NULL AND fat      IS NOT NULL;
UPDATE public.nutrition_logs SET
  fiber_g    = fiber    WHERE fiber_g    IS NULL AND fiber    IS NOT NULL;
UPDATE public.nutrition_logs SET
  sodium_mg  = sodium   WHERE sodium_mg  IS NULL AND sodium   IS NOT NULL;

-- ── workout_logs — add regimen attribution + duration ─────────────────────
ALTER TABLE public.workout_logs
  ADD COLUMN IF NOT EXISTS regimen_id      uuid,
  ADD COLUMN IF NOT EXISTS regimen_name    text,
  ADD COLUMN IF NOT EXISTS duration_minutes integer;

-- ── user_profiles — fix fitness_goals to array type ───────────────────────
-- Safe rename: add a new array column, copy existing text data, keep old
-- text column for backwards-compat reads.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS fitness_goals_arr text[];

-- Back-fill: split existing comma-separated strings into arrays
UPDATE public.user_profiles
  SET fitness_goals_arr = string_to_array(fitness_goals, ',')
  WHERE fitness_goals IS NOT NULL
    AND fitness_goals_arr IS NULL
    AND fitness_goals != '';

-- ── increment_user_xp RPC — also updates current_level ───────────────────
CREATE OR REPLACE FUNCTION public.increment_user_xp(p_user_id uuid, p_xp integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_total_xp  integer;
  v_level     integer := 1;
  v_cumulative integer := 0;
  v_xp_needed integer;
  v_base      integer := 250;
  v_mult      numeric;
BEGIN
  -- Atomic XP increment
  UPDATE public.user_profiles
    SET total_xp = COALESCE(total_xp, 0) + p_xp,
        updated_at = now()
    WHERE id = p_user_id
    RETURNING total_xp INTO v_total_xp;

  IF NOT FOUND THEN RETURN; END IF;

  -- Client-matching level calc (mirrors xpSystem.js)
  FOR i IN 1..99 LOOP
    IF i <= 10 THEN v_mult := 1.10;
    ELSIF i <= 30 THEN v_mult := 1.13;
    ELSIF i <= 60 THEN v_mult := 1.16;
    ELSE v_mult := 1.20;
    END IF;
    v_xp_needed := FLOOR(250 * POWER(v_mult, i - 1));
    IF v_cumulative + v_xp_needed > v_total_xp THEN
      v_level := i;
      EXIT;
    END IF;
    v_cumulative := v_cumulative + v_xp_needed;
    v_level := i + 1;
  END LOOP;

  UPDATE public.user_profiles
    SET current_level = v_level
    WHERE id = p_user_id;
END;
$$;

-- ── Cross-user copy_count increment (security-definer bypasses RLS) ───────
CREATE OR REPLACE FUNCTION public.increment_copy_count(
  p_table text,
  p_id    uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_table = 'regimens' THEN
    UPDATE public.regimens SET copy_count = COALESCE(copy_count, 0) + 1 WHERE id = p_id;
  ELSIF p_table = 'workout_templates' THEN
    UPDATE public.workout_templates SET copy_count = COALESCE(copy_count, 0) + 1 WHERE id = p_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_copy_count(text, uuid) TO authenticated;

-- ── Re-grant for new columns ──────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;
