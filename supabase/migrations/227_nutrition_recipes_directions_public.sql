-- 227_nutrition_recipes_directions_public.sql
--
-- Finishes the recipes feature (builds on mig 123):
--
--   • directions      — freeform prep steps for the recipe.
--   • micros          — recipe-level custom nutrients (vitamins, minerals,
--                       fiber, sodium, or any user-defined value). JSONB
--                       array of { key, label, amount, unit } so users can
--                       record ANY nutritional value, not just P/C/F.
--   • is_public       — the recipe is published to the community "Discover"
--                       feed. Owner-toggled, opt-in, default private.
--   • author_username — display name snapshot at publish time, so Discover
--                       never has to expose user_email (privacy) or join.
--   • published_at    — when it was shared; drives the Discover ordering.
--
-- A new SELECT policy lets any authenticated user read published recipes
-- (owner read + write policies from mig 123 are unchanged; they OR with
-- this one, so writes stay owner-only). Per-ingredient measurement units
-- live inside the existing ingredients JSONB and need no schema change.

ALTER TABLE public.nutrition_recipes
  ADD COLUMN IF NOT EXISTS directions      TEXT,
  ADD COLUMN IF NOT EXISTS micros          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_public       BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS author_username TEXT,
  ADD COLUMN IF NOT EXISTS published_at    TIMESTAMPTZ;

-- Partial index — the Discover feed only ever reads published rows.
CREATE INDEX IF NOT EXISTS idx_nutrition_recipes_public
  ON public.nutrition_recipes(published_at DESC)
  WHERE is_public = TRUE;

-- Any authenticated user may read a published recipe. This is additive to
-- the mig-123 owner-read policy (Postgres ORs permissive policies), so a
-- user sees their own recipes plus everyone's public ones.
DROP POLICY IF EXISTS "nutrition_recipes: public read" ON public.nutrition_recipes;
CREATE POLICY "nutrition_recipes: public read"
  ON public.nutrition_recipes FOR SELECT
  TO authenticated USING (is_public = TRUE);

NOTIFY pgrst, 'reload schema';
