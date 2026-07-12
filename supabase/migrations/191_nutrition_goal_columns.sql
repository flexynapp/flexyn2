-- 191_nutrition_goal_columns.sql
-- Adds the five user_profiles columns the nutrition-goal onboarding
-- (src/components/nutrition/NutritionOnboardingModal.jsx) has always
-- written but no migration ever created:
--
--   nutrition_goal        'lose' | 'maintain' | 'gain'
--   activity_level        'sedentary' | 'light' | 'moderate' | 'very' | 'extra'
--   target_weight_lbs     goal weight (lbs)
--   target_date           goal date
--   dietary_restrictions  array of restriction keys
--
-- Same orphaned-column class migration 190 fixed for weekly_rate_lbs.
-- Because these columns didn't exist, updateMe's missing-column
-- strip-and-retry silently dropped them on every save, so:
--   • src/lib/nutritionDefaults.js `if (!userProfile.nutrition_goal)`
--     always took the default branch — the user's goal / activity /
--     target never influenced the calorie & macro targets (the app
--     showed the generic default instead of the value the modal just
--     computed and previewed).
--   • src/lib/nutritionPlans.js loadRestrictions() always fell back to
--     localStorage — restrictions never followed the user across devices.
--   • src/components/dashboard/HeroSlideshow.jsx weight-goal slide read
--     an always-undefined target_weight_lbs / target_date.
--
-- These are plain user preferences (not privileged stat columns), so the
-- mig 142 / 173 privileged-column trigger does not guard them — no trigger
-- change is needed. dietary_restrictions is JSONB because the client
-- reads it with Array.isArray() (nutritionPlans.js) and writes a JS array.
--
-- Paste-safe per repo convention: single-table ALTER, bare column names,
-- no alias.column / record-dotted tokens.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS nutrition_goal       TEXT,
  ADD COLUMN IF NOT EXISTS activity_level       TEXT,
  ADD COLUMN IF NOT EXISTS target_weight_lbs    NUMERIC,
  ADD COLUMN IF NOT EXISTS target_date          DATE,
  ADD COLUMN IF NOT EXISTS dietary_restrictions JSONB;

NOTIFY pgrst, 'reload schema';
