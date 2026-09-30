-- Other people's emails stop being readable on six more shared tables.
--
-- Batch 2 of 20260930150000. Live workout sessions, poll votes, status note
-- likes, story likes, story highlights and regimen reviews are readable by
-- every signed-in user, and each row carried its owner's email. The app reads
-- them by explicit column list without the email, and since #254 the like and
-- review upserts no longer send it (a trigger fills it from the profile). Row
-- policies cannot hide a column, so SELECT is now granted column by column:
-- every column except the email one.
--
-- Unchanged: which rows anyone can see (policies are untouched, and a policy
-- may still read the email column, as the poll vote and live session write
-- policies do), plain INSERT, UPDATE and DELETE, and SECURITY DEFINER
-- functions, which run as the table owner.
--
-- The same three consequences as batch 1:
--   * select('*') on these tables now fails with 42501. Name the columns.
--   * An upsert may not set the email column. Leave it out; the triggers
--     from 20260930153000 fill it.
--   * A column added to one of these tables later is NOT readable by the
--     app until it is granted here too.
-- Undo is a plain GRANT SELECT ON <table> TO anon, authenticated.

REVOKE SELECT ON public.hub_live_sessions FROM anon, authenticated;
GRANT SELECT (id, title, started_at, ended_at, is_active, viewer_count,
              current_exercise, current_set, current_reps, created_date,
              host_user_id)
  ON public.hub_live_sessions TO anon, authenticated;

REVOKE SELECT ON public.poll_votes FROM anon, authenticated;
GRANT SELECT (id, post_id, option_index, created_at)
  ON public.poll_votes TO anon, authenticated;

REVOKE SELECT ON public.status_note_likes FROM anon, authenticated;
GRANT SELECT (id, note_id, liker_id, created_at)
  ON public.status_note_likes TO anon, authenticated;

REVOKE SELECT ON public.story_likes FROM anon, authenticated;
GRANT SELECT (id, story_id, liker_id, created_at)
  ON public.story_likes TO anon, authenticated;

REVOKE SELECT ON public.story_highlights FROM anon, authenticated;
GRANT SELECT (id, user_id, title, cover_url, sort_order, created_at, updated_at)
  ON public.story_highlights TO anon, authenticated;

REVOKE SELECT ON public.regimen_reviews FROM anon, authenticated;
GRANT SELECT (id, regimen_id, reviewer_id, rating, comment, created_at, updated_at)
  ON public.regimen_reviews TO anon, authenticated;

