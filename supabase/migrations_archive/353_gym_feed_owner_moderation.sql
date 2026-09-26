-- 353_gym_feed_owner_moderation.sql
--
-- A gym owner can pin a member's post but cannot delete it, and the app
-- tells them otherwise.
--
-- GymFeedTab renders the Delete control to `isAuthor || isOwner`
-- (GymFeedTab.jsx:348/370) and the comment control to
-- `c.author_id === meId || isPostAuthorOrGymOwner` (:507). Both DELETE
-- policies are author-only:
--
--     gym_feed: author delete           USING (author_id = auth.uid())
--     gym_feed_comments: author delete  USING (author_id = auth.uid())
--
-- A DELETE that matches no rows is not an error. PostgREST returns 204,
-- `deleteFeedPost` computes `{ ok: !error }` and reports success, and the
-- post is still there on the next read. Proved against production
-- 2026-08-12 by seeding one post authored by a non-owner and issuing the
-- DELETE as the gym owner over the `authenticated` role:
--
--     1_owner_delete       no error raised · ROW_COUNT = 0
--     2_post_still_there   1
--     3_owner_pin          pin RPC succeeded for the owner
--
-- The seeded row was removed in the same block; the table was at 0 posts
-- before and after.
--
-- Pinning is right because it goes through `toggle_pin_gym_post`, which
-- checks the gym's owner_id. This migration gives DELETE the same reach,
-- so the two moderation actions finally agree with each other and with
-- the UI that offers them.
--
-- Deliberately NOT in scope here: there is still no way for a member to
-- REPORT a post. `hub_reports` exists and the Hub feed uses it; the gym
-- feed accepts text and images with no report affordance at all. That is
-- a product change (a table target, a UI entry point, an admin queue),
-- not a policy change, and it is the larger half of making this feed
-- shippable.

-- ── helper ───────────────────────────────────────────────────────────
-- Hoisted into a function so the policies below stay bare-column and
-- survive the clipboard: a correlated subquery here would need
-- `alias.column` tokens, which the paste pipeline mangles into
-- `42601 syntax error`.
CREATE OR REPLACE FUNCTION public.is_gym_owner(p_gym_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.gym_businesses
     WHERE id = p_gym_id
       AND owner_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_gym_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_gym_owner(uuid) TO authenticated;

-- Same shape for a comment, which carries post_id rather than gym_id.
-- Covers the gym owner AND the author of the post being commented on,
-- matching `isPostAuthorOrGymOwner` at GymFeedTab.jsx:507.
-- plpgsql with a scalar SELECT INTO rather than a join, so every
-- statement stays single-table with bare columns. A join here would need
-- `public.gym_feed_posts.author_id`-shaped tokens, and the clipboard
-- pipeline mangles dotted column references into `42601 syntax error`.
CREATE OR REPLACE FUNCTION public.can_moderate_gym_comment(p_post_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_gym    uuid;
  v_author uuid;
BEGIN
  SELECT gym_id, author_id
    INTO v_gym, v_author
    FROM public.gym_feed_posts
   WHERE id = p_post_id;

  IF v_gym IS NULL THEN
    RETURN FALSE;
  END IF;
  IF v_author = auth.uid() THEN
    RETURN TRUE;
  END IF;
  RETURN public.is_gym_owner(v_gym);
END;
$$;

REVOKE ALL ON FUNCTION public.can_moderate_gym_comment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_moderate_gym_comment(uuid) TO authenticated;

-- ── posts ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "gym_feed: author delete" ON public.gym_feed_posts;
DROP POLICY IF EXISTS "gym_feed: author or gym owner delete" ON public.gym_feed_posts;

CREATE POLICY "gym_feed: author or gym owner delete"
  ON public.gym_feed_posts
  FOR DELETE
  TO authenticated
  USING (
    author_id = auth.uid()
    OR public.is_gym_owner(gym_id)
  );

-- ── comments ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "gym_feed_comments: author delete" ON public.gym_feed_comments;
DROP POLICY IF EXISTS "gym_feed_comments: author or moderator delete" ON public.gym_feed_comments;

CREATE POLICY "gym_feed_comments: author or moderator delete"
  ON public.gym_feed_comments
  FOR DELETE
  TO authenticated
  USING (
    author_id = auth.uid()
    OR public.can_moderate_gym_comment(post_id)
  );

-- ── self-verification ────────────────────────────────────────────────
-- The Supabase SQL editor hides RAISE NOTICE, so this ends in a SELECT.
-- Expect two rows, each reading 'author + owner'.
SELECT
  polname                                   AS policy,
  CASE
    WHEN pg_get_expr(polqual, polrelid) LIKE '%is_gym_owner%'
      OR pg_get_expr(polqual, polrelid) LIKE '%can_moderate_gym_comment%'
    THEN 'author + owner'
    ELSE 'STILL AUTHOR ONLY — migration did not take'
  END                                       AS reach
FROM pg_policy
WHERE polrelid IN ('public.gym_feed_posts'::regclass,
                   'public.gym_feed_comments'::regclass)
  AND polcmd = 'd'
ORDER BY 1;
