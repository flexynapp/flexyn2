-- 120_regimen_difficulty.sql
--
-- Add a difficulty tag to regimens so the community store can filter
-- by skill level. Three buckets matching the standard fitness app
-- vocabulary: beginner / intermediate / advanced. NULL = unrated
-- (the regimen creator didn't supply one) — old regimens stay
-- unaffected and the store shows them under "All".

ALTER TABLE public.regimens
  ADD COLUMN IF NOT EXISTS difficulty TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'regimens_difficulty_check'
  ) THEN
    ALTER TABLE public.regimens
      ADD CONSTRAINT regimens_difficulty_check
      CHECK (difficulty IS NULL
             OR difficulty IN ('beginner', 'intermediate', 'advanced'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
