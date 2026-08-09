-- 315_public_profiles_row_rules.sql
--
-- Put the profile privacy rules in the database, where they are enforced,
-- instead of in the client, where they are decoration.
--
-- ─── What this is answering ──────────────────────────────────────────────
--
-- After 313 the advisor flags public_profiles as a SECURITY DEFINER view,
-- CRITICAL. That rating is earned. A definer view ignores the base table's
-- RLS, and user_profiles HAS row-level rules the product cares about:
--
--   • is_private        — src/lib/privacy.js canViewProfile(): a private
--                         account's content is for followers only.
--   • hide_from_search  — filterSearchable(): keep an account out of search
--                         and People You May Know.
--
-- Both were being applied in JavaScript to rows the server had already
-- sent. Anyone with the network tab open saw every private profile. The
-- lint was pointing at a real hole, not at a style preference.
--
-- hide_from_search was worse than unenforced: it is not in the view's
-- column list at all, so filterSearchable() read undefined on every row and
-- passed everyone through. It is added below.
--
-- ─── Why the view stays SECURITY DEFINER ─────────────────────────────────
--
-- The obvious fix — invoker view + a permissive SELECT policy + column
-- GRANTs — cannot express this. Column privileges are per ROLE, not per
-- row, and a user needs every column of their OWN row (weight, goals,
-- onboarding state, notification prefs, pity counters). A policy that lets
-- authenticated read other rows would expose those columns on every row
-- too. RLS gives row filtering; GRANTs give column filtering; nothing gives
-- "these columns for others, all columns for me" except a projection that
-- runs above RLS. That is this view.
--
-- So the advisor entry will remain, and it should be accepted with this
-- migration as the reason. What changes is that the warning is no longer
-- describing an open door: the rules moved INTO the view.
--
-- The only way to silence the lint outright is to serve profiles from a
-- SECURITY DEFINER function instead (the pattern the leaderboards already
-- use). That is the same bypass wearing a different hat, and it costs a
-- rewrite of every caller, because selectProfiles() hands callers a
-- PostgREST query builder and an RPC cannot take one. Not worth it for a
-- lint; worth revisiting if profile reads ever need server-side paging.
--
-- ─── The rules, and what they deliberately do not do ─────────────────────
--
-- A private profile is not HIDDEN, it is REDUCED: identity columns stay so
-- the account is still findable, follow-able and renderable in a feed, and
-- every stat is NULL. That matches canViewProfile(), which gates the
-- profile BODY rather than the account's existence — making them vanish
-- would change the product, not just enforce it.
--
-- Blocked is different and is a hard filter: if you have blocked someone,
-- their row is gone from this view for you.

BEGIN;

-- Correlated subqueries get hoisted into a helper so the view body stays
-- bare columns and public.fn() calls — the clipboard rule in CLAUDE.md, and
-- it keeps the view readable.
CREATE OR REPLACE FUNCTION public.viewer_follows(p_target_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.hub_follows
     WHERE lower(follower_email) = lower(public.current_user_email())
       AND lower(followee_email) = lower(p_target_email)
  );
$fn$;

REVOKE ALL ON FUNCTION public.viewer_follows(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.viewer_follows(TEXT) TO authenticated;

-- Recreated with the same column ORDER and names as before plus
-- hide_from_search at the end, so existing `select('id, username, ...')`
-- calls are unaffected.
--
-- The visibility flag is computed ONCE PER ROW in a subquery rather than
-- inline in each CASE. Inline, viewer_follows() ran per masked column —
-- fifteen correlated lookups per row, and users.list() fetches up to 1000
-- rows. The subquery also keeps every token bare (no alias.column), which
-- is what the paste rule in CLAUDE.md needs.
--
-- `SELECT *` inside is deliberate: the outer list is explicit, so email
-- never reaches the output, and a column added to user_profiles later
-- lands in the subquery harmlessly instead of erroring.
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT
  id,
  username,
  full_name,
  avatar_url,
  CASE WHEN full_view THEN bio END                          AS bio,
  CASE WHEN full_view THEN city END                         AS city,
  country_flag,
  CASE WHEN full_view THEN website_url END                  AS website_url,
  is_private,
  created_at,
  CASE WHEN full_view THEN last_active_at END               AS last_active_at,
  CASE WHEN full_view THEN total_xp END                     AS total_xp,
  CASE WHEN full_view THEN current_level END                AS current_level,
  CASE WHEN full_view THEN prestige_level END               AS prestige_level,
  CASE WHEN full_view THEN lifetime_xp END                  AS lifetime_xp,
  CASE WHEN full_view THEN total_volume_lbs END             AS total_volume_lbs,
  CASE WHEN full_view THEN total_distance_meters END        AS total_distance_meters,
  CASE WHEN full_view THEN achievements_unlocked_count END  AS achievements_unlocked_count,
  CASE WHEN full_view THEN workout_streak END               AS workout_streak,
  CASE WHEN full_view THEN longest_workout_streak END       AS longest_workout_streak,
  CASE WHEN full_view THEN league_tier END                  AS league_tier,
  equipped_title_id,
  equipped_frame_id,
  signature_trophy,
  loot_theme_id,
  preferred_theme,
  CASE WHEN full_view THEN trophy_case END                  AS trophy_case,
  trophy_case_visible,
  nemesis_opt_out,
  story_dms_disabled,
  default_story_privacy,
  -- New. filterSearchable() has been reading this off every row and getting
  -- undefined since the view was created, so the flag has never once kept
  -- anyone out of search.
  hide_from_search
FROM (
  SELECT *,
         (NOT is_private
          OR id = auth.uid()
          OR public.viewer_follows(email)) AS full_view
    FROM public.user_profiles
   -- Hard filter, not a reduction: someone you blocked does not appear.
   WHERE NOT public.viewer_is_blocked_by(email)
) AS visible_profiles;

-- CREATE OR REPLACE VIEW keeps existing grants and reloptions, but state
-- them rather than trusting that: read-only, authenticated only.
ALTER VIEW public.public_profiles SET (security_invoker = false);
REVOKE ALL ON public.public_profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.public_profiles FROM authenticated;
GRANT SELECT ON public.public_profiles TO authenticated;

COMMIT;

-- Verification — run as a real user, not as postgres, or it proves nothing:
--
--   BEGIN;
--   SET LOCAL role authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<uid>","role":"authenticated"}';
--   SELECT count(*) FROM public.public_profiles;              -- all non-blocked
--   SELECT count(*) FROM public.public_profiles
--    WHERE is_private AND total_xp IS NOT NULL AND id <> '<uid>';  -- expect 0
--   ROLLBACK;
