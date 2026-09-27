-- create_notification_for stops being an open cross-user mailbox.
--
-- Any signed-in user, guests included, could call it with any recipient and
-- put any title, body and link_url into that person's notifications, which
-- the push fan-out delivers to their phone and NotificationPanel opens on tap.
-- Its only check was a six-type allow-list. No relationship, block or rate
-- check. Found by the 2026-09-27 codebase audit and confirmed on production.
--
-- What actually calls it, measured before changing it:
--   * crew roll call (src/lib/data/crews.js). Its type, crew_roll_call, was
--     never on the allow-list, so roll call has never delivered a
--     notification. This is the one live caller.
--   * friend_follow / friend_post fallbacks that run only when
--     notify_friend_follow_for / notify_friend_post_for are missing (42883).
--     Both exist in production and check the follow relationship and render
--     their own text server-side, so these fallbacks are dead code.
--   * comment_reply, post_reaction, sticker_reaction, trade_offer: no caller
--     at all. The existing rows of those types come from other paths.
--
-- So the allow-list becomes crew_roll_call only, with the checks that make
-- it safe:
--   * sender and recipient must both be members of the crew named in
--     p_metadata.crew_id;
--   * a block in either direction drops it silently (not revealing the
--     block);
--   * at most 5 per sender per recipient per hour, dropped silently beyond;
--   * link_url is pinned to /hub, never taken from the client;
--   * title and body are length capped;
--   * metadata.sender_id is written by the server, so it can be trusted.
-- The signature is unchanged so the client keeps working.
--
-- SECURITY DEFINER functions that INSERT into notifications directly (the
-- Rival work in #98, the notify_*_for family) are untouched.

CREATE OR REPLACE FUNCTION public.create_notification_for(
  p_user_id uuid, p_type text, p_title text, p_body text,
  p_icon text, p_link_url text, p_metadata jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sender       uuid := auth.uid();
  v_sender_email text;
  v_email        text;
  v_crew_id      uuid;
  v_recent       integer;
  v_id           uuid;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_type IS NULL THEN
    RAISE EXCEPTION 'user_id and type required' USING ERRCODE = '22023';
  END IF;
  IF p_type <> 'crew_roll_call' THEN
    RAISE EXCEPTION 'notification type % not allowed for cross-user dispatch', p_type
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id = v_sender THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_crew_id := NULLIF(p_metadata->>'crew_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_crew_id := NULL;
  END;
  IF v_crew_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.crew_members
                     WHERE crew_id = v_crew_id AND user_id = v_sender)
     OR NOT EXISTS (SELECT 1 FROM public.crew_members
                     WHERE crew_id = v_crew_id AND user_id = p_user_id) THEN
    RAISE EXCEPTION 'sender and recipient must share the crew' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_sender_email FROM public.user_profiles WHERE id = v_sender;
  -- Guests have no auth.users email; their profile carries the address.
  SELECT COALESCE(NULLIF(u.email, ''), p.email) INTO v_email
    FROM public.user_profiles p
    LEFT JOIN auth.users u ON u.id = p.id
   WHERE p.id = p_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'recipient not found' USING ERRCODE = '22023';
  END IF;

  IF v_sender_email IS NOT NULL AND public.is_blocked(p_user_id, v_sender_email) THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_recent
    FROM public.notifications
   WHERE user_id = p_user_id
     AND type = p_type
     AND metadata->>'sender_id' = v_sender::text
     AND created_at > now() - interval '1 hour';
  IF v_recent >= 5 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (p_user_id, v_email, p_type,
          left(COALESCE(p_title, ''), 120),
          left(p_body, 280),
          left(p_icon, 8),
          '/hub',
          jsonb_build_object('crew_id', v_crew_id, 'sender_id', v_sender))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_notification_for(uuid, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_notification_for(uuid, text, text, text, text, text, jsonb) TO authenticated, service_role;

-- Prove it with seeded people, as a real signed-in sender. Everything is
-- rolled back at the end.
DO $$
DECLARE
  a uuid := gen_random_uuid();   -- sender
  b uuid := gen_random_uuid();   -- crewmate
  c uuid := gen_random_uuid();   -- stranger
  v_crew uuid;
  v_id uuid;
  v_link text;
  i int;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, aud, role)
    VALUES (a, 'probe_a_' || a || '@probe.invalid', 'authenticated', 'authenticated'),
           (b, 'probe_b_' || b || '@probe.invalid', 'authenticated', 'authenticated'),
           (c, 'probe_c_' || c || '@probe.invalid', 'authenticated', 'authenticated');
    INSERT INTO public.user_profiles (id, email)
    VALUES (a, 'probe_a_' || a || '@probe.invalid'),
           (b, 'probe_b_' || b || '@probe.invalid'),
           (c, 'probe_c_' || c || '@probe.invalid')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.crews (name) VALUES ('probe crew ' || a) RETURNING id INTO v_crew;
    INSERT INTO public.crew_members (crew_id, user_id, role) VALUES (v_crew, a, 'leader'), (v_crew, b, 'member');

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', a, 'role', 'authenticated')::text, true);

    -- 1. The old phishing shape: any type, any recipient, external link.
    BEGIN
      SET LOCAL ROLE authenticated;
      PERFORM public.create_notification_for(c, 'friend_follow', 'Verify your account',
        'Tap now', NULL, 'https://evil.example', '{}'::jsonb);
      RESET ROLE;
      RAISE EXCEPTION 'friend_follow to a stranger was accepted';
    EXCEPTION WHEN insufficient_privilege THEN RESET ROLE;
    END;

    -- 2. Roll call to someone outside the crew.
    BEGIN
      SET LOCAL ROLE authenticated;
      PERFORM public.create_notification_for(c, 'crew_roll_call', 't', 'b', NULL, '/hub',
        jsonb_build_object('crew_id', v_crew));
      RESET ROLE;
      RAISE EXCEPTION 'roll call to a non-member was accepted';
    EXCEPTION WHEN insufficient_privilege THEN RESET ROLE;
    END;

    -- 3. Roll call to a crewmate delivers, with the link pinned.
    SET LOCAL ROLE authenticated;
    v_id := public.create_notification_for(b, 'crew_roll_call', 'Roll call', 'Gym at 6?', NULL,
      'https://evil.example', jsonb_build_object('crew_id', v_crew));
    RESET ROLE;
    SELECT link_url INTO v_link FROM public.notifications WHERE id = v_id;
    IF v_id IS NULL OR v_link IS DISTINCT FROM '/hub' THEN
      RAISE EXCEPTION 'roll call to a crewmate did not deliver with a pinned link (id %, link %)', v_id, v_link;
    END IF;

    -- 4. Rate limit: 5 per hour per pair, the 6th is dropped.
    SET LOCAL ROLE authenticated;
    FOR i IN 1..4 LOOP
      PERFORM public.create_notification_for(b, 'crew_roll_call', 'Roll call', 'x', NULL, NULL,
        jsonb_build_object('crew_id', v_crew));
    END LOOP;
    v_id := public.create_notification_for(b, 'crew_roll_call', 'Roll call', 'x', NULL, NULL,
      jsonb_build_object('crew_id', v_crew));
    RESET ROLE;
    IF v_id IS NOT NULL THEN
      RAISE EXCEPTION 'the sixth roll call in an hour was delivered';
    END IF;

    -- 5. A block drops it silently.
    DELETE FROM public.notifications WHERE user_id = b;
    INSERT INTO public.user_blocks (blocker_id, blocker_email, blocked_email)
    VALUES (b, 'probe_b_' || b || '@probe.invalid', 'probe_a_' || a || '@probe.invalid');
    SET LOCAL ROLE authenticated;
    v_id := public.create_notification_for(b, 'crew_roll_call', 'Roll call', 'x', NULL, NULL,
      jsonb_build_object('crew_id', v_crew));
    RESET ROLE;
    IF v_id IS NOT NULL THEN
      RAISE EXCEPTION 'a roll call reached someone who blocked the sender';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'probe_rollback';
  EXCEPTION WHEN raise_exception THEN
    RESET ROLE;
    IF SQLERRM <> 'probe_rollback' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
END
$$;
