-- The database, not the app, writes the email on likes and regimen reviews.
--
-- status_note_likes.liker_email, story_likes.liker_email and
-- regimen_reviews.reviewer_email are about to stop being readable by other
-- users (column-level SELECT, the same move as 20260930150000). All three are
-- written with an upsert, and Postgres needs SELECT on every column an
-- ON CONFLICT DO UPDATE sets from EXCLUDED, so an upsert that still sends the
-- email would be refused. The app now leaves the column out and these
-- triggers fill it from the caller's profile. Whatever a client sends is
-- replaced, so the column also stops being something a client can forge.
--
-- That matters most on regimen_reviews: enforce_review_adoption decided
-- whether you had copied a regimen by comparing regimens.created_by with the
-- email the CLIENT sent. Sending the address of someone who had copied it
-- passed the check. The pin trigger runs first (triggers fire in name order,
-- and regimen_reviews_a_pin_email sorts before trg_enforce_review_adoption),
-- and the check now also matches on user id, so a guest, whose regimens carry
-- no real email, can review a regimen they copied.

CREATE OR REPLACE FUNCTION public.pin_like_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  NEW.liker_email := COALESCE(
    (SELECT email FROM public.user_profiles WHERE id = NEW.liker_id),
    NULLIF(NEW.liker_email, ''),
    '');
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.pin_regimen_review_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  NEW.reviewer_email := COALESCE(
    (SELECT email FROM public.user_profiles WHERE id = NEW.reviewer_id),
    NULLIF(NEW.reviewer_email, ''),
    '');
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.pin_like_email() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pin_regimen_review_email() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS status_note_likes_a_pin_email ON public.status_note_likes;
CREATE TRIGGER status_note_likes_a_pin_email
  BEFORE INSERT OR UPDATE ON public.status_note_likes
  FOR EACH ROW EXECUTE FUNCTION public.pin_like_email();

DROP TRIGGER IF EXISTS story_likes_a_pin_email ON public.story_likes;
CREATE TRIGGER story_likes_a_pin_email
  BEFORE INSERT OR UPDATE ON public.story_likes
  FOR EACH ROW EXECUTE FUNCTION public.pin_like_email();

DROP TRIGGER IF EXISTS regimen_reviews_a_pin_email ON public.regimen_reviews;
CREATE TRIGGER regimen_reviews_a_pin_email
  BEFORE INSERT OR UPDATE ON public.regimen_reviews
  FOR EACH ROW EXECUTE FUNCTION public.pin_regimen_review_email();

CREATE OR REPLACE FUNCTION public.enforce_review_adoption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_owner  BOOLEAN;
  v_cloned BOOLEAN;
BEGIN
  SELECT COALESCE(user_id = NEW.reviewer_id, FALSE)
      OR COALESCE(created_by = NEW.reviewer_email, FALSE)
    INTO v_owner
    FROM public.regimens WHERE id = NEW.regimen_id;
  IF v_owner THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.regimens
     WHERE original_template_id = NEW.regimen_id
       AND (user_id = NEW.reviewer_id OR created_by = NEW.reviewer_email)
  ) INTO v_cloned;

  IF NOT v_cloned THEN
    RAISE EXCEPTION 'review_requires_adoption'
      USING ERRCODE = '42501',
            HINT    = 'Copy this regimen to your own list before reviewing.';
  END IF;

  RETURN NEW;
END;
$fn$;

