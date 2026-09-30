-- Friends' likes: the posts your friends have liked, Instagram-style.
--
-- Until now a like was readable only by the person who made it:
-- hub_reactions has one policy, owner-only for every command. This adds a
-- second, deliberately narrow read path and a switch to close it.
--
-- WHO IS A FRIEND. A mutual follow, keyed on ids: you follow them AND they
-- follow you. Same rule as get_friend_leaderboard. A one-way follow is not
-- enough, or following someone would be a way to watch what they like.
--
-- THE SWITCH. user_profiles.share_likes_with_friends. It is RECIPROCAL, the
-- way read receipts are: switched off, your likes are never returned to
-- anyone AND the function returns nothing to you. Nobody can hide their own
-- likes while still watching everyone else's.
--
-- OFF BY DEFAULT. Until now the app promised "your likes are private", and
-- every existing like was made under that promise, so nobody's likes become
-- visible until they switch this on themselves.
--
-- WHAT IS NEVER RETURNED, and why each clause exists:
--   * a like from anyone who switched sharing off;
--   * a like from anyone in a block with the viewer, either direction
--     (is_blocked checks both);
--   * a like on a post the viewer could not read in the feed. The post
--     clause below is the hub_posts SELECT policy ("privacy and blocking
--     read") copied verbatim minus its own-row branch. This function is
--     SECURITY DEFINER, so that policy does not apply here and has to be
--     restated; if the policy changes, change this too. The client then
--     loads the posts through the normal RLS read, so a drift between the
--     two drops rows rather than leaking them;
--   * the viewer's own posts (a friend liking your post is already in the
--     You tab as a notification).
--
-- Only ids and a timestamp come back. Names and avatars are read by the
-- client from public_profiles, which applies its own block and privacy rules.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS share_likes_with_friends BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.user_profiles.share_likes_with_friends IS
  'Reciprocal: when false, get_friends_liked_posts neither returns this user''s likes to friends nor returns friends'' likes to this user.';

CREATE INDEX IF NOT EXISTS hub_reactions_user_likes_idx
  ON public.hub_reactions (user_id, created_at DESC)
  WHERE reaction_type = 'like';

CREATE OR REPLACE FUNCTION public.get_friends_liked_posts(
  p_limit  INTEGER     DEFAULT 60,
  p_before TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (post_id UUID, liker_id UUID, liked_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT := NULLIF(public.current_user_email(), '');
  v_limit INT  := LEAST(GREATEST(COALESCE(p_limit, 60), 1), 100);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Reciprocal: a viewer who does not share sees nothing.
  IF NOT COALESCE(
       (SELECT up.share_likes_with_friends FROM public.user_profiles up WHERE up.id = v_uid),
       FALSE) THEN
    RETURN;
  END IF;

  RETURN QUERY
    WITH friends AS (
      SELECT f.followee_id AS fid
        FROM public.hub_follows f
       WHERE f.follower_id = v_uid
         AND f.followee_id <> v_uid
         AND EXISTS (
           SELECT 1 FROM public.hub_follows b
            WHERE b.follower_id = f.followee_id
              AND b.followee_id = v_uid)
    ),
    sharers AS (
      SELECT DISTINCT up.id AS sid
        FROM public.user_profiles up
        JOIN friends ON friends.fid = up.id
       WHERE up.share_likes_with_friends
         AND NOT public.is_blocked(v_uid, up.email)
    )
    SELECT r.post_id, r.user_id, r.created_at
      FROM public.hub_reactions r
      JOIN sharers ON sharers.sid = r.user_id
      JOIN public.hub_posts p ON p.id = r.post_id
     WHERE r.reaction_type = 'like'
       AND r.created_at IS NOT NULL
       AND (p_before IS NULL OR r.created_at < p_before)
       -- not the viewer's own post
       AND p.user_id IS DISTINCT FROM v_uid
       AND (v_email IS NULL OR lower(p.author_email) IS DISTINCT FROM v_email)
       -- hub_posts "privacy and blocking read", minus the own-row branch
       AND (p.publish_at IS NULL OR p.publish_at <= now())
       AND NOT public.viewer_is_blocked_by(p.author_email)
       AND (
             (public.viewer_can_see_activity(p.author_email)
               AND (p.privacy = 'public'
                    OR (p.privacy = 'followers'
                        AND v_email IS NOT NULL
                        AND public.viewer_follows(p.author_email))))
          OR (p.privacy = 'crew'
              AND p.crew_id IS NOT NULL
              AND public.is_crew_member(p.crew_id))
       )
     ORDER BY r.created_at DESC
     LIMIT v_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_friends_liked_posts(INTEGER, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_friends_liked_posts(INTEGER, TIMESTAMPTZ) TO authenticated;

-- Attempt, don't inspect: with no JWT the function must refuse.
DO $$
BEGIN
  PERFORM * FROM public.get_friends_liked_posts(5, NULL);
  RAISE EXCEPTION 'get_friends_liked_posts answered an unauthenticated caller';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END;
$$;
