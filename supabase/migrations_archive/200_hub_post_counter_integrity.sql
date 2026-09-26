-- 200_hub_post_counter_integrity.sql
--
-- increment_hub_post_counter(p_post_id, p_field, p_delta) let any signed-in
-- user change ANY post's like_count / dislike_count / comment_count by an
-- arbitrary delta — decoupled from the real hub_reactions / hub_comments
-- rows. Since the feed sorts by like_count (HubFeed.jsx), this enabled
-- fake-engagement / feed-ranking manipulation and harassment (zero out or
-- inflate a rival's counts). (SQL-injection was already prevented by the
-- field whitelist + %I; the hole was the trusted delta.)
--
-- Fix: the RPC now RECOMPUTES the counter from the source rows and ignores
-- p_delta, so a call can only re-sync the denormalized count to reality.
-- Call-compatible with the existing client (it still calls this after
-- inserting/deleting a reaction or comment) — no client change needed.
-- A companion guard makes the counter columns RPC-only so a user can't
-- bypass the RPC by directly UPDATE-ing their own post's counts.

CREATE OR REPLACE FUNCTION public.increment_hub_post_counter(p_post_id uuid, p_field text, p_delta integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_new_value INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_post_id IS NULL OR p_field IS NULL THEN
    RAISE EXCEPTION 'post_id and field required' USING ERRCODE = '22023';
  END IF;

  -- p_delta is intentionally ignored — counters are recomputed from source.
  IF p_field = 'like_count' THEN
    UPDATE public.hub_posts
       SET like_count = (SELECT count(*) FROM public.hub_reactions
                          WHERE post_id = p_post_id AND reaction_type = 'like')
     WHERE id = p_post_id
     RETURNING like_count INTO v_new_value;
  ELSIF p_field = 'dislike_count' THEN
    UPDATE public.hub_posts
       SET dislike_count = (SELECT count(*) FROM public.hub_reactions
                            WHERE post_id = p_post_id AND reaction_type = 'dislike')
     WHERE id = p_post_id
     RETURNING dislike_count INTO v_new_value;
  ELSIF p_field = 'comment_count' THEN
    UPDATE public.hub_posts
       SET comment_count = (SELECT count(*) FROM public.hub_comments
                            WHERE post_id = p_post_id)
     WHERE id = p_post_id
     RETURNING comment_count INTO v_new_value;
  ELSE
    RAISE EXCEPTION 'invalid field: %', p_field USING ERRCODE = '22023';
  END IF;

  IF v_new_value IS NULL THEN
    RAISE EXCEPTION 'post not found' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'post_id', p_post_id,
                            'field', p_field, 'new_value', v_new_value);
END;
$function$;

-- ── Counters are RPC-only ──────────────────────────────────────────────
-- Block a user from directly UPDATE-ing their own post's counters (they can
-- edit their post content, but not the like/dislike/comment tallies), and
-- force new posts to start at 0. The recompute RPC runs as definer and
-- bypasses this guard.
CREATE OR REPLACE FUNCTION public.hub_posts_guard_counters()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.like_count    := 0;
    NEW.dislike_count := 0;
    NEW.comment_count := 0;
    RETURN NEW;
  END IF;

  IF NEW.like_count    IS DISTINCT FROM OLD.like_count
     OR NEW.dislike_count IS DISTINCT FROM OLD.dislike_count
     OR NEW.comment_count IS DISTINCT FROM OLD.comment_count THEN
    RAISE EXCEPTION 'post counters are RPC-only (use increment_hub_post_counter)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS hub_posts_guard_counters_tr ON public.hub_posts;
CREATE TRIGGER hub_posts_guard_counters_tr
  BEFORE INSERT OR UPDATE ON public.hub_posts
  FOR EACH ROW EXECUTE FUNCTION public.hub_posts_guard_counters();
