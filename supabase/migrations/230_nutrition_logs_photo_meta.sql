-- 230_nutrition_logs_photo_meta.sql
--
-- Persist the Photo-AI photo + recognition breakdown alongside the meal
-- log so a saved meal can be re-opened later showing the original image
-- and the full nutrient/ingredient detail.
--
--   image_url : public URL of the uploaded meal photo (Supabase storage,
--               `uploads` bucket). NULL for manual/barcode logs.
--   ai_meta   : JSONB side-car for data that has no dedicated column —
--               { portion_estimate, confidence, items[], notes, sugar_g,
--                 source }. The headline macros stay in their own numeric
--               columns; this only carries the extras.
--
-- Both columns are additive + nullable, so the write-path strip-and-retry
-- in src/api/db.js tolerates a host that hasn't applied this yet.

ALTER TABLE public.nutrition_logs
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS ai_meta   jsonb;
