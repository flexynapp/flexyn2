-- Gym members stop being able to read each other's emails on the gym feed,
-- and a post's comment count starts counting.
--
-- Batch 4 of 20260930150000. Every member of a gym could read author_email
-- on every post and comment in that gym's feed. Since #280 the app selects
-- both tables by explicit column list without the email and tells authors
-- apart by author_id. SELECT is now granted column by column, leaving
-- author_email out. authenticated only: anon has no policy on either table.
--
-- author_email is also filled from the author's profile now, whatever the
-- client sends. It was taken from the insert payload, and the policies check
-- only author_id, so a member could post under anybody's address.
--
-- The comment counter was an invoker trigger updating gym_feed_posts, which
-- has no UPDATE policy, so every increment matched zero rows and every post
-- showed "Comment" however many replies it had. It now runs as the owner and
-- counts the rows instead of adding one. The reaction counter is fired from
-- a SECURITY DEFINER function and already worked.
--
-- Unchanged: which rows anyone can see (policies untouched), INSERT and
-- DELETE, and the reaction, pin and moderation functions (none reads
-- author_email). Undo is GRANT SELECT ON <table> TO authenticated.

REVOKE SELECT ON public.gym_feed_posts FROM anon, authenticated;
GRANT SELECT (id, gym_id, author_id, body, media_url, like_count,
              comment_count, created_at, is_pinned, pinned_at,
              reaction_count, edited_at)
  ON public.gym_feed_posts TO authenticated;

REVOKE SELECT ON public.gym_feed_comments FROM anon, authenticated;
GRANT SELECT (id, post_id, parent_id, author_id, body, created_at, edited_at)
  ON public.gym_feed_comments TO authenticated;

CREATE OR REPLACE FUNCTION public.gym_feed_fill_author_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.author_id    := OLD.author_id;
    NEW.author_email := OLD.author_email;
    RETURN NEW;
  END IF;
  SELECT COALESCE(NULLIF(p.email, ''), NEW.author_email)
    INTO NEW.author_email
    FROM public.user_profiles p WHERE p.id = NEW.author_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.gym_feed_fill_author_email() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_gym_feed_posts_author_email ON public.gym_feed_posts;
CREATE TRIGGER trg_gym_feed_posts_author_email
  BEFORE INSERT OR UPDATE ON public.gym_feed_posts
  FOR EACH ROW EXECUTE FUNCTION public.gym_feed_fill_author_email();

DROP TRIGGER IF EXISTS trg_gym_feed_comments_author_email ON public.gym_feed_comments;
CREATE TRIGGER trg_gym_feed_comments_author_email
  BEFORE INSERT OR UPDATE ON public.gym_feed_comments
  FOR EACH ROW EXECUTE FUNCTION public.gym_feed_fill_author_email();

CREATE OR REPLACE FUNCTION public.gym_feed_comment_count_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_post uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.post_id ELSE NEW.post_id END;
BEGIN
  UPDATE public.gym_feed_posts
     SET comment_count = (SELECT count(*) FROM public.gym_feed_comments c
                           WHERE c.post_id = v_post)
   WHERE id = v_post;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.gym_feed_comment_count_sync() FROM PUBLIC, anon, authenticated;

