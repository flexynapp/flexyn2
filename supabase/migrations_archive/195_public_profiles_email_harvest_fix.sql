-- 195_public_profiles_email_harvest_fix.sql
--
-- SECURITY FINDING (documented) + the resolve_profile_email helper.
--
-- The Supabase security advisor flagged public.public_profiles (a
-- SECURITY DEFINER view, anon-readable) as exposing `email` for every
-- user with no row filter: anyone with the client's public anon key can
-- `GET /rest/v1/public_profiles?select=email` and enumerate every user's
-- email address. Real PII-harvest vector, MEDIUM severity.
--
-- HOWEVER — email is NOT removable from this view without an
-- architectural refactor. The app uses email as its cross-user JOIN KEY:
-- ~10 modules (HubProfile, hubFollows, stories, crews, nemesis, bounties,
-- duels, PublicProfile) read profiles via `selectProfiles(...)` against
-- this view using `.in('email', <known emails>)` filters and `email`
-- selects to map results back. Dropping the column breaks all cross-user
-- profile resolution (a first attempt in this migration did exactly that
-- and had to be reverted). The DM/identity system is email-keyed
-- end-to-end (participant_emails, author_email, follower/followee_email).
--
-- Proper fix = migrate profile/DM resolution off email-as-identity onto
-- user_id, then this view never needs email and the harvest is
-- structurally impossible. That is a scoped refactor tracked for
-- post-launch — NOT a safe pre-launch change.
--
-- What this migration DOES land safely:
--   • Ensures `email` is present on the view (idempotent restore — a prior
--     revision removed it; this is the corrected end-state).
--   • Adds resolve_profile_email(p_id, p_username) — a narrow single-row
--     lookup used to shrink two email-select sites (App.jsx ProfileRedirect,
--     duels.js) onto a bounded RPC instead of a whole-view read. Not a
--     complete mitigation on its own (the view still carries email), but a
--     step toward the refactor and harmless in the meantime.
--
-- Paste-safe: single-table SELECTs, bare columns, no alias.column tokens.

DROP VIEW IF EXISTS public.public_profiles;

CREATE VIEW public.public_profiles AS
  SELECT
    id, email, username, full_name, avatar_url, bio, city, country_flag,
    website_url, is_private, created_at, last_active_at, total_xp,
    current_level, prestige_level, lifetime_xp, total_volume_lbs,
    total_distance_meters, achievements_unlocked_count, workout_streak,
    longest_workout_streak, league_tier, equipped_title_id,
    equipped_frame_id, signature_trophy, loot_theme_id, preferred_theme,
    trophy_case, trophy_case_visible, nemesis_opt_out, story_dms_disabled,
    default_story_privacy
  FROM public.user_profiles;

GRANT SELECT ON public.public_profiles TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.resolve_profile_email(
  p_id       UUID DEFAULT NULL,
  p_username TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT email
    FROM public.user_profiles
   WHERE (p_id IS NOT NULL AND id = p_id)
      OR (p_username IS NOT NULL AND username = p_username)
   LIMIT 1;
$$;

REVOKE ALL    ON FUNCTION public.resolve_profile_email(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_profile_email(UUID, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