-- Probe, run as a real signed-in user and rolled back. The email columns and
-- select * are refused; every write the app makes on these tables still
-- works, in the shape the app makes it.
DO $probe$
DECLARE
  v_me      uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_me_em   text;
  v_ot_em   text;
  v_story   uuid;
  v_note    uuid;
  v_post    uuid;
  v_reg     uuid;
  v_session text;
  v_hl      uuid;
  v_n       int;
  v_tbl     text;
  v_col     text;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_me,    'probe_h_' || v_me    || '@probe.invalid', 'authenticated', 'authenticated'),
    (v_other, 'probe_h_' || v_other || '@probe.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.user_profiles (id, email) VALUES
    (v_me,    'probe_h_' || v_me    || '@probe.invalid'),
    (v_other, 'probe_h_' || v_other || '@probe.invalid')
  ON CONFLICT (id) DO NOTHING;
  SELECT email INTO v_me_em FROM public.user_profiles WHERE id = v_me;
  SELECT email INTO v_ot_em FROM public.user_profiles WHERE id = v_other;

  INSERT INTO public.stories (user_id, user_email, image_url)
  VALUES (v_other, v_ot_em, 'https://probe.invalid/s.jpg') RETURNING id INTO v_story;
  INSERT INTO public.status_notes (user_id, user_email, text)
  VALUES (v_other, v_ot_em, 'probe') RETURNING id INTO v_note;
  INSERT INTO public.regimens (created_by, user_id, name)
  VALUES (v_me_em, v_me, 'probe') RETURNING id INTO v_reg;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_me, 'role', 'authenticated', 'email', v_me_em)::text, true);
  EXECUTE 'SET LOCAL role authenticated';

  FOR v_tbl, v_col IN VALUES
    ('hub_live_sessions', 'host_email'),
    ('poll_votes', 'user_email'),
    ('status_note_likes', 'liker_email'),
    ('story_likes', 'liker_email'),
    ('story_highlights', 'user_email'),
    ('regimen_reviews', 'reviewer_email')
  LOOP
    BEGIN
      EXECUTE format('SELECT %I FROM public.%I LIMIT 1', v_col, v_tbl);
      RAISE EXCEPTION 'probe: %.% still readable', v_tbl, v_col;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE format('SELECT * FROM public.%I LIMIT 1', v_tbl);
      RAISE EXCEPTION 'probe: select * on % still allowed', v_tbl;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;

  -- hubLiveSessions.js: start (insert with the email, read back id), update
  -- by id, list with LIVE_COLUMNS, end.
  INSERT INTO public.hub_live_sessions (host_email, title)
  VALUES (v_me_em, 'probe') RETURNING id INTO v_session;
  UPDATE public.hub_live_sessions
     SET current_exercise = 'Squat', current_set = 1, current_reps = 5
   WHERE id = v_session;
  SELECT count(*) INTO v_n FROM (
    SELECT id, host_user_id, title, started_at, is_active, viewer_count,
           current_exercise, current_set, current_reps
      FROM public.hub_live_sessions
     WHERE is_active AND host_user_id = v_me AND current_exercise = 'Squat') s;
  IF v_n <> 1 THEN RAISE EXCEPTION 'probe: live session not written or not readable (%)', v_n; END IF;
  UPDATE public.hub_live_sessions SET is_active = false, ended_at = now() WHERE id = v_session;

  -- HubPostCard: vote, then count votes and read the timeline.
  INSERT INTO public.hub_posts (created_by, user_id, body, privacy)
  VALUES (v_me_em, v_me, 'probe', 'public') RETURNING id INTO v_post;
  INSERT INTO public.poll_votes (post_id, user_email, option_index)
  VALUES (v_post::text, v_me_em, 0);
  SELECT count(*) INTO v_n FROM (
    SELECT option_index, created_at FROM public.poll_votes WHERE post_id = v_post::text) s;
  IF v_n <> 1 THEN RAISE EXCEPTION 'probe: poll vote count %', v_n; END IF;

  -- Likes: the app's upserts, the reads, and unlike.
  INSERT INTO public.status_note_likes (note_id, liker_id) VALUES (v_note, v_me)
  ON CONFLICT (note_id, liker_id) DO UPDATE
    SET note_id = EXCLUDED.note_id, liker_id = EXCLUDED.liker_id;
  INSERT INTO public.story_likes (story_id, liker_id) VALUES (v_story, v_me)
  ON CONFLICT (story_id, liker_id) DO NOTHING;
  PERFORM id FROM public.status_note_likes WHERE note_id = v_note AND liker_id = v_me;
  PERFORM liker_id, created_at FROM public.story_likes WHERE story_id = v_story;
  DELETE FROM public.story_likes WHERE story_id = v_story AND liker_id = v_me;
  DELETE FROM public.status_note_likes WHERE note_id = v_note AND liker_id = v_me;
  IF EXISTS (SELECT 1 FROM public.story_likes WHERE story_id = v_story)
     OR EXISTS (SELECT 1 FROM public.status_note_likes WHERE note_id = v_note) THEN
    RAISE EXCEPTION 'probe: unlike did nothing';
  END IF;

  -- storyHighlights.js: create (read back id), list, delete.
  INSERT INTO public.story_highlights (user_id, user_email, title)
  VALUES (v_me, v_me_em, 'probe') RETURNING id INTO v_hl;
  PERFORM id, title, cover_url, sort_order, created_at
     FROM public.story_highlights WHERE user_id = v_me;
  DELETE FROM public.story_highlights WHERE id = v_hl;
  IF EXISTS (SELECT 1 FROM public.story_highlights WHERE id = v_hl) THEN
    RAISE EXCEPTION 'probe: highlight delete did nothing';
  END IF;

  -- regimenReviews.js: upsert twice (insert, then update), list, the
  -- aggregate view (security_invoker), and my review.
  INSERT INTO public.regimen_reviews (regimen_id, reviewer_id, rating, comment)
  VALUES (v_reg, v_me, 4, 'probe')
  ON CONFLICT (regimen_id, reviewer_id) DO UPDATE
    SET regimen_id = EXCLUDED.regimen_id, reviewer_id = EXCLUDED.reviewer_id,
        rating = EXCLUDED.rating, comment = EXCLUDED.comment;
  INSERT INTO public.regimen_reviews (regimen_id, reviewer_id, rating, comment)
  VALUES (v_reg, v_me, 5, 'probe')
  ON CONFLICT (regimen_id, reviewer_id) DO UPDATE
    SET regimen_id = EXCLUDED.regimen_id, reviewer_id = EXCLUDED.reviewer_id,
        rating = EXCLUDED.rating, comment = EXCLUDED.comment;
  PERFORM id, reviewer_id, rating, comment, created_at, updated_at
     FROM public.regimen_reviews WHERE regimen_id = v_reg;
  SELECT review_count INTO v_n FROM public.regimen_review_aggregates WHERE regimen_id = v_reg;
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'probe: review aggregate %', v_n; END IF;
  SELECT rating INTO v_n FROM public.regimen_reviews
   WHERE regimen_id = v_reg AND reviewer_id = v_me;
  IF v_n IS DISTINCT FROM 5 THEN RAISE EXCEPTION 'probe: review update gave %', v_n; END IF;

  EXECUTE 'RESET role';
  RAISE EXCEPTION 'probe_ok';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
END;
$probe$;
