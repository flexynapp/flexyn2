-- 190_weekly_rate_lbs.sql
-- Adds user_profiles.weekly_rate_lbs — the explicit weekly weight-change
-- rate (lbs/week; negative = loss, positive = gain).
--
-- This closes an orphaned column reference: NutritionOnboardingModal has
-- always written this value (the pace derived from target weight + date),
-- and src/lib/nutritionDefaults.js reads it ("prefer explicit
-- weekly_rate_lbs if stored") to drive the calorie target — but no
-- migration ever created the column. So the write was silently stripped by
-- updateMe's missing-column retry and the read always fell back to
-- recomputing from target_weight_lbs + target_date. Persisting the value
-- makes the stored pace authoritative and stops the drift between the two
-- code paths.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS weekly_rate_lbs NUMERIC;

NOTIFY pgrst, 'reload schema';