-- Probe, run as a real signed-in user and rolled back.
--   Likes placed the way the app now places them (no email, upsert) store
--   the liker's own email, and a forged one is replaced.
--   A review of a regimen the caller copied (matched by user id, with a
--   created_by that is not their email) is accepted and stores their email.
--   A review of a regimen they did not copy is refused, even when they send
--   the email of someone who did.
DO $probe$
DECLARE
  v_me     uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_me_em  text;
  v_ot_em  text;
  v_story  uuid;
  v_note   uuid;
  v_reg_a  uuid;
  v_reg_b  uuid;
  v_em     text;
  v_n      int;
  v_refused boolean := false;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_me,    'probe_l_' || v_me    || '@probe.invalid', 'authenticated', 'authenticated'),
    (v_other, 'probe_l_' || v_other || '@probe.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.user_profiles (id, email) VALUES
    (v_me,    'probe_l_' || v_me    || '@probe.invalid'),
    (v_other, 'probe_l_' || v_other || '@probe.invalid')
  ON CONFLICT (id) DO NOTHING;
  SELECT email INTO v_me_em FROM public.user_profiles WHERE id = v_me;
  SELECT email INTO v_ot_em FROM public.user_profiles WHERE id = v_other;

  INSERT INTO public.stories (user_id, user_email, image_url)
  VALUES (v_other, v_ot_em, 'https://probe.invalid/s.jpg') RETURNING id INTO v_story;
  INSERT INTO public.status_notes (user_id, user_email, text)
  VALUES (v_other, v_ot_em, 'probe') RETURNING id INTO v_note;

  -- Two templates by the other user. I copied A (my copy carries my user id
  -- and a created_by that is not my email). The other user copied B.
  INSERT INTO public.regimens (created_by, user_id, name)
  VALUES (v_ot_em, v_other, 'probe A') RETURNING id INTO v_reg_a;
  INSERT INTO public.regimens (created_by, user_id, name)
  VALUES (v_ot_em, v_other, 'probe B') RETURNING id INTO v_reg_b;
  INSERT INTO public.regimens (created_by, user_id, name, original_template_id)
  VALUES ('', v_me, 'probe A copy', v_reg_a);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_me, 'role', 'authenticated', 'email', v_me_em)::text, true);
  EXECUTE 'SET LOCAL role authenticated';

  -- The app's shapes.
  INSERT INTO public.story_likes (story_id, liker_id)
  VALUES (v_story, v_me)
  ON CONFLICT (story_id, liker_id) DO NOTHING;

  INSERT INTO public.status_note_likes (note_id, liker_id)
  VALUES (v_note, v_me)
  ON CONFLICT (note_id, liker_id) DO UPDATE
    SET note_id = EXCLUDED.note_id, liker_id = EXCLUDED.liker_id;
  INSERT INTO public.status_note_likes (note_id, liker_id)
  VALUES (v_note, v_me)
  ON CONFLICT (note_id, liker_id) DO UPDATE
    SET note_id = EXCLUDED.note_id, liker_id = EXCLUDED.liker_id;

  INSERT INTO public.regimen_reviews (regimen_id, reviewer_id, rating, comment)
  VALUES (v_reg_a, v_me, 5, 'probe')
  ON CONFLICT (regimen_id, reviewer_id) DO UPDATE
    SET rating = EXCLUDED.rating, comment = EXCLUDED.comment;

  -- An old client sending a forged address on a like.
  INSERT INTO public.status_note_likes (note_id, liker_id, liker_email)
  VALUES (v_note, v_me, 'victim@else.invalid')
  ON CONFLICT (note_id, liker_id) DO UPDATE SET liker_email = EXCLUDED.liker_email;

  -- Reviewing B, which I never copied, while claiming to be the other user.
  BEGIN
    INSERT INTO public.regimen_reviews (regimen_id, reviewer_id, reviewer_email, rating)
    VALUES (v_reg_b, v_me, v_ot_em, 5);
  EXCEPTION WHEN insufficient_privilege THEN
    v_refused := true;
  END;

  EXECUTE 'RESET role';

  IF NOT v_refused THEN
    RAISE EXCEPTION 'probe: a review of an uncopied regimen with a borrowed email was accepted';
  END IF;

  SELECT count(*), max(liker_email) INTO v_n, v_em
    FROM public.story_likes WHERE story_id = v_story;
  IF v_n <> 1 OR lower(v_em) IS DISTINCT FROM lower(v_me_em) THEN
    RAISE EXCEPTION 'probe: story like count % email %', v_n, v_em;
  END IF;

  SELECT count(*), max(liker_email) INTO v_n, v_em
    FROM public.status_note_likes WHERE note_id = v_note;
  IF v_n <> 1 OR lower(v_em) IS DISTINCT FROM lower(v_me_em) THEN
    RAISE EXCEPTION 'probe: note like count % email %', v_n, v_em;
  END IF;

  SELECT count(*), max(reviewer_email) INTO v_n, v_em
    FROM public.regimen_reviews WHERE regimen_id = v_reg_a;
  IF v_n <> 1 OR lower(v_em) IS DISTINCT FROM lower(v_me_em) THEN
    RAISE EXCEPTION 'probe: review count % email %', v_n, v_em;
  END IF;

  RAISE EXCEPTION 'probe_ok';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
END;
$probe$;
