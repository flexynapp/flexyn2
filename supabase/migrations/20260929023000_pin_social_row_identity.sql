-- Rows on the social tables can no longer claim to be written by, or on
-- behalf of, somebody else.
--
-- Each of these tables pins its owner by id (user_id / seller_user_id =
-- auth.uid()) in its write policy, but also carries an email column that
-- the policy never checks, and that email is what the rest of the system
-- keys on. Probed 2026-09-29 as a one-tap guest, rolled back:
--
-- 1. hub_follows. The policy checks user_id and created_by, not
--    follower_id. A guest inserted a row with user_id = themself and
--    follower_id / followee_id = two OTHER users, and it was accepted: a
--    forged "A follows B". The AFTER INSERT trigger
--    dm_accept_conversations_on_follow then runs for the forged follower:
--    it deletes A's dm_request_blocks row for B and marks A as having
--    accepted B's conversation. So anyone could forge "victim follows me"
--    and put their DMs back in the inbox of someone who had pushed them to
--    Requests or blocked their requests. It also fakes follower counts,
--    "training together since" lines, and feed and privacy membership
--    (viewer_follows reads these rows).
-- 2. hub_posts and hub_comments. author_email is not checked. A guest
--    inserted a post with author_email = someone else's address. The
--    Following feed selects posts by author_email, so the post lands in the
--    feed of everyone who follows that person, and the read policy judges
--    its privacy against that person's settings.
-- 3. story_highlights.user_email is free text beside a pinned user_id, and
--    another user's profile reads highlights by user_email, so a guest
--    could put highlights on someone else's profile.
--
-- Measured before the fix: 0 forged rows on any of the four tables
-- (follower_id = user_id on all 44 follows; every email matches its id).
--
-- marketplace_listings.seller_email has the same shape but is left alone:
-- it is deliberately '' for guest sellers (create_marketplace_listing
-- stamps auth.email()), and TradeOfferDialog relies on that. It stops
-- mattering once trade offers address the seller by id.
--
-- The fix derives each email from the row's own pinned id, on every insert,
-- whoever writes it; an UPDATE keeps the identity columns it had. Deriving
-- from the row rather than from the caller keeps the SECURITY DEFINER
-- writers (the post counter RPCs) correct as well.

CREATE OR REPLACE FUNCTION public.pin_social_row_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id    uuid;
  v_email text;
BEGIN
  IF TG_TABLE_NAME = 'hub_follows' THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.follower_id    := OLD.follower_id;
      NEW.follower_email := OLD.follower_email;
      NEW.followee_id    := OLD.followee_id;
      NEW.followee_email := OLD.followee_email;
      RETURN NEW;
    END IF;
    -- The follower is whoever owns the row. user_id is pinned to auth.uid()
    -- by the write policy; created_by (the legacy email key) to the
    -- caller's email.
    v_id := NEW.user_id;
    IF v_id IS NULL AND NEW.created_by IS NOT NULL THEN
      SELECT id INTO v_id FROM public.user_profiles
       WHERE lower(email) = lower(NEW.created_by) LIMIT 1;
    END IF;
    IF v_id IS NOT NULL THEN
      SELECT email INTO v_email FROM public.user_profiles WHERE id = v_id;
      NEW.follower_id    := v_id;
      NEW.follower_email := COALESCE(v_email, NEW.created_by);
    ELSE
      NEW.follower_id    := NULL;
      NEW.follower_email := NEW.created_by;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME IN ('hub_posts', 'hub_comments') THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.user_id      := OLD.user_id;
      NEW.created_by   := OLD.created_by;
      NEW.author_email := OLD.author_email;
      RETURN NEW;
    END IF;
    IF NEW.user_id IS NOT NULL THEN
      SELECT email INTO v_email FROM public.user_profiles WHERE id = NEW.user_id;
    END IF;
    NEW.author_email := COALESCE(v_email, NEW.created_by);
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'story_highlights' THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.user_id    := OLD.user_id;
      NEW.user_email := OLD.user_email;
      RETURN NEW;
    END IF;
    SELECT email INTO v_email FROM public.user_profiles WHERE id = NEW.user_id;
    NEW.user_email := COALESCE(v_email, NEW.user_email);
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.pin_social_row_identity() FROM PUBLIC, anon, authenticated;

-- Triggers fire in name order. The hub_follows one must run before
-- hub_follows_populate_ids_tr, which would otherwise resolve ids from
-- whatever emails the client sent, hence the "a_" prefix.
DROP TRIGGER IF EXISTS hub_follows_a_pin_identity ON public.hub_follows;
CREATE TRIGGER hub_follows_a_pin_identity
  BEFORE INSERT OR UPDATE ON public.hub_follows
  FOR EACH ROW EXECUTE FUNCTION public.pin_social_row_identity();