-- Probe, run as a real signed-in gym member and rolled back. The email and
-- select * are refused; the app's own statements still work; a forged
-- author_email is replaced; and the comment count moves both ways.
DO $probe$
DECLARE
  v_me     uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_me_em  text;
  v_ot_em  text;
  v_gym    uuid;
  v_theirs uuid;
  v_post   uuid;
  v_cmt    uuid;
  v_n      int;
  v_em     text;
  v_tbl    text;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_me,    'probe_g_' || v_me    || '@probe.invalid', 'authenticated', 'authenticated'),
    (v_other, 'probe_g_' || v_other || '@probe.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.user_profiles (id, email) VALUES
    (v_me,    'probe_g_' || v_me    || '@probe.invalid'),
    (v_other, 'probe_g_' || v_other || '@probe.invalid')
  ON CONFLICT (id) DO NOTHING;
  SELECT email INTO v_me_em FROM public.user_profiles WHERE id = v_me;
  SELECT email INTO v_ot_em FROM public.user_profiles WHERE id = v_other;

  INSERT INTO public.gym_businesses (name, flexyn_code, source)
  VALUES ('Probe Gym', upper('G' || substr(md5(v_me::text), 1, 7)), 'community')
  RETURNING id INTO v_gym;
  INSERT INTO public.gym_members (gym_id, user_id, user_email) VALUES
    (v_gym, v_me, v_me_em), (v_gym, v_other, v_ot_em);
  INSERT INTO public.gym_feed_posts (gym_id, author_id, author_email, body)
  VALUES (v_gym, v_other, v_ot_em, 'probe theirs') RETURNING id INTO v_theirs;
  INSERT INTO public.gym_feed_comments (post_id, author_id, author_email, body)
  VALUES (v_theirs, v_other, v_ot_em, 'probe comment');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_me, 'role', 'authenticated', 'email', v_me_em)::text, true);
  EXECUTE 'SET LOCAL role authenticated';

  FOREACH v_tbl IN ARRAY ARRAY['gym_feed_posts', 'gym_feed_comments'] LOOP
    BEGIN
      EXECUTE format('SELECT author_email FROM public.%I LIMIT 1', v_tbl);
      RAISE EXCEPTION 'probe: %.author_email still readable', v_tbl;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE format('SELECT * FROM public.%I LIMIT 1', v_tbl);
      RAISE EXCEPTION 'probe: select * on % still allowed', v_tbl;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;

  -- gymBusinesses.js listFeedPosts / listFeedComments, as the app sends them.
  SELECT count(*) INTO v_n FROM (
    SELECT id, gym_id, author_id, body, media_url, like_count, comment_count,
           reaction_count, created_at, edited_at, is_pinned, pinned_at
      FROM public.gym_feed_posts WHERE gym_id = v_gym ORDER BY created_at DESC) s;
  IF v_n <> 1 THEN RAISE EXCEPTION 'probe: feed shows % posts', v_n; END IF;
  SELECT count(*) INTO v_n FROM (
    SELECT id, author_id, body, created_at, parent_id
      FROM public.gym_feed_comments WHERE post_id = v_theirs) s;
  IF v_n <> 1 THEN RAISE EXCEPTION 'probe: % comments', v_n; END IF;

  -- postToFeed, with somebody else's address in the payload.
  INSERT INTO public.gym_feed_posts (gym_id, author_id, author_email, body)
  VALUES (v_gym, v_me, v_ot_em, 'probe mine') RETURNING id INTO v_post;

  -- postFeedComment twice, deleteFeedComment once.
  INSERT INTO public.gym_feed_comments (post_id, author_id, author_email, body)
  VALUES (v_post, v_me, v_me_em, 'one') RETURNING id INTO v_cmt;
  INSERT INTO public.gym_feed_comments (post_id, author_id, author_email, body)
  VALUES (v_post, v_me, v_me_em, 'two');
  SELECT comment_count INTO v_n FROM public.gym_feed_posts WHERE id = v_post;
  IF v_n <> 2 THEN RAISE EXCEPTION 'probe: comment_count % after two comments', v_n; END IF;
  DELETE FROM public.gym_feed_comments WHERE id = v_cmt;
  SELECT comment_count INTO v_n FROM public.gym_feed_posts WHERE id = v_post;
  IF v_n <> 1 THEN RAISE EXCEPTION 'probe: comment_count % after a delete', v_n; END IF;

  EXECUTE 'RESET role';
  SELECT author_email INTO v_em FROM public.gym_feed_posts WHERE id = v_post;
  IF v_em IS DISTINCT FROM v_me_em THEN
    RAISE EXCEPTION 'probe: forged author_email kept (%)', v_em;
  END IF;
  EXECUTE 'SET LOCAL role authenticated';

  -- deleteFeedPost.
  DELETE FROM public.gym_feed_posts WHERE id = v_post;
  IF EXISTS (SELECT 1 FROM public.gym_feed_posts WHERE id = v_post) THEN
    RAISE EXCEPTION 'probe: post delete did nothing';
  END IF;

  RAISE EXCEPTION 'probe_ok';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
END
$probe$;
