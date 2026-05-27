-- 161_user_gender.sql
--
-- Capture biological sex so the app can calibrate per-sex. The codebase
-- already CONSUMES user_profiles.gender in three places:
--   • src/lib/realisticLimits.js   — strength-standard ceilings (anti-cheat)
--   • src/lib/workoutFatigue.js     — training-volume caps + set targets
--   • src/lib/nutritionDefaults.js  — Mifflin-St Jeor BMR / calorie goal
-- …but nothing ever WROTE the column, so it silently defaulted to 'male'
-- for every user. This adds the column so onboarding + Settings can persist
-- the user's choice. Stored values: 'male' | 'female' (NULL = unspecified,
-- which the consumers already treat as the 'male' default).
--
-- Paste-safe + idempotent.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS gender TEXT;

NOTIFY pgrst, 'reload schema';
