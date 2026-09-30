-- Other people's emails stop being readable on follows, posts, comments,
-- comment likes, stories, status notes, the food catalogue and workout
-- templates.
--
-- Batch 5 of 20260930150000, and the widest. Any signed-in user could read:
--   hub_follows        follower_email, followee_email, created_by
--                      (the whole follow graph, both ends)
--   hub_posts          author_email, collaborator_emails, created_by
--   hub_comments       author_email, created_by
--   hub_comment_likes  created_by (readable by everyone, no conditions)
--   stories            user_email
--   status_notes       user_email (every active note, no conditions)
--   food_items         created_by (every row with a barcode)
--   workout_templates  created_by (every public template)
-- for every row their policies let them see. Since #283 the app names its
-- columns on all eight tables and matches people by user id; nothing renders
-- or filters on these columns.
--
-- Unchanged: which rows anyone can see. The read policies still use the
-- email columns (viewer_is_blocked_by(author_email), can_view_story(..),
-- viewer_can_see_activity(follower_email)); a policy reads a column whatever
-- the caller's column grants. Plain INSERT, UPDATE and DELETE keep working,
-- and the email columns keep being filled by pin_social_row_identity,
-- hub_follows_populate_ids and sync_post_collaborator_ids, all SECURITY
-- DEFINER. No SECURITY INVOKER function or view reads these tables (checked
-- against production on 2026-09-30). anon has no policy on any of them, so
-- it is left with no SELECT at all.
--
-- The same consequences as the earlier batches: select('*'), a bare
-- .select() after a write, and a filter on an email column now fail with
-- 42501; a column added later is unreadable until it is granted here.
-- Undo is GRANT SELECT ON <table> TO authenticated.

REVOKE SELECT ON public.hub_follows FROM anon, authenticated;
GRANT SELECT (id, user_id, follower_id, followee_id, created_at, created_date)
  ON public.hub_follows TO authenticated;

REVOKE SELECT ON public.hub_posts FROM anon, authenticated;
GRANT SELECT (id, user_id, author_name, author_avatar, author_avatar_url,
              content, body, image_url, video_url, workout_log_id,
              likes_count, like_count, dislike_count, comments_count,
              comment_count, emoji_reaction_count, created_at, created_date,
              updated_at, edited_at, publish_at, post_type, privacy, crew_id,
              linked_entity_type, linked_entity_id, linked_entity_snapshot,
              original_post_id, hashtags, content_warning,
              content_warning_label, collaborator_ids)
  ON public.hub_posts TO authenticated;

REVOKE SELECT ON public.hub_comments FROM anon, authenticated;
GRANT SELECT (id, user_id, post_id, parent_comment_id, author_name,
              author_avatar, content, body, likes_count, like_count,
              created_at, created_date, updated_at)
  ON public.hub_comments TO authenticated;

REVOKE SELECT ON public.hub_comment_likes FROM anon, authenticated;
GRANT SELECT (id, user_id, comment_id, created_at, created_date)
  ON public.hub_comment_likes TO authenticated;

REVOKE SELECT ON public.stories FROM anon, authenticated;
GRANT SELECT (id, user_id, image_url, media_type, overlay_text, overlay_style,
              overlays, privacy, crew_id, created_at, expires_at)
  ON public.stories TO authenticated;

REVOKE SELECT ON public.status_notes FROM anon, authenticated;
GRANT SELECT (id, user_id, text, created_at, expires_at)
  ON public.status_notes TO authenticated;

REVOKE SELECT ON public.food_items FROM anon, authenticated;
GRANT SELECT (id, user_id, name, brand, barcode, serving_label, calories,
              protein, carbs, fat, fiber, sodium, is_verified, created_at,
              updated_at, created_date, nutrition, vitamins, source)
  ON public.food_items TO authenticated;

REVOKE SELECT ON public.workout_templates FROM anon, authenticated;
GRANT SELECT (id, user_id, name, description, exercises, is_public,
              created_at, updated_at, created_date, copy_count,
              original_template_id, original_author_username, author_username)
  ON public.workout_templates TO authenticated;