DROP TRIGGER IF EXISTS hub_posts_a_pin_identity ON public.hub_posts;
CREATE TRIGGER hub_posts_a_pin_identity
  BEFORE INSERT OR UPDATE ON public.hub_posts
  FOR EACH ROW EXECUTE FUNCTION public.pin_social_row_identity();

DROP TRIGGER IF EXISTS hub_comments_a_pin_identity ON public.hub_comments;
CREATE TRIGGER hub_comments_a_pin_identity
  BEFORE INSERT OR UPDATE ON public.hub_comments
  FOR EACH ROW EXECUTE FUNCTION public.pin_social_row_identity();

DROP TRIGGER IF EXISTS story_highlights_a_pin_identity ON public.story_highlights;
CREATE TRIGGER story_highlights_a_pin_identity
  BEFORE INSERT OR UPDATE ON public.story_highlights
  FOR EACH ROW EXECUTE FUNCTION public.pin_social_row_identity();

-- Probe, rolled back: attempt each forgery as a signed-in user, and check
-- the ordinary write still lands with the right identity.
DO $probe$
DECLARE
  v_me     uuid := gen_random_uuid();
  v_a      uuid := gen_random_uuid();
  v_b      uuid := gen_random_uuid();
  v_me_em  text;
  v_a_em   text;
  v_id     uuid;
  v_em     text;
  v_body   text;
  v_fe     uuid;
  v_post   uuid;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_me, 'probe_m_' || v_me || '@probe.invalid', 'authenticated', 'authenticated'),
    (v_a,  'probe_a_' || v_a  || '@probe.invalid', 'authenticated', 'authenticated'),
    (v_b,  'probe_b_' || v_b  || '@probe.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.user_profiles (id, email) VALUES
    (v_me, 'probe_m_' || v_me || '@probe.invalid'),
    (v_a,  'probe_a_' || v_a  || '@probe.invalid'),
    (v_b,  'probe_b_' || v_b  || '@probe.invalid')
  ON CONFLICT (id) DO NOTHING;
  SELECT email INTO v_me_em FROM public.user_profiles WHERE id = v_me;
  SELECT email INTO v_a_em  FROM public.user_profiles WHERE id = v_a;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_me, 'role', 'authenticated',
                      'email', v_me_em)::text, true);
  EXECUTE 'SET LOCAL role authenticated';

  -- Forged "A follows B" comes out as "me follows B".
  INSERT INTO public.hub_follows (created_by, user_id, follower_id, followee_id)
  VALUES (v_me_em, v_me, v_a, v_b)
  RETURNING follower_id, follower_email, followee_id INTO v_id, v_em, v_fe;
  IF v_id <> v_me OR lower(v_em) <> lower(v_me_em) OR v_fe <> v_b THEN
    RAISE EXCEPTION 'probe: forged follower kept (%)', v_id;
  END IF;

  -- The same forgery by email.
  INSERT INTO public.hub_follows (created_by, user_id, follower_email, followee_id)
  VALUES (v_me_em, v_me, v_a_em, v_a)
  RETURNING follower_id INTO v_id;
  IF v_id <> v_me THEN
    RAISE EXCEPTION 'probe: forged follower email kept';
  END IF;

  -- A post claiming someone else's email is stored as mine.
  INSERT INTO public.hub_posts (created_by, user_id, author_email, body, privacy)
  VALUES (v_me_em, v_me, v_a_em, 'probe', 'public')
  RETURNING id, author_email INTO v_post, v_em;
  IF lower(v_em) <> lower(v_me_em) THEN
    RAISE EXCEPTION 'probe: forged post author kept';
  END IF;

  -- And cannot be re-pointed afterwards.
  UPDATE public.hub_posts SET author_email = v_a_em, body = 'probe 2' WHERE id = v_post;
  SELECT author_email, body INTO v_em, v_body FROM public.hub_posts WHERE id = v_post;
  IF lower(v_em) <> lower(v_me_em) OR v_body IS DISTINCT FROM 'probe 2' THEN
    RAISE EXCEPTION 'probe: post update wrong (%, %)', v_em, v_body;
  END IF;

  -- Comments.
  INSERT INTO public.hub_comments (created_by, user_id, author_email, post_id, body)
  VALUES (v_me_em, v_me, v_a_em, v_post, 'probe')
  RETURNING author_email INTO v_em;
  IF lower(v_em) <> lower(v_me_em) THEN
    RAISE EXCEPTION 'probe: forged comment author kept';
  END IF;

  -- Highlights.
  INSERT INTO public.story_highlights (user_id, user_email, title)
  VALUES (v_me, v_a_em, 'probe')
  RETURNING user_email INTO v_em;
  IF lower(v_em) <> lower(v_me_em) THEN
    RAISE EXCEPTION 'probe: forged highlight email kept';
  END IF;

  EXECUTE 'RESET role';
  RAISE EXCEPTION 'probe_ok';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
END;
$probe$;
