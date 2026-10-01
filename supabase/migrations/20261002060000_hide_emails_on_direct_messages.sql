-- Direct messages: stop handing each participant the other person's email.
--
-- hub_conversations carried participant_emails, accepted_emails,
-- participant_key (both emails joined) and created_by; hub_messages carried
-- sender_email, recipient_email and created_by. Every participant could read
-- all of them. The app reads both tables by user id since
-- 20261002030000_dm_accepted_ids and the matching app change, so clients now
-- get SELECT on the id columns only.
--
-- Unchanged: inserts still write the email columns (start_dm_conversation
-- and the server triggers read them), the RLS policies and every SECURITY
-- DEFINER function still read them, and read_by (never written) stays
-- unreadable with them.

REVOKE SELECT ON public.hub_conversations FROM anon, authenticated;
GRANT SELECT (
  id, user_id, participant_ids, accepted_ids, last_message_at,
  last_message_preview, title, is_group, created_at, created_date, updated_at
) ON public.hub_conversations TO authenticated;

REVOKE SELECT ON public.hub_messages FROM anon, authenticated;
GRANT SELECT (
  id, user_id, conversation_id, recipient_id, sender_name, sender_avatar,
  body, content, read_at, delivered_at, created_at, created_date, is_pinned,
  replied_to_message_id, replied_to_snippet, attachment_url, deleted_at,
  scheduled_at, status, message_type, sticker_id, duration_ms
) ON public.hub_messages TO authenticated;

-- Probe, run as a real signed-in participant and rolled back: every email
-- column and select * are refused on both tables, and the statements the
-- app sends still work (read the inbox, read a thread, send a message and
-- read it back, bump the conversation preview).
DO $probe$
DECLARE
  v_me     uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_me_em  text;
  v_ot_em  text;
  v_conv   uuid;
  v_msg    uuid;
  v_n      int;
  v_tbl    text;
  v_col    text;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_me,    'probe_m_' || v_me    || '@probe.invalid', 'authenticated', 'authenticated'),
    (v_other, 'probe_m_' || v_other || '@probe.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.user_profiles (id, email, username) VALUES
    (v_me,    'probe_m_' || v_me    || '@probe.invalid', 'probe_m_' || left(v_me::text, 8)),
    (v_other, 'probe_m_' || v_other || '@probe.invalid', 'probe_m_' || left(v_other::text, 8))
  ON CONFLICT (id) DO NOTHING;
  SELECT email INTO v_me_em FROM public.user_profiles WHERE id = v_me;
  SELECT email INTO v_ot_em FROM public.user_profiles WHERE id = v_other;

  -- An accepted 1:1 thread with one message from the other person.
  INSERT INTO public.hub_conversations
    (created_by, user_id, participant_emails, participant_key, accepted_emails)
  VALUES
    (v_ot_em, v_other, ARRAY[v_me_em, v_ot_em], 'probe|' || v_me,
     ARRAY[v_me_em, v_ot_em])
  RETURNING id INTO v_conv;
  INSERT INTO public.hub_messages
    (created_by, user_id, conversation_id, sender_email, recipient_email, body, content)
  VALUES (v_ot_em, v_other, v_conv, v_ot_em, v_me_em, 'hi', 'hi');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_me, 'role', 'authenticated', 'email', v_me_em)::text, true);
  EXECUTE 'SET LOCAL role authenticated';

  FOR v_tbl, v_col IN VALUES
    ('hub_conversations', 'participant_emails'), ('hub_conversations', 'accepted_emails'),
    ('hub_conversations', 'participant_key'), ('hub_conversations', 'created_by'),
    ('hub_messages', 'sender_email'), ('hub_messages', 'recipient_email'),
    ('hub_messages', 'created_by'), ('hub_messages', 'read_by')
  LOOP
    BEGIN
      EXECUTE format('SELECT %I FROM public.%I LIMIT 1', v_col, v_tbl);
      RAISE EXCEPTION 'probe: %.% still readable', v_tbl, v_col;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  FOREACH v_tbl IN ARRAY ARRAY['hub_conversations', 'hub_messages'] LOOP
    BEGIN
      EXECUTE format('SELECT * FROM public.%I LIMIT 1', v_tbl);
      RAISE EXCEPTION 'probe: select * on % still allowed', v_tbl;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;

  -- The inbox read.
  SELECT count(*) INTO v_n FROM (
    SELECT id, user_id, participant_ids, accepted_ids, last_message_at,
           last_message_preview, title, is_group, created_at, created_date, updated_at
      FROM public.hub_conversations) c;
  IF v_n <> 1 THEN RAISE EXCEPTION 'probe: inbox shows % conversations', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.hub_conversations
   WHERE id = v_conv AND v_me = ANY(accepted_ids) AND v_other = ANY(participant_ids);
  IF v_n <> 1 THEN RAISE EXCEPTION 'probe: accepted_ids or participant_ids wrong'; END IF;

  -- Send a message the way sendMessage does, reading it back.
  INSERT INTO public.hub_messages
    (created_by, user_id, conversation_id, sender_email, recipient_id, body, content)
  VALUES (v_me_em, v_me, v_conv, v_me_em, v_other, 'yo', 'yo')
  RETURNING id INTO v_msg;
  SELECT count(*) INTO v_n FROM (
    SELECT id, user_id, conversation_id, body, read_at, created_date
      FROM public.hub_messages WHERE conversation_id = v_conv) m;
  IF v_n <> 2 THEN RAISE EXCEPTION 'probe: thread shows % messages', v_n; END IF;

  UPDATE public.hub_conversations
     SET last_message_at = now(), last_message_preview = 'yo'
   WHERE id = v_conv RETURNING id INTO v_msg;
  IF v_msg IS NULL THEN RAISE EXCEPTION 'probe: preview bump did nothing'; END IF;

  EXECUTE 'RESET role';
  RAISE EXCEPTION 'probe_ok';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
END
$probe$;
