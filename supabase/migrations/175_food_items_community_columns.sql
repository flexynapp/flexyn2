-- Migration 175: community barcode food submissions (2026-06 audit fix)
--
-- The "Food Not Found → save for everyone" flow wrote nutrition/vitamins/
-- source payloads to columns that did not exist (silently stripped by the
-- entity layer's 42703 retry), and community rows were never readable by
-- other users (the only public-read policy required is_verified = true,
-- which no flow ever sets). Re-scans then logged 0-calorie meals.
--
-- This adds the missing columns and lets any authenticated user read
-- barcode-bearing community rows so a scanned barcode resolves for
-- everyone. The client writes BOTH the flat columns (calories/protein/...)
-- and the jsonb payload, so either reader path works.

ALTER TABLE public.food_items ADD COLUMN IF NOT EXISTS nutrition jsonb;
ALTER TABLE public.food_items ADD COLUMN IF NOT EXISTS vitamins  jsonb;
ALTER TABLE public.food_items ADD COLUMN IF NOT EXISTS source    text;

-- Community barcode database: any authenticated user may read a row that
-- carries a barcode, so a scan made by user A resolves for user B. Owner
-- full-access and verified-read policies from migration 001 remain.
DROP POLICY IF EXISTS "food_items: barcode community read" ON public.food_items;
CREATE POLICY "food_items: barcode community read"
  ON public.food_items FOR SELECT
  TO authenticated
  USING (barcode IS NOT NULL);

-- Speeds up barcode lookups (and the newest-row-wins community resolver).
CREATE INDEX IF NOT EXISTS food_items_barcode_idx
  ON public.food_items (barcode)
  WHERE barcode IS NOT NULL;

NOTIFY pgrst, 'reload schema';
