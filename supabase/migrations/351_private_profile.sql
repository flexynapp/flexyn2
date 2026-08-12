-- 351_private_profile.sql
--
-- Makes "private profile" mean something at the DATABASE, and moves the bio
-- out of what privacy hides.
--
-- ── What was actually private before this ──────────────────────────────────
--
-- `is_private` already existed and `public_profiles` already gated the stats
-- behind it. That part worked. Everything else Sean listed did not:
--
--   • hub_follows  SELECT was `USING (true)` — the entire follow graph was
--     readable by any signed-in user, so follower and following counts were
--     wide open no matter what the profile flag said.
--   • user_trophies SELECT was `USING (true)` — same for badges.
--   • hub_posts served every `privacy = 'public'` row to every authenticated
--     reader, so a private account's posts and post count stayed visible.
--
-- Hiding those three in the client would have been theatre: they are ordinary
-- PostgREST tables and anyone can read them with curl. So the gate goes here.
--
-- ── Bio moves OUT of the gate ──────────────────────────────────────────────
--
-- The existing view hides bio along with the stats. Sean's spec is the
-- opposite — "they should not be able to see any information besides your
-- bio" — and he is right: a private profile still has to be recognisable
-- enough to follow, which is why username, display name and avatar were
-- already exempt. The bio belongs with them. Privacy here is about your
-- ACTIVITY, not about whether anyone can tell who you are.
--
-- ── Why this is a no-op on today's data ────────────────────────────────────
--
-- 0 of 57 profiles are private, so `viewer_can_see_activity` returns true for
-- every row that exists and nothing changes for anyone. That also means the
-- new branch has NEVER executed, so it cannot be verified against live data —
-- it has to be tested against seeded private profiles, which is what the
-- verification block at the foot of this file does.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. The gate, as one function
-- ───────────────────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER because it reads `user_profiles.is_private`, and RLS on
-- that table restricts a caller to their own row — an invoker-rights version
-- would answer "not private" for everyone else, which fails open.
--
-- It takes an EMAIL rather than a uuid because every table it gates is
-- email-keyed (author_email, follower_email, followee_email), and because the
-- two helpers it composes with already key that way.
--
-- No recursion risk with hub_follows' new policy: `viewer_follows` is itself
-- SECURITY DEFINER, so it reads the follow table with RLS bypassed rather
-- than re-entering the policy that calls it.

CREATE OR REPLACE FUNCTION public.viewer_can_see_activity(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (
      SELECT NOT is_private
          OR id = (SELECT auth.uid())
          OR public.viewer_follows(p_email)
        FROM public.user_profiles
       WHERE lower(email) = lower(p_email)
       LIMIT 1
    ),
    -- No profile row for that email. Rows whose owner we cannot identify are
    -- shown, matching every pre-existing policy here: this function exists to
    -- ADD a restriction for private accounts, not to become a second, silent
    -- visibility rule for orphaned data.
    TRUE
  );
$$;

