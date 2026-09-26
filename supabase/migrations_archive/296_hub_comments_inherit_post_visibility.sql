-- Migration 296: comments on a private post were readable by anyone
--
-- Third instance of one pattern in this audit: the parent is gated, the
-- child is not. Stories (mig 290) and DMs (mig 295) were the first two.
--
--   hub_posts     — privacy + blocking + publish_at gated. Correct.
--   hub_comments  — "hub_comments: blocking read":
--                     author_email = me OR user_id = me
--                     OR NOT is_blocked(auth.uid(), author_email)
--
-- That last clause is true for nearly everyone — you are not blocked by most
-- people — and nothing in it asks whether the viewer can see the POST the
-- comment hangs off. So a comment on a followers-only post was readable by
-- someone who could not read the post itself.
--
-- Verified against production with a rolled-back fixture — A posts
-- followers-only, B does not follow A:
--
--   B reads the POST     -> 0                                   (gated)
--   B reads its COMMENT  -> 'SECRET COMMENT ON A PRIVATE POST'  (leak)
--
-- Lower severity than the DM leak: comments are semi-public by nature, this
-- needs a non-public post to exploit, and production currently has no
-- non-public post carrying comments. It is the same defect regardless, and it
-- starts mattering the moment anyone posts followers-only.
--
-- THE FIX: a comment inherits its post's visibility. can_view_post() is a
-- SECURITY DEFINER mirror of the hub_posts read policy, applied as a
-- RESTRICTIVE policy so it ANDs with the existing permissive set:
--
--   (author or not-blocked)  AND  (can see the parent post)
--
-- RESTRICTIVE is the whole point — see migration 295. A permissive policy can
-- only ever ADD access, so a rule meant to hide rows written permissively
-- becomes a grant. That is exactly how the DM leak happened.
--
-- Why a SECURITY DEFINER helper rather than an inline EXISTS against
-- hub_posts: the helper reads hub_posts with RLS bypassed and re-implements
-- the visibility rule explicitly, so this does not depend on whether Postgres
-- applies RLS to a table referenced inside a policy expression — a semantic I
-- have no direct evidence about in this database and did not want to bet a
-- privacy fix on. Same reason mig 290 used can_view_story().
--
-- The rule is duplicated from the hub_posts policy, which is a real cost: if
-- post visibility changes, this must change with it. That is the trade for
-- not depending on unproven recursion semantics. If they ever diverge, the
-- comment is the one that leaks, so change this first.
--
-- Idempotent: CREATE OR REPLACE + DROP POLICY IF EXISTS.

CREATE OR REPLACE FUNCTION public.can_view_post(p_post_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_email        text;
  v_author       text;
  v_author_id    uuid;
  v_privacy      text;
  v_publish_at   timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;
  IF p_post_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Resolved from the profile rather than auth.email(): a guest token has no
  -- email claim, and the whole email-keyed model would fail closed for them.
  -- Same reasoning as migration 293.
  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;

  SELECT author_email, user_id, privacy, publish_at
    INTO v_author, v_author_id, v_privacy, v_publish_at
    FROM public.hub_posts
   WHERE id = p_post_id;

  IF v_author IS NULL AND v_author_id IS NULL THEN
    RETURN FALSE;   -- post gone; nothing to inherit from
  END IF;

  -- Your own post, always.
  IF v_author_id = v_uid
     OR (v_email IS NOT NULL AND lower(COALESCE(v_author,'')) = lower(v_email)) THEN
    RETURN TRUE;
  END IF;

  IF v_publish_at IS NOT NULL AND v_publish_at > now() THEN
    RETURN FALSE;   -- scheduled, not yet live
  END IF;

  IF public.is_blocked(v_uid, v_author) THEN
    RETURN FALSE;
  END IF;

  IF v_privacy = 'public' THEN
    RETURN TRUE;
  END IF;

  -- followers-only (and anything else non-public): must follow the author.
  RETURN EXISTS (
    SELECT 1 FROM public.hub_follows
     WHERE (follower_id = v_uid AND followee_id = v_author_id)
        OR (v_email IS NOT NULL
            AND lower(follower_email) = lower(v_email)
            AND lower(followee_email) = lower(COALESCE(v_author,'')))
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.can_view_post(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_view_post(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.can_view_post(uuid) TO authenticated;

DROP POLICY IF EXISTS "hub_comments: inherits post visibility" ON public.hub_comments;
CREATE POLICY "hub_comments: inherits post visibility"
  ON public.hub_comments
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (public.can_view_post(post_id));
