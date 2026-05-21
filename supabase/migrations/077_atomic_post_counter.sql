-- 077_atomic_post_counter.sql
--
-- Closes the read-modify-write race in src/lib/data/hubPosts.js
-- incrementCounter, called from every like / unlike / comment add /
-- comment delete:
--
--   const post = await get(postId);
--   const next = Math.max(0, Number(post[field] || 0) + delta);
--   await update(postId, { [field]: next });
--
-- The comment in hubPosts.js even says "NOT race-safe — flagged in
-- BACKEND_CONTRACT as needing atomic increment". Two simultaneous
-- likes both read the same like_count, both compute current+1, both
-- write — one like is lost. Hot posts where many users tap "like"
-- in the same second silently undercount.
--
-- Atomic RPC uses delta arithmetic server-side. The caller passes
-- (post_id, field_name, delta); the function validates the field
-- against a whitelist (so a malicious client can't pass arbitrary
-- column names) and runs UPDATE SET <field> = GREATEST(0, <field> + delta).
-- The clamp at 0 matches the previous client-side Math.max behavior.

CREATE OR REPLACE FUNCTION public.increment_hub_post_counter(
  p_post_id UUID,
  p_field   TEXT,
  p_delta   INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_new_value INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_post_id IS NULL OR p_field IS NULL OR p_delta IS NULL THEN
    RAISE EXCEPTION 'post_id, field, and delta required' USING ERRCODE = '22023';
  END IF;

  -- Whitelist the field name. SECURITY DEFINER + dynamic SQL would
  -- otherwise allow arbitrary column writes; the whitelist closes
  -- that surface. These are the only counters hubPosts.incrementCounter
  -- ever bumps in src/lib/data/hubPosts.js + hubComments.js.
  IF p_field NOT IN ('like_count', 'dislike_count', 'comment_count') THEN
    RAISE EXCEPTION 'invalid field: %', p_field USING ERRCODE = '22023';
  END IF;

  -- Delta arithmetic clamped at 0. EXECUTE is safe here because p_field
  -- is whitelisted above.
  EXECUTE format(
    'UPDATE public.hub_posts SET %I = GREATEST(0, COALESCE(%I, 0) + $1) WHERE id = $2 RETURNING %I',
    p_field, p_field, p_field
  ) USING p_delta, p_post_id INTO v_new_value;

  IF v_new_value IS NULL THEN
    -- Either the post doesn't exist or RLS hid it from this caller.
    RAISE EXCEPTION 'post not found' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'success',   TRUE,
    'post_id',   p_post_id,
    'field',     p_field,
    'new_value', v_new_value
  );
END;
$$;

REVOKE ALL  ON FUNCTION public.increment_hub_post_counter(UUID, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_hub_post_counter(UUID, TEXT, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
