-- 220_public_profiles_drop_email.sql
--
-- FINAL step of the email→id migration: drop the `email` column from the
-- public_profiles view. Every client read of another user's email now goes
-- through user_id (or the narrow resolve_profile_email RPC for the handful
-- of server-side lookups that still need it), so the view no longer needs
-- to expose email — closing the authenticated-user email-harvest surface.
--
-- Preconditions verified before shipping: a full grep of src/ found ZERO
-- reads of email off public_profiles / selectProfiles / User.list(). Every
-- consumer (crews, DMs, stories, follows, recommendations, PYMK, search,
-- composer, HubProfile) was migrated to user_id across the phased rollout.
-- lint + build + 1286 tests are green on the client that ships alongside
-- this migration.
--
-- CREATE OR REPLACE VIEW cannot DROP a column, so this is DROP + CREATE.
-- The recreated view is identical to migration 195 minus `email`. No object
-- depends on public_profiles.email (the RPCs read user_profiles directly),
-- so the DROP is clean without CASCADE.
--
-- Grants are re-asserted explicitly. anon is deliberately NOT granted:
-- migration 207 revoked anon SELECT, but the grant had drifted back to
-- anon — this restores the intended no-anon posture. SELECT goes to
-- authenticated + service_role only.
--
-- DEPLOY ORDER (important): run this ONLY AFTER the matching client is live
-- (Netlify auto-deploys from main). The pre-phase-10 client still reads
-- email off this view; running the drop before that client is replaced
-- would break HubProfile / recommendations / story replies on the old
-- bundle. New client first, then this SQL.

DROP VIEW IF EXISTS public.public_profiles;

CREATE VIEW public.public_profiles AS
  SELECT
    id, username, full_name, avatar_url, bio, city, country_flag,
    website_url, is_private, created_at, last_active_at, total_xp,
    current_level, prestige_level, lifetime_xp, total_volume_lbs,
    total_distance_meters, achievements_unlocked_count, workout_streak,
    longest_workout_streak, league_tier, equipped_title_id,
    equipped_frame_id, signature_trophy, loot_theme_id, preferred_theme,
    trophy_case, trophy_case_visible, nemesis_opt_out, story_dms_disabled,
    default_story_privacy
  FROM public.user_profiles;

REVOKE ALL ON public.public_profiles FROM PUBLIC;
REVOKE ALL ON public.public_profiles FROM anon;
GRANT SELECT ON public.public_profiles TO authenticated;
GRANT SELECT ON public.public_profiles TO service_role;

NOTIFY pgrst, 'reload schema';
