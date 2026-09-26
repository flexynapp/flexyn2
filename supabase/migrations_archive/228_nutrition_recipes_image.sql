-- 228_nutrition_recipes_image.sql
--
-- Adds an optional food image to user recipes. Stored as a public URL from
-- the 'uploads' storage bucket (same bucket stories/posts use). Shown on the
-- recipe cards in My Recipes + Discover and in the builder. Nullable — recipes
-- without a photo render a placeholder.

ALTER TABLE public.nutrition_recipes
  ADD COLUMN IF NOT EXISTS image_url TEXT;

NOTIFY pgrst, 'reload schema';