-- `authenticated` MUST hold EXECUTE, and that is not an oversight.
--
-- A policy's expression runs as the invoking role, so revoking EXECUTE from
-- `authenticated` does not harden the gate — it makes every SELECT on the
-- three tables below fail outright with 42501. (Measured: that is exactly what
-- happened on the first attempt at this migration.)
--
-- Safe to expose, for the reason `is_blocked` is NOT: that function takes the
-- VIEWER as a parameter, so publishing it lets anyone ask about pairs they are
-- not half of. This one takes only the subject and reads the viewer from
-- `auth.uid()`, so the most it can answer is "is this account private?" —
-- which `public_profiles.is_private` already tells any authenticated caller.
-- Same posture as `viewer_follows` and `viewer_is_blocked_by`, both of which
-- are called directly from policies today.
--
-- anon still gets nothing: it has no read on any of these tables anyway, and
-- a function it cannot use is one less endpoint on the surface.
REVOKE ALL ON FUNCTION public.viewer_can_see_activity(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.viewer_can_see_activity(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.viewer_can_see_activity(TEXT) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. The follow graph
-- ───────────────────────────────────────────────────────────────────────────
--
-- Gated on BOTH sides. A row is one relationship and it appears in two lists —
-- it is in X's followers and in Y's following — so leaving either end open
-- leaks the other end's list by reading it from the far side.
--
-- The cost is that a public account's "following" list omits the private
-- accounts it follows. That is correct rather than a compromise: the row
-- exists to say a private person has a follower, and showing it from the
-- public side reveals exactly the fact the private side is hiding.

DROP POLICY IF EXISTS "hub_follows: public read" ON public.hub_follows;
CREATE POLICY "hub_follows: public read" ON public.hub_follows
  FOR SELECT TO authenticated
  USING (
    public.viewer_can_see_activity(follower_email)
    AND public.viewer_can_see_activity(followee_email)
  );

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Badges
-- ───────────────────────────────────────────────────────────────────────────
--
-- `user_trophies` is keyed by user_id with user_email denormalised alongside,
-- and rows granted to guests carry created_by = '' (migration 189), so the
-- email can be absent. Fall back to the uuid rather than hiding the row: a
-- trophy whose owner cannot be resolved is not evidence of a private account.

DROP POLICY IF EXISTS "trophies: read all" ON public.user_trophies;
CREATE POLICY "trophies: read all" ON public.user_trophies
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.viewer_can_see_activity(
         COALESCE(user_email, (SELECT email FROM public.user_profiles WHERE id = user_id))
       )
  );

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Posts
-- ───────────────────────────────────────────────────────────────────────────
--
-- The existing expression is preserved clause for clause, with one conjunct
-- added to the third branch. Restated in full rather than patched, because
-- Postgres has no way to append to a USING clause — which is exactly why it
-- is copied from `pg_policies` on the live database rather than from the
-- migration that created it (CLAUDE.md: read the installed artefact).
--
-- The `followers` sub-branch already requires viewer_follows, which implies
-- the new condition, so in practice this only tightens `privacy = 'public'`.
-- It is applied to the whole branch anyway: a future privacy value added
-- there would otherwise inherit an exemption nobody meant to grant.

DROP POLICY IF EXISTS "hub_posts: privacy and blocking read" ON public.hub_posts;
CREATE POLICY "hub_posts: privacy and blocking read" ON public.hub_posts
  FOR SELECT TO authenticated
  USING (
    author_email = (SELECT NULLIF(public.current_user_email(), ''))
    OR user_id = (SELECT auth.uid())
    OR (
      (publish_at IS NULL OR publish_at <= now())
      AND NOT public.viewer_is_blocked_by(author_email)
      AND public.viewer_can_see_activity(author_email)
      AND (
        privacy = 'public'
        OR (
          privacy = 'followers'
          AND (SELECT NULLIF(public.current_user_email(), '')) IS NOT NULL
          AND public.viewer_follows(author_email)
        )
      )
    )
  );

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Bio becomes visible on a private profile
-- ───────────────────────────────────────────────────────────────────────────
--
-- Only the `bio` expression changes; every other column keeps its exact
-- position and type, so CREATE OR REPLACE VIEW accepts it. Do NOT reorder
-- anything here — a DROP would cascade through every object selecting from
-- this view, and `security_invoker` must stay OFF (see CLAUDE.md: flipping it
-- makes the view return only your own row and blanks every profile page,
-- leaderboard join and follow suggestion in the app).

CREATE OR REPLACE VIEW public.public_profiles AS
SELECT
  id,
  username,
  full_name,
  avatar_url,
  bio,
  CASE WHEN full_view THEN city ELSE NULL::text END AS city,
  country_flag,
  CASE WHEN full_view THEN website_url ELSE NULL::text END AS website_url,
  is_private,
  created_at,
  CASE WHEN full_view THEN last_active_at ELSE NULL::timestamptz END AS last_active_at,
  CASE WHEN full_view THEN total_xp ELSE NULL::integer END AS total_xp,
  CASE WHEN full_view THEN current_level ELSE NULL::integer END AS current_level,
  CASE WHEN full_view THEN prestige_level ELSE NULL::integer END AS prestige_level,
  CASE WHEN full_view THEN lifetime_xp ELSE NULL::integer END AS lifetime_xp,
  CASE WHEN full_view THEN total_volume_lbs ELSE NULL::numeric END AS total_volume_lbs,
  CASE WHEN full_view THEN total_distance_meters ELSE NULL::numeric END AS total_distance_meters,
  CASE WHEN full_view THEN achievements_unlocked_count ELSE NULL::integer END AS achievements_unlocked_count,
  CASE WHEN full_view THEN workout_streak ELSE NULL::integer END AS workout_streak,
  CASE WHEN full_view THEN longest_workout_streak ELSE NULL::integer END AS longest_workout_streak,
  CASE WHEN full_view THEN league_tier ELSE NULL::text END AS league_tier,
  equipped_title_id,
  equipped_frame_id,
  signature_trophy,
  loot_theme_id,
  preferred_theme,
  CASE WHEN full_view THEN trophy_case ELSE NULL::jsonb END AS trophy_case,
  trophy_case_visible,
  nemesis_opt_out,
  story_dms_disabled,
  default_story_privacy,
  hide_from_search,
  display_name
FROM (
  SELECT
    *,
    (NOT is_private OR id = auth.uid() OR viewer_follows(email)) AS full_view
  FROM public.user_profiles
  WHERE NOT viewer_is_blocked_by(email)
) visible_profiles;

REVOKE ALL ON public.public_profiles FROM anon;
GRANT SELECT ON public.public_profiles TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFICATION (run separately; it writes and rolls back)
-- ───────────────────────────────────────────────────────────────────────────
--
-- Production has no private profiles, so a before/after against live data
-- exercises exactly one branch and proves nothing. Seed the missing case,
-- capture the visible row ids per viewer, and diff BOTH directions.
--
--   BEGIN;
--     UPDATE public.user_profiles SET is_private = TRUE WHERE username = 'evrock';
--     SET LOCAL role authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<a stranger uuid>","role":"authenticated"}';
--     SELECT count(*) FROM public.hub_follows;    -- must drop
--     SELECT count(*) FROM public.user_trophies;  -- must drop
--     SELECT count(*) FROM public.hub_posts;      -- must drop
--     SELECT bio IS NOT NULL AS bio_visible, total_xp IS NULL AS stats_hidden
--       FROM public.public_profiles WHERE username = 'evrock';
--   ROLLBACK;
