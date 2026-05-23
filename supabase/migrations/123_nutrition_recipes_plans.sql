-- 123_nutrition_recipes_plans.sql
--
-- Three additive nutrition features:
--
--   • nutrition_recipes — user-built multi-ingredient meals saved
--     as a single loggable item. "My chicken rice bowl = 200g chicken
--     + 150g rice + 30g sauce" → one tap to log all macros.
--   • meal_plans — planned future meals (date + meal_type + recipe
--     id or freeform food row). Drives the meal planner + grocery
--     list generation.
--   • user_profiles.calorie_cycling — per-day-type macro overrides
--     ({"training": 2600, "rest": 2200}). NutritionPlansModal already
--     ships training/rest variants; this stores the user's chosen
--     deltas so dashboard widgets can render the right goal today.
--
-- All RLS owner-only. No FK on recipe_id in meal_plans (recipes can
-- be deleted; the plan row's freeform food_snapshot survives).

-- ─── Recipes ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nutrition_recipes (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email   TEXT         NOT NULL,
  name         TEXT         NOT NULL,
  servings     NUMERIC      NOT NULL DEFAULT 1,
  -- Ingredients are a JSONB array of { name, grams, calories, protein,
  -- carbs, fat, fiber, sugar } objects. We don't normalize into a
  -- separate table — recipes are leaf data, the user doesn't query
  -- across them. JSONB is cheaper.
  ingredients  JSONB        NOT NULL DEFAULT '[]'::jsonb,
  totals       JSONB        NOT NULL DEFAULT '{}'::jsonb,  -- summed macros
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nutrition_recipes_user
  ON public.nutrition_recipes(user_id, created_at DESC);

ALTER TABLE public.nutrition_recipes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nutrition_recipes: owner read" ON public.nutrition_recipes;
CREATE POLICY "nutrition_recipes: owner read"
  ON public.nutrition_recipes FOR SELECT
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "nutrition_recipes: owner write" ON public.nutrition_recipes;
CREATE POLICY "nutrition_recipes: owner write"
  ON public.nutrition_recipes FOR ALL
  TO authenticated USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nutrition_recipes TO authenticated;

-- ─── Meal plans ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meal_plans (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email   TEXT         NOT NULL,
  plan_date    DATE         NOT NULL,
  meal_type    TEXT         NOT NULL DEFAULT 'snack',
  -- Either a recipe reference (recipe_id, no FK so deletions don't
  -- nuke the plan) OR an ad-hoc food entry stored in food_snapshot.
  recipe_id    UUID,
  food_snapshot JSONB,
  notes        TEXT,
  is_completed BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meal_plans_user_date
  ON public.meal_plans(user_id, plan_date);

ALTER TABLE public.meal_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meal_plans: owner read" ON public.meal_plans;
CREATE POLICY "meal_plans: owner read"
  ON public.meal_plans FOR SELECT
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "meal_plans: owner write" ON public.meal_plans;
CREATE POLICY "meal_plans: owner write"
  ON public.meal_plans FOR ALL
  TO authenticated USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meal_plans TO authenticated;

-- ─── Calorie cycling ──────────────────────────────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS calorie_cycling JSONB DEFAULT NULL;

NOTIFY pgrst, 'reload schema';
