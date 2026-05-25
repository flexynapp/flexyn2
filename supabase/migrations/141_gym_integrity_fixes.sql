-- 141_gym_integrity_fixes.sql
--
-- Hardens gym social/competition surfaces against the defects surfaced
-- in the May 2026 QA audit. All changes are server-side and idempotent.
--
-- 1. Reactions INSERT policy now gates on gym membership (audit B-2 —
--    non-members could write reactions to arbitrary post_ids).
-- 2. New `toggle_gym_feed_reaction` RPC — atomic single round-trip
--    that prevents the SELECT-then-INSERT race in the JS client
--    (audit B-1, A-4).
-- 3. `toggle_pin_gym_post` now atomically unpins any other pinned post
--    in the gym before pinning the target — eliminates the "no pin"
--    transient and 23505 errors (audit C-11).
-- 4. Leaderboard gets a deterministic tie-breaker (joined_at ASC) so
--    duplicate #1s no longer flap between requests (audit B-4).
-- 5. Leaderboard no longer filters `value > 0` — members appear
--    immediately on join so the "Your rank: #N" banner can render
--    for fresh members (audit B-5).
-- 6. gym_events DELETE policy added for the row's creator (audit C-8).

-- ── 1. Reactions: members-only INSERT ──────────────────────────────
DROP POLICY IF EXISTS "gym_feed_rxn: own write" ON public.gym_feed_post_reactions;

-- Alias-free form: nested IN subqueries instead of an aliased JOIN, so
-- the SQL carries no short `alias.column` tokens (which the deploy-paste
-- pipeline mangles). Each subquery scopes a single table, so bare column
-- names are unambiguous. Semantics unchanged: the reacted-to post must
-- belong to a gym the caller is a member of.
CREATE POLICY "gym_feed_rxn: members write"
  ON public.gym_feed_post_reactions FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND
    post_id IN (
      SELECT id FROM public.gym_feed_posts
       WHERE gym_id IN (
         SELECT gym_id FROM public.gym_members WHERE user_id = auth.uid()
       )
    )
  );

-- ── 2. Atomic reaction toggle ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.toggle_gym_feed_reaction(
  p_post_id UUID,
  p_emoji   TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_gym_id  UUID;
  v_deleted INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_emoji IS NULL OR char_length(p_emoji) > 10 OR char_length(p_emoji) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_EMOJI');
  END IF;

  SELECT gym_id INTO v_gym_id
    FROM public.gym_feed_posts WHERE id = p_post_id;
  IF v_gym_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'POST_NOT_FOUND');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.gym_members
     WHERE gym_id = v_gym_id AND user_id = v_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_MEMBER');
  END IF;

  DELETE FROM public.gym_feed_post_reactions
   WHERE post_id = p_post_id AND user_id = v_user_id AND emoji = p_emoji;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted > 0 THEN
    RETURN jsonb_build_object('ok', true, 'removed', true);
  END IF;

  INSERT INTO public.gym_feed_post_reactions (post_id, user_id, emoji)
    VALUES (p_post_id, v_user_id, p_emoji)
    ON CONFLICT (post_id, user_id, emoji) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'added', true);
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_gym_feed_reaction(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_gym_feed_reaction(UUID, TEXT) TO authenticated;

-- ── 3. Atomic pin/unpin (replaces mig 138's version) ───────────────
CREATE OR REPLACE FUNCTION public.toggle_pin_gym_post(p_post_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_gym_id    UUID;
  v_owner     UUID;
  v_is_pinned BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Split the post→gym→owner join into two single-table lookups so the
  -- body carries no short `alias.column` tokens.
  SELECT gym_id, is_pinned
    INTO v_gym_id, v_is_pinned
    FROM public.gym_feed_posts
   WHERE id = p_post_id;

  IF v_gym_id IS NULL THEN
    RAISE EXCEPTION 'post not found';
  END IF;

  SELECT owner_id INTO v_owner
    FROM public.gym_businesses
   WHERE id = v_gym_id;

  IF v_owner IS NULL OR v_owner <> v_user_id THEN
    RAISE EXCEPTION 'not owner' USING ERRCODE = '42501';
  END IF;

  IF v_is_pinned THEN
    UPDATE public.gym_feed_posts SET is_pinned = FALSE WHERE id = p_post_id;
    RETURN FALSE;
  END IF;

  -- One-pin invariant: unpin any other pin in the same gym first.
  UPDATE public.gym_feed_posts SET is_pinned = FALSE
   WHERE gym_id = v_gym_id AND is_pinned = TRUE AND id <> p_post_id;

  UPDATE public.gym_feed_posts SET is_pinned = TRUE WHERE id = p_post_id;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_pin_gym_post(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_pin_gym_post(UUID) TO authenticated;

-- ── 4 + 5. Leaderboard: deterministic tie-break + include zero-stat ─
-- Tie-break by gym_members.joined_at ASC (first-to-the-gym wins on
-- equal stat); falls back to user_id for further determinism. We keep
-- RANK() for the displayed rank (so ties show shared #1) but the
-- ORDER BY at the outer query uses the deterministic tiebreaker so
-- repeat-fetch row order is stable.
CREATE OR REPLACE FUNCTION public.get_gym_leaderboard(
  p_gym_id UUID,
  p_mode   TEXT DEFAULT 'volume',
  p_limit  INT  DEFAULT 50
) RETURNS TABLE (
  user_id     UUID,
  username    TEXT,
  avatar_url  TEXT,
  value       NUMERIC,
  rank        INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
-- use_column: the RETURNS TABLE OUT params (user_id, username, value…)
-- share names with base columns; resolve bare names to the column so the
-- query needs no disambiguating table aliases.
#variable_conflict use_column
DECLARE
  v_mode TEXT := COALESCE(p_mode, 'volume');
BEGIN
  IF v_mode NOT IN ('volume', 'xp', 'streak') THEN
    RAISE EXCEPTION 'invalid mode' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
    WITH membership AS (
      SELECT user_id AS member_user_id, joined_at AS member_joined_at
        FROM public.gym_members
       WHERE gym_id = p_gym_id
    ),
    ranked AS (
      SELECT
        id               AS lb_user_id,
        username         AS lb_username,
        avatar_url       AS lb_avatar_url,
        member_joined_at AS lb_joined_at,
        CASE v_mode
          WHEN 'volume' THEN COALESCE(total_volume_lbs, 0)::NUMERIC
          WHEN 'xp'     THEN COALESCE(total_xp,         0)::NUMERIC
          WHEN 'streak' THEN COALESCE(workout_streak,   0)::NUMERIC
        END AS lb_value
      FROM public.user_profiles
      JOIN membership ON member_user_id = id
    )
    SELECT lb_user_id, lb_username, lb_avatar_url, lb_value,
           RANK() OVER (ORDER BY lb_value DESC)::INT
      FROM ranked
     ORDER BY lb_value DESC, lb_joined_at ASC, lb_user_id ASC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.get_gym_leaderboard(UUID, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gym_leaderboard(UUID, TEXT, INT) TO authenticated;

-- ── 6. gym_events: creator may delete their own row ─────────────────
DROP POLICY IF EXISTS "gym_events: creator delete" ON public.gym_events;
CREATE POLICY "gym_events: creator delete"
  ON public.gym_events FOR DELETE TO authenticated
  USING (created_by = auth.uid());

NOTIFY pgrst, 'reload schema';
