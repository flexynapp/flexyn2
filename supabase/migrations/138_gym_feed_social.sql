-- 138_gym_feed_social.sql
--
-- "Social home page" for each gym. The gym_feed_posts table already
-- exists from mig 135 (member-only RLS, body + media_url, denormalized
-- like_count + comment_count). This migration fills out the social
-- layer:
--   • gym_feed_post_reactions  — emoji reactions (any emoji, multiple
--                                  per user)
--   • gym_feed_comments        — inline comments with parent_id for
--                                  nested replies (flat for v1, schema
--                                  ready for threading later)
--   • gym_feed_posts.is_pinned + pinned_at — owner can pin ONE post
--                                  to the top of the feed
--   • gym_feed_posts.reaction_count — denormalized counter for the
--                                  card UI; kept in sync by trigger
--
-- All tables inherit member-only visibility through the parent feed
-- post's RLS via existence checks.

-- ── New columns on the existing feed table ───────────────────────────
ALTER TABLE public.gym_feed_posts
  ADD COLUMN IF NOT EXISTS is_pinned       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pinned_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reaction_count  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS edited_at       TIMESTAMPTZ;

-- One pinned post per gym at a time — enforced by a partial unique
-- index. The owner-pin RPC below auto-unpins the previous pinned
-- post before pinning a new one, so this constraint should never
-- actually trip; it's belt + braces.
CREATE UNIQUE INDEX IF NOT EXISTS gym_feed_one_pinned_per_gym
  ON public.gym_feed_posts (gym_id)
  WHERE is_pinned = TRUE;

-- ── gym_feed_post_reactions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gym_feed_post_reactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES public.gym_feed_posts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL CHECK (char_length(emoji) <= 10),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS gym_feed_rxn_post_idx
  ON public.gym_feed_post_reactions (post_id);

ALTER TABLE public.gym_feed_post_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gym_feed_rxn: members read"  ON public.gym_feed_post_reactions;
DROP POLICY IF EXISTS "gym_feed_rxn: own write"     ON public.gym_feed_post_reactions;
DROP POLICY IF EXISTS "gym_feed_rxn: own delete"    ON public.gym_feed_post_reactions;

-- Read gated through the parent post's member-only visibility.
CREATE POLICY "gym_feed_rxn: members read"
  ON public.gym_feed_post_reactions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.gym_feed_posts gfp
        JOIN public.gym_members gm ON gm.gym_id = gfp.gym_id
       WHERE gfp.id = gym_feed_post_reactions.post_id
         AND gm.user_id = auth.uid()
    )
  );

CREATE POLICY "gym_feed_rxn: own write"
  ON public.gym_feed_post_reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "gym_feed_rxn: own delete"
  ON public.gym_feed_post_reactions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.gym_feed_post_reactions TO authenticated;

-- Counter sync trigger — keeps gym_feed_posts.reaction_count fresh
-- without a separate refresh job.
CREATE OR REPLACE FUNCTION public.gym_feed_rxn_count_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.gym_feed_posts
       SET reaction_count = COALESCE(reaction_count, 0) + 1
     WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.gym_feed_posts
       SET reaction_count = GREATEST(0, COALESCE(reaction_count, 0) - 1)
     WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_gym_feed_rxn_count ON public.gym_feed_post_reactions;
CREATE TRIGGER trg_gym_feed_rxn_count
  AFTER INSERT OR DELETE ON public.gym_feed_post_reactions
  FOR EACH ROW EXECUTE FUNCTION public.gym_feed_rxn_count_sync();

-- ── gym_feed_comments ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gym_feed_comments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       UUID NOT NULL REFERENCES public.gym_feed_posts(id) ON DELETE CASCADE,
  parent_id     UUID REFERENCES public.gym_feed_comments(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_email  TEXT NOT NULL,
  body          TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS gym_feed_comments_post_idx
  ON public.gym_feed_comments (post_id, created_at);

ALTER TABLE public.gym_feed_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gym_feed_comments: members read"  ON public.gym_feed_comments;
DROP POLICY IF EXISTS "gym_feed_comments: members write" ON public.gym_feed_comments;
DROP POLICY IF EXISTS "gym_feed_comments: author delete" ON public.gym_feed_comments;

CREATE POLICY "gym_feed_comments: members read"
  ON public.gym_feed_comments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.gym_feed_posts gfp
        JOIN public.gym_members gm ON gm.gym_id = gfp.gym_id
       WHERE gfp.id = gym_feed_comments.post_id
         AND gm.user_id = auth.uid()
    )
  );

CREATE POLICY "gym_feed_comments: members write"
  ON public.gym_feed_comments FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.gym_feed_posts gfp
        JOIN public.gym_members gm ON gm.gym_id = gfp.gym_id
       WHERE gfp.id = gym_feed_comments.post_id
         AND gm.user_id = auth.uid()
    )
  );

CREATE POLICY "gym_feed_comments: author delete"
  ON public.gym_feed_comments FOR DELETE TO authenticated
  USING (author_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.gym_feed_comments TO authenticated;

-- Counter sync for gym_feed_posts.comment_count.
CREATE OR REPLACE FUNCTION public.gym_feed_comment_count_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.gym_feed_posts
       SET comment_count = COALESCE(comment_count, 0) + 1
     WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.gym_feed_posts
       SET comment_count = GREATEST(0, COALESCE(comment_count, 0) - 1)
     WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_gym_feed_comment_count ON public.gym_feed_comments;
CREATE TRIGGER trg_gym_feed_comment_count
  AFTER INSERT OR DELETE ON public.gym_feed_comments
  FOR EACH ROW EXECUTE FUNCTION public.gym_feed_comment_count_sync();

-- ── Pin / unpin RPC (owner-only) ────────────────────────────────────
-- Owners can pin ONE post per gym at a time. Pinning a new post
-- auto-unpins whatever was pinned before, so the unique index never
-- trips. The "pin only your own gym's posts" gate is enforced via
-- the owner_id check on the joined gym row.

CREATE OR REPLACE FUNCTION public.toggle_pin_gym_post(p_post_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_post   public.gym_feed_posts%ROWTYPE;
  v_owner  UUID;
  v_was    BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_post FROM public.gym_feed_posts WHERE id = p_post_id;
  IF v_post.id IS NULL THEN
    RAISE EXCEPTION 'post not found' USING ERRCODE = '22023';
  END IF;

  SELECT owner_id INTO v_owner FROM public.gym_businesses WHERE id = v_post.gym_id;
  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'owner only' USING ERRCODE = '42501';
  END IF;

  v_was := v_post.is_pinned;

  -- If we're about to pin and another post is already pinned in
  -- this gym, unpin it first so the unique-pin index stays happy.
  IF NOT v_was THEN
    UPDATE public.gym_feed_posts
       SET is_pinned = FALSE, pinned_at = NULL
     WHERE gym_id = v_post.gym_id AND is_pinned = TRUE;
  END IF;

  UPDATE public.gym_feed_posts
     SET is_pinned = NOT v_was,
         pinned_at = CASE WHEN NOT v_was THEN now() ELSE NULL END
   WHERE id = p_post_id;

  RETURN NOT v_was;
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_pin_gym_post(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_pin_gym_post(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