-- Probe, run as a real signed-in user and rolled back. Every email column is
-- refused, select * is refused, and the statements the app sends still work:
-- follow and unfollow by id, the follow list, post and read posts, comment,
-- like a comment, read likes, post a story, read stories, post a note, read
-- notes.
DO $probe$
DECLARE
  v_me     uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_me_em  text;
  v_ot_em  text;
  v_post   uuid;
  v_theirs uuid;
  v_cmt    uuid;
  v_id     uuid;
  v_n      int;
  v_tbl    text;
  v_col    text;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_me,    'probe_s_' || v_me    || '@probe.invalid', 'authenticated', 'authenticated'),
    (v_other, 'probe_s_' || v_other || '@probe.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.user_profiles (id, email, username) VALUES
    (v_me,    'probe_s_' || v_me    || '@probe.invalid', 'probe_s_' || left(v_me::text, 8)),
    (v_other, 'probe_s_' || v_other || '@probe.invalid', 'probe_s_' || left(v_other::text, 8))
  ON CONFLICT (id) DO NOTHING;
  SELECT email INTO v_me_em FROM public.user_profiles WHERE id = v_me;
  SELECT email INTO v_ot_em FROM public.user_profiles WHERE id = v_other;

  -- The other user's public post, a follow of me, a story and a note.
  INSERT INTO public.hub_posts (created_by, user_id, author_email, body, privacy)
  VALUES (v_ot_em, v_other, v_ot_em, 'probe theirs', 'public') RETURNING id INTO v_theirs;
  INSERT INTO public.hub_follows (created_by, user_id, follower_id, followee_id)
  VALUES (v_ot_em, v_other, v_other, v_me);
  INSERT INTO public.stories (user_id, user_email, image_url, privacy, expires_at)
  VALUES (v_other, v_ot_em, 'https://probe.invalid/s.jpg', 'public', now() + interval '1 day');
  INSERT INTO public.status_notes (user_id, user_email, text, expires_at)
  VALUES (v_other, v_ot_em, 'probe note', now() + interval '1 day');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_me, 'role', 'authenticated', 'email', v_me_em)::text, true);
  EXECUTE 'SET LOCAL role authenticated';

  FOR v_tbl, v_col IN VALUES
    ('hub_follows', 'follower_email'), ('hub_follows', 'followee_email'),
    ('hub_follows', 'created_by'),
    ('hub_posts', 'author_email'), ('hub_posts', 'collaborator_emails'),
    ('hub_posts', 'created_by'),
    ('hub_comments', 'author_email'), ('hub_comments', 'created_by'),
    ('hub_comment_likes', 'created_by'),
    ('stories', 'user_email'),
    ('status_notes', 'user_email'),
    ('food_items', 'created_by'),
    ('workout_templates', 'created_by')
  LOOP
    BEGIN
      EXECUTE format('SELECT %I FROM public.%I LIMIT 1', v_col, v_tbl);
      RAISE EXCEPTION 'probe: %.% still readable', v_tbl, v_col;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  FOREACH v_tbl IN ARRAY ARRAY['hub_follows', 'hub_posts', 'hub_comments',
                               'hub_comment_likes', 'stories', 'status_notes',
                               'food_items', 'workout_templates'] LOOP
    BEGIN
      EXECUTE format('SELECT * FROM public.%I LIMIT 1', v_tbl);
      RAISE EXCEPTION 'probe: select * on % still allowed', v_tbl;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;

  -- hubFollows.js: follow (ownedRows sends created_by and user_id, returns
  -- FOLLOW_COLUMNS), isFollowing, listFollowersIds, unfollow.
  INSERT INTO public.hub_follows (created_by, user_id, follower_id, followee_id)
  VALUES (v_me_em, v_me, v_me, v_other)
  RETURNING id INTO v_id;
  SELECT count(*) INTO v_n FROM (
    SELECT id, user_id, follower_id, followee_id, created_at, created_date
      FROM public.hub_follows WHERE follower_id = v_me AND followee_id = v_other) s;
  IF v_n <> 1 THEN RAISE EXCEPTION 'probe: my follow not found (%)', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.hub_follows WHERE followee_id = v_me;
  IF v_n <> 1 THEN RAISE EXCEPTION 'probe: follower not listed (%)', v_n; END IF;
  DELETE FROM public.hub_follows WHERE id = v_id;
  IF EXISTS (SELECT 1 FROM public.hub_follows WHERE id = v_id) THEN
    RAISE EXCEPTION 'probe: unfollow did nothing';
  END IF;

  -- hubPosts.js: create, the public feed, update, and the author's email is
  -- still filled in by the database.
  INSERT INTO public.hub_posts (created_by, user_id, author_email, body, privacy)
  VALUES (v_me_em, v_me, v_me_em, 'probe mine', 'public') RETURNING id INTO v_post;
  SELECT count(*) INTO v_n FROM (
    SELECT id, user_id, body, privacy, collaborator_ids, created_date
      FROM public.hub_posts WHERE privacy = 'public' AND id IN (v_post, v_theirs)) s;
  IF v_n <> 2 THEN RAISE EXCEPTION 'probe: feed shows % posts', v_n; END IF;
  UPDATE public.hub_posts SET body = 'probe edited' WHERE id = v_post RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'probe: post edit did nothing'; END IF;

  -- hubComments.js and hubCommentLikes.js: comment on their post, like it,
  -- read my likes by user id.
  INSERT INTO public.hub_comments (created_by, user_id, post_id, body)
  VALUES (v_me_em, v_me, v_theirs, 'probe comment') RETURNING id INTO v_cmt;
  SELECT count(*) INTO v_n FROM (
    SELECT id, user_id, post_id, body FROM public.hub_comments WHERE post_id = v_theirs) s;
  IF v_n <> 1 THEN RAISE EXCEPTION 'probe: % comments', v_n; END IF;
  INSERT INTO public.hub_comment_likes (created_by, user_id, comment_id)
  VALUES (v_me_em, v_me, v_cmt);
  SELECT count(*) INTO v_n FROM (
    SELECT id, user_id, comment_id FROM public.hub_comment_likes
     WHERE user_id = v_me AND comment_id IN (v_cmt)) s;
  IF v_n <> 1 THEN RAISE EXCEPTION 'probe: like not found (%)', v_n; END IF;

  -- stories.js and statusNotes.js.
  INSERT INTO public.stories (user_id, user_email, image_url, privacy, expires_at)
  VALUES (v_me, v_me_em, 'https://probe.invalid/m.jpg', 'public', now() + interval '1 day');
  SELECT count(*) INTO v_n FROM (
    SELECT id, user_id, image_url, privacy, expires_at FROM public.stories
     WHERE user_id IN (v_me, v_other) AND crew_id IS NULL AND expires_at > now()) s;
  IF v_n <> 2 THEN RAISE EXCEPTION 'probe: % stories visible', v_n; END IF;
  INSERT INTO public.status_notes (user_id, user_email, text)
  VALUES (v_me, v_me_em, 'mine');
  SELECT count(*) INTO v_n FROM (
    SELECT id, user_id, text, created_at, expires_at FROM public.status_notes
     WHERE user_id IN (v_me, v_other) AND expires_at > now()) s;
  IF v_n <> 2 THEN RAISE EXCEPTION 'probe: % notes visible', v_n; END IF;

  EXECUTE 'RESET role';
  SELECT count(*) INTO v_n FROM public.hub_posts
   WHERE id = v_post AND author_email = v_me_em;
  IF v_n <> 1 THEN RAISE EXCEPTION 'probe: post author_email not filled'; END IF;

  RAISE EXCEPTION 'probe_ok';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
END
$probe$;
