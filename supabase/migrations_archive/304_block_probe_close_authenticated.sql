-- 304_block_probe_close_authenticated.sql
--
-- Finishes what 302 started. That one revoked is_blocked from anon, which
-- closed the unauthenticated probe. Any signed-in user could still ask
-- "does user X block email Y?" for an arbitrary pair, because the feed
-- read policies need EXECUTE and call is_blocked directly.
--
-- ── Why the function cannot simply be guarded ────────────────────────
--
-- The obvious fix — return false unless p_viewer_id = auth.uid() — is
-- wrong, and wrong in the dangerous direction. enforce_block_on_dm_send
-- and notify_dm_received call is_blocked with the RECIPIENT's id, asking
-- "does the person I am messaging block me?" A caller-identity guard
-- returns false there and silently switches off block enforcement on
-- DMs: someone you blocked could message you again. That is worse than
-- the leak.
--
-- So the split is by AUDIENCE rather than by logic:
--
--   is_blocked(uuid, text)       arbitrary pair. Internal from here:
--                                revoked from anon (302) and now from
--                                authenticated. Only SECURITY DEFINER
--                                callers reach it, and they run as the
--                                owner, so the DM path is untouched.
--   viewer_is_blocked_by(text)   the caller and one author. Safe to
--                                expose: the viewer is auth.uid() and
--                                cannot be supplied.
--
-- Nobody can now probe a pair they are not half of.
--
-- ── viewer_follows exists for paste safety ───────────────────────────
--
-- The policies have to be recreated (the expression changes), and the
-- old hub_posts expression inlined a correlated subquery over
-- hub_follows — carrying `hub_follows.follower_email` and
-- `hub_posts.author_email`, the alias.column tokens the deploy clipboard
-- mangles into `42601 syntax error at "<"`. Hoisting that branch into a
-- function leaves the policy with bare columns and public.fn() calls
-- only, which survives the paste. It also makes the policy readable,
-- which for a feed's visibility rule is worth something on its own.
--
-- ── Verified equivalent, not assumed ─────────────────────────────────
--
-- Live data exercises almost none of this: 23 public posts, zero
-- followers-only, zero scheduled, zero blocks. A before/after on that
-- would have proved only the public branch. So the test seeded a
-- followers-only post, a future-dated post and a block, then captured
-- the exact set of visible row ids for four real users across both
-- tables, applied the change, and captured again:
--
--   rows visible only BEFORE   0
--   rows visible only AFTER    0
--
-- Set-identical in both directions — not merely the same counts, which
-- four viewers happened to match on anyway. And the probe itself, run as
-- a signed-in user afterwards: insufficient_privilege.
--
-- Nothing in the client calls is_blocked directly; checked before
-- revoking.

CREATE OR REPLACE FUNCTION public.viewer_is_blocked_by(p_author_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_blocked((SELECT auth.uid()), p_author_email);
$$;

CREATE OR REPLACE FUNCTION public.viewer_follows(p_author_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.hub_follows
     WHERE lower(follower_email) = lower(
             (SELECT NULLIF(public.current_user_email(), '')))
       AND lower(followee_email) = lower(p_author_email)
  );
$$;

REVOKE ALL ON FUNCTION public.viewer_is_blocked_by(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.viewer_follows(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.viewer_is_blocked_by(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.viewer_follows(TEXT) TO authenticated;

DROP POLICY IF EXISTS "hub_comments: blocking read" ON public.hub_comments;
CREATE POLICY "hub_comments: blocking read" ON public.hub_comments
  FOR SELECT TO authenticated
  USING (
    author_email = (SELECT NULLIF(public.current_user_email(), ''))
    OR user_id = (SELECT auth.uid())
    OR NOT public.viewer_is_blocked_by(author_email)
  );

DROP POLICY IF EXISTS "hub_posts: privacy and blocking read" ON public.hub_posts;
CREATE POLICY "hub_posts: privacy and blocking read" ON public.hub_posts
  FOR SELECT TO authenticated
  USING (
    author_email = (SELECT NULLIF(public.current_user_email(), ''))
    OR user_id = (SELECT auth.uid())
    OR (
      (publish_at IS NULL OR publish_at <= now())
      AND NOT public.viewer_is_blocked_by(author_email)
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

-- The point of the migration. Internal callers are SECURITY DEFINER and
-- run as the owner: enforce_block_on_dm_send, notify_dm_received,
-- can_view_post and can_view_story keep working unchanged.
REVOKE EXECUTE ON FUNCTION public.is_blocked(UUID, TEXT) FROM authenticated;
