-- 126_emoji_reactions.sql
--
-- Arbitrary-emoji reactions on hub posts. The existing like/dislike
-- system stays untouched — emoji reactions are independent. Users
-- can have at most one emoji reaction per post (separate from their
-- like/dislike, which they can also have).
--
-- The `hub_reactions` table already has an `emoji` column (currently
-- populated with the literal strings 'like' / 'dislike' as a mirror
-- of `reaction_type`). For emoji reactions we use the actual emoji
-- character (🔥, 💪, etc.). A reaction is considered "emoji" when
-- `reaction_type` is NULL (or any non-like/dislike value) — the new
-- RPC inserts rows with reaction_type = NULL so they're easy to
-- distinguish.
--
-- Counter: `hub_posts.emoji_reaction_count` is kept in sync inside
-- the RPC transaction. Like/dislike counters are unaffected.

ALTER TABLE public.hub_posts
  ADD COLUMN IF NOT EXISTS emoji_reaction_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS hub_reactions_emoji_idx
  ON public.hub_reactions (post_id, emoji)
  WHERE reaction_type IS NULL;

-- ── set_post_emoji_reaction RPC ───────────────────────────────────────
-- p_emoji NULL  → clear the user's emoji reaction on this post (if any)
-- p_emoji other → set/replace the user's emoji reaction to the given emoji
-- Returns the new emoji_reaction_count for the post.

CREATE OR REPLACE FUNCTION public.set_post_emoji_reaction(
  p_post_id UUID,
  p_emoji   TEXT
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $set_post_emoji_reaction$
DECLARE
  v_email TEXT := auth.email();
  v_uid   UUID := auth.uid();
  v_old_emoji TEXT;
  v_new_count INT;
BEGIN
  IF v_email IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_post_id IS NULL THEN
    RAISE EXCEPTION 'post_id required' USING ERRCODE = '22023';
  END IF;
  -- Sanity guard — emoji should be 1..8 bytes-ish. Anyone passing a
  -- long string is misusing the API; reject. We intentionally don't
  -- enforce a whitelist of emoji values so users can react with any
  -- glyph their keyboard supports.
  IF p_emoji IS NOT NULL AND char_length(p_emoji) > 8 THEN
    RAISE EXCEPTION 'emoji too long' USING ERRCODE = '22023';
  END IF;
  IF p_emoji IS NOT NULL AND p_emoji IN ('like', 'dislike') THEN
    RAISE EXCEPTION 'reserved emoji value' USING ERRCODE = '22023';
  END IF;

  -- Find the user's current EMOJI reaction (excluding like/dislike).
  SELECT emoji INTO v_old_emoji
    FROM public.hub_reactions
   WHERE post_id = p_post_id
     AND created_by = v_email
     AND reaction_type IS NULL
   LIMIT 1;

  -- No-op when nothing changes.
  IF v_old_emoji IS NOT DISTINCT FROM p_emoji THEN
    SELECT COALESCE(emoji_reaction_count, 0) INTO v_new_count
      FROM public.hub_posts WHERE id = p_post_id;
    RETURN v_new_count;
  END IF;

  -- Remove the old emoji reaction (if any).
  IF v_old_emoji IS NOT NULL THEN
    DELETE FROM public.hub_reactions
     WHERE post_id = p_post_id
       AND created_by = v_email
       AND reaction_type IS NULL;
    UPDATE public.hub_posts
       SET emoji_reaction_count = GREATEST(0, COALESCE(emoji_reaction_count, 0) - 1)
     WHERE id = p_post_id;
  END IF;

  -- Insert the new emoji reaction (or stop, when clearing).
  IF p_emoji IS NOT NULL THEN
    INSERT INTO public.hub_reactions (post_id, created_by, user_id, reaction_type, emoji, user_email)
    VALUES (p_post_id, v_email, v_uid, NULL, p_emoji, v_email);
    UPDATE public.hub_posts
       SET emoji_reaction_count = COALESCE(emoji_reaction_count, 0) + 1
     WHERE id = p_post_id;
  END IF;

  SELECT COALESCE(emoji_reaction_count, 0) INTO v_new_count
    FROM public.hub_posts WHERE id = p_post_id;
  RETURN v_new_count;
END;
$set_post_emoji_reaction$;

REVOKE ALL ON FUNCTION public.set_post_emoji_reaction(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_post_emoji_reaction(UUID, TEXT) TO authenticated;

-- ── get_post_emoji_summary helper ────────────────────────────────────
-- Returns the top emoji + total count for a post. Used by the post
-- card to show "🔥 12" — picks the most-common emoji as the avatar.
-- Always returns a single row (post_id, top_emoji, total_count).

CREATE OR REPLACE FUNCTION public.get_post_emoji_summary(p_post_id UUID)
RETURNS TABLE (top_emoji TEXT, total_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN QUERY
    WITH counts AS (
      SELECT emoji, COUNT(*)::INT AS n
        FROM public.hub_reactions
       WHERE post_id = p_post_id AND reaction_type IS NULL
       GROUP BY emoji
    )
    SELECT
      (SELECT emoji FROM counts ORDER BY n DESC, emoji LIMIT 1) AS top_emoji,
      COALESCE((SELECT SUM(n)::INT FROM counts), 0)              AS total_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_post_emoji_summary(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_post_emoji_summary(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
