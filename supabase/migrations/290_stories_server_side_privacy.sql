-- Migration 290: story privacy was enforced only on the client
--
-- Found by the Hub interaction audit (Aug 2026).
--
-- `hub_posts` has a proper read policy — it checks is_blocked(), publish_at
-- and privacy, and joins hub_follows for followers-only posts. `stories`
-- had `USING (true)`. Every story row was readable by every authenticated
-- user, whatever its privacy setting.
--
-- The client does filter correctly (src/lib/data/stories.js pulls followed
-- accounts, then a separate `privacy = 'public'` + public-profile pass for
-- discovery, minus story_blocks). So the app never SHOWS a private story to
-- the wrong person. But the gate lived entirely in that query, and the table
-- is a PostgREST endpoint — one crafted request returns everything.
--
-- Verified against production before writing this, in a rolled-back
-- transaction: user A posts a `privacy = 'friends'` story, user B (who does
-- not follow A) selects it as a real `authenticated` role, and gets the row
-- back including image_url. `uploads` is a public bucket, so that URL is the
-- media. Same exposure for a blocked viewer and for a private account.
--
-- THE RULES, mirroring what stories.js already implements:
--   • your own stories, always
--   • never if the author story-blocked you (story_blocks, which
--     blockUserFull mirrors into) or blocked you outright (is_blocked)
--   • crew stories: crew members only, and never in the personal feed
--   • privacy='public' AND the author's profile is public: anyone
--   • otherwise (friends, or public-but-private-account): followers only
--
-- expires_at is deliberately NOT in the policy. The client and the
-- purge_expired_stories cron handle lifetime; filtering it here would hide
-- a user's own expired rows from their delete path.
--
-- The logic lives in a SECURITY DEFINER helper rather than inline in the
-- policy for two reasons: the policy body stays bare column names (no
-- `stories.user_email` qualification, which the paste pipeline mangles),
-- and it can be unit-tested by calling it directly.
--
-- Idempotent: CREATE OR REPLACE + DROP POLICY IF EXISTS.

CREATE OR REPLACE FUNCTION public.can_view_story(
  p_author_id    uuid,
  p_author_email text,
  p_privacy      text,
  p_crew_id      uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_email    text;
  v_private  boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Resolve the viewer's email from their profile rather than auth.email().
  -- auth.email() reads a JWT claim, and a token without an `email` claim
  -- (anonymous sign-in, which this project has enabled) returns NULL — which
  -- would silently fail every follower check and hide followed accounts'
  -- stories. Caught by the follower regression test, not by the happy path.
  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;

  -- Your own stories are always yours.
  IF p_author_id = v_uid OR (v_email IS NOT NULL AND lower(COALESCE(p_author_email,'')) = lower(v_email)) THEN
    RETURN TRUE;
  END IF;

  -- Story-scoped block (blockUserFull mirrors into this table).
  IF EXISTS (
    SELECT 1 FROM public.story_blocks
     WHERE blocker_id = p_author_id AND blocked_id = v_uid
  ) THEN
    RETURN FALSE;
  END IF;

  -- Outright block, same helper hub_posts uses.
  IF public.is_blocked(v_uid, p_author_email) THEN
    RETURN FALSE;
  END IF;

  -- Crew stories are for that crew, and never surface elsewhere.
  IF p_crew_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM public.crew_members
       WHERE crew_id = p_crew_id AND user_id = v_uid
    );
  END IF;

  -- A public story from a public account is public. Missing is_private is
  -- treated as private — fail closed, matching the client's comment.
  SELECT is_private INTO v_private FROM public.user_profiles WHERE id = p_author_id;
  IF p_privacy = 'public' AND v_private IS NOT TRUE THEN
    RETURN TRUE;
  END IF;

  -- Everything else is follower-only. Match on ids OR emails: mig 208's
  -- trigger populates follower_id / followee_id, but both columns are
  -- nullable and older rows may predate it, so neither pair alone is
  -- reliable on its own.
  RETURN EXISTS (
    SELECT 1 FROM public.hub_follows
     WHERE (follower_id = v_uid AND followee_id = p_author_id)
        OR (v_email IS NOT NULL
            AND lower(follower_email) = lower(v_email)
            AND lower(followee_email) = lower(COALESCE(p_author_email,'')))
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.can_view_story(uuid, text, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_view_story(uuid, text, text, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.can_view_story(uuid, text, text, uuid) TO authenticated;

DROP POLICY IF EXISTS "stories: authenticated can read" ON public.stories;
CREATE POLICY "stories: privacy and blocking read" ON public.stories
  FOR SELECT TO authenticated
  USING (public.can_view_story(user_id, user_email, privacy, crew_id));
