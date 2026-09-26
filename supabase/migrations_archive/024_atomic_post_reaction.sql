-- 024_atomic_post_reaction.sql
--
-- Atomic post-reaction transition. The previous client flow did:
--   1. SELECT existing reaction
--   2. DELETE old row
--   3. UPDATE post.like_count - 1
--   4. INSERT new row
--   5. UPDATE post.like_count + 1
-- Any partial failure between (2) and (5) left the post's counters off
-- by one — a low-frequency but visible "smell" the audit surfaced.
--
-- This RPC performs all five steps inside a single transaction. The
-- function is SECURITY DEFINER + restricts to the caller's own row via
-- auth.uid()/auth.email(), so it can't be used to mutate someone else's
-- reaction. Counters are derived in-place to keep the maintenance loop
-- self-contained (no separate trigger needed).
--
-- Behavior:
--   p_reaction = 'like'    → ensure user has a 'like'    on the post.
--   p_reaction = 'dislike' → ensure user has a 'dislike' on the post.
--   p_reaction = NULL      → ensure user has no reaction on the post.
-- Idempotent: calling with the user's current state is a no-op (returns
-- without modifying counters).

CREATE OR REPLACE FUNCTION public.set_post_reaction(
  p_post_id  UUID,
  p_reaction TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := auth.email();
  v_uid   UUID := auth.uid();
  v_old   TEXT;
BEGIN
  IF v_email IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_reaction IS NOT NULL AND p_reaction NOT IN ('like', 'dislike') THEN
    RAISE EXCEPTION 'invalid reaction: %', p_reaction USING ERRCODE = '22023';
  END IF;
  IF p_post_id IS NULL THEN
    RAISE EXCEPTION 'post_id required' USING ERRCODE = '22023';
  END IF;

  -- Find the user's current reaction (if any) for this post.
  SELECT reaction_type INTO v_old
    FROM public.hub_reactions
   WHERE post_id = p_post_id AND created_by = v_email
   LIMIT 1;

  -- No-op when nothing changes.
  IF v_old IS NOT DISTINCT FROM p_reaction THEN
    RETURN;
  END IF;

  -- Remove the old reaction row + its counter contribution.
  IF v_old IS NOT NULL THEN
    DELETE FROM public.hub_reactions
     WHERE post_id = p_post_id AND created_by = v_email;
    IF v_old = 'like' THEN
      UPDATE public.hub_posts
         SET like_count = GREATEST(0, COALESCE(like_count, 0) - 1)
       WHERE id = p_post_id;
    ELSIF v_old = 'dislike' THEN
      UPDATE public.hub_posts
         SET dislike_count = GREATEST(0, COALESCE(dislike_count, 0) - 1)
       WHERE id = p_post_id;
    END IF;
  END IF;

  -- Insert the new reaction (or stop, when clearing).
  IF p_reaction IS NOT NULL THEN
    INSERT INTO public.hub_reactions (post_id, created_by, user_id, reaction_type, emoji, user_email)
    VALUES (p_post_id, v_email, v_uid, p_reaction, p_reaction, v_email);
    IF p_reaction = 'like' THEN
      UPDATE public.hub_posts
         SET like_count = COALESCE(like_count, 0) + 1
       WHERE id = p_post_id;
    ELSIF p_reaction = 'dislike' THEN
      UPDATE public.hub_posts
         SET dislike_count = COALESCE(dislike_count, 0) + 1
       WHERE id = p_post_id;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_post_reaction(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
