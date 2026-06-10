-- Migration 182: public_profiles view — whitelisted cross-user profile reads
--
-- C19 (2026-06 audit): user_profiles is world-readable via `USING (true)`
-- (mig 001 "Public profiles are readable by all") and the client read it
-- with select('*'), shipping every user's email AND sensitive fields
-- (notification_prefs, quiet hours, fitness_assessment, cycle_tracking_
-- enabled, weight/height/age, push subs) to every client — a GDPR breach
-- class for a social app.
--
-- This creates a view exposing ONLY the columns cross-user surfaces
-- actually consume (traced from real property accesses: feeds,
-- leaderboards, search, crews, nemesis, duels, stories, public profiles).
-- The view runs with its owner's privileges (security_invoker off), so it
-- bypasses the base-table RLS and returns the safe columns for every row,
-- while the base table itself is locked down to owner-only in migration
-- 183 (STAGED — run after the frontend that reads this view is deployed).
--
-- Sensitive columns deliberately EXCLUDED: notification_prefs,
-- quiet_hours_*, fitness_assessment, cycle_*, calorie_cycling, timezone_*,
-- push fields, weight_lbs/height_inches/age/gender/birthday, flex_coins,
-- login_streak, streak_freezes_available, prestige_dismissed.
--
-- NOTE: email is included because it is still the app's cross-user join
-- key (migrating that to user_id is a separate follow-up). Until then,
-- username→email remains resolvable through this view.

DROP VIEW IF EXISTS public.public_profiles;

CREATE VIEW public.public_profiles AS
SELECT
  -- identity / display
  id,
  email,
  username,
  full_name,
  avatar_url,
  bio,
  city,
  country_flag,
  website_url,
  is_private,
  created_at,
  last_active_at,
  -- progression / stats
  total_xp,
  current_level,
  prestige_level,
  lifetime_xp,
  total_volume_lbs,
  total_distance_meters,
  achievements_unlocked_count,
  workout_streak,
  longest_workout_streak,
  league_tier,
  -- cosmetics
  equipped_title_id,
  equipped_frame_id,
  signature_trophy,
  loot_theme_id,
  preferred_theme,
  trophy_case,
  trophy_case_visible,
  -- feature-gating preferences (read cross-user by stories/nemesis logic)
  nemesis_opt_out,
  story_dms_disabled,
  default_story_privacy
FROM public.user_profiles;

-- Readable by everyone (anon visitors hit it for public profiles/onboarding
-- username checks; authenticated for feeds/leaderboards/search).
GRANT SELECT ON public.public_profiles TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
