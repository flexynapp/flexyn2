-- 106_general_user_blocks.sql
--
-- General-purpose user-block table. Today storyPrivacy.js + story_blocks
-- (mig 043) lets a user hide stories from a specific viewer — but that
-- only covers stories. A blocked user's posts still show up in feeds,
-- they can still DM you, they can still see your profile.
--
-- This adds the full-scope block:
--
--   user_blocks   — separate table (story_blocks stays as-is for
--                   backward compat with the existing Settings UI)
--   is_blocked()  — IMMUTABLE helper used by callers + future RLS
--   block_user_full() — SECURITY DEFINER RPC that:
--       1. Inserts into user_blocks
--       2. Also inserts into story_blocks (full block is strict
--          superset of story block)
--       3. Removes any mutual follow rows (unfollows both ways)
--
-- Idempotent on every CREATE statement; safe to re-run.

-- 1. user_blocks table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id    UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocker_email TEXT         NOT NULL,
  blocked_email TEXT         NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_email)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker
  ON public.user_blocks(blocker_id);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked_email
  ON public.user_blocks(blocked_email);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

-- Owner-only read + write. Other users should never see whether
-- someone has blocked them (privacy + harassment resistance).
DROP POLICY IF EXISTS "user_blocks: owner read" ON public.user_blocks;
CREATE POLICY "user_blocks: owner read"
  ON public.user_blocks FOR SELECT
  TO authenticated
  USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS "user_blocks: owner insert" ON public.user_blocks;
CREATE POLICY "user_blocks: owner insert"
  ON public.user_blocks FOR INSERT
  TO authenticated
  WITH CHECK (blocker_id = auth.uid());

DROP POLICY IF EXISTS "user_blocks: owner delete" ON public.user_blocks;
CREATE POLICY "user_blocks: owner delete"
  ON public.user_blocks FOR DELETE
  TO authenticated
  USING (blocker_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;

-- 2. Helper: is_blocked(viewer_id, author_email) ───────────────────────
--
-- Returns TRUE if the viewer has blocked the author, OR if the author
-- has blocked the viewer (mutual hide). Used by the client-side feed
-- filter; future RLS additions on hub_posts can reference it directly.
CREATE OR REPLACE FUNCTION public.is_blocked(
  p_viewer_id    UUID,
  p_author_email TEXT
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks
     WHERE blocker_id = p_viewer_id
       AND lower(blocked_email) = lower(p_author_email)
  ) OR EXISTS (
    SELECT 1
      FROM public.user_blocks b
      JOIN public.user_profiles p ON p.id = p_viewer_id
     WHERE lower(b.blocker_email) = lower(p_author_email)
       AND lower(b.blocked_email) = lower(p.email)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_blocked(UUID, TEXT) TO authenticated;

-- 3. RPC: block_user_full ──────────────────────────────────────────────
--
-- One-call atomic block. Wraps the three side effects in a single
-- transaction so a partial failure can't leave the user halfway-blocked.
CREATE OR REPLACE FUNCTION public.block_user_full(
  p_blocked_email TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_blocked_email IS NULL OR length(p_blocked_email) = 0 THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;
  -- Resolve the blocker's own email for downstream side effects.
  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Don't allow blocking yourself.
  IF lower(v_email) = lower(p_blocked_email) THEN
    RAISE EXCEPTION 'cannot_block_self' USING ERRCODE = '22023';
  END IF;

  -- 1. The block itself.
  INSERT INTO public.user_blocks (blocker_id, blocker_email, blocked_email)
  VALUES (v_uid, v_email, p_blocked_email)
  ON CONFLICT (blocker_id, blocked_email) DO NOTHING;

  -- 2. Story scope is a strict subset of full block.
  INSERT INTO public.story_blocks (blocker_id, blocker_email, blocked_email)
  VALUES (v_uid, v_email, p_blocked_email)
  ON CONFLICT (blocker_id, blocked_email) DO NOTHING;

  -- 3. Unfollow both directions. Using a single DELETE per direction;
  --    hub_follows uses (follower_email, followed_email) as identity.
  DELETE FROM public.hub_follows
   WHERE (lower(follower_email) = lower(v_email)
          AND lower(followed_email) = lower(p_blocked_email))
      OR (lower(follower_email) = lower(p_blocked_email)
          AND lower(followed_email) = lower(v_email));
END;
$$;

GRANT EXECUTE ON FUNCTION public.block_user_full(TEXT) TO authenticated;

-- 4. RPC: unblock_user_full (mirror) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.unblock_user_full(
  p_blocked_email TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.user_blocks
   WHERE blocker_id = v_uid
     AND lower(blocked_email) = lower(p_blocked_email);
  -- Story-block carryover left in place — user may want to keep that
  -- scope even after a full unblock. They can clear it from the
  -- existing Settings UI separately.
END;
$$;

GRANT EXECUTE ON FUNCTION public.unblock_user_full(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
