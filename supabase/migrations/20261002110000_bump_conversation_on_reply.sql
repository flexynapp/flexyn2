-- The inbox goes stale when the person who did not start a chat replies.
--
-- sendMessage bumps the conversation's last_message_at and preview with a
-- direct UPDATE. The table's only write policy, "hub_conversations:
-- participant read/write", has a WITH CHECK that the row's created_by and
-- user_id are the CALLER, so the update succeeds only for whoever started
-- the thread. For the other participant it is refused, the client swallows
-- the error, and both inboxes keep showing the previous message and time.
-- Measured 2026-10-02: 3 of the 14 production threads with messages had a
-- last_message_at older than their newest message.
--
-- Widening the policy is the wrong fix: the same policy guards every other
-- column, including the participant list. Instead a participant gets a
-- narrow door that sets the two inbox columns and nothing else.
--
-- The preview is still built on the client (it maps the poll, trade, crew
-- and duel markers to readable text). To stop the door being used to write
-- arbitrary inbox text without sending anything, the caller must have sent
-- a message in this conversation within the last two minutes, and the text
-- goes through the same slur filter as a message body.

CREATE OR REPLACE FUNCTION public.bump_my_conversation(p_conversation_id uuid, p_preview text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_preview text := left(COALESCE(NULLIF(btrim(p_preview), ''), '📎 Image'), 80);
BEGIN
  IF v_uid IS NULL OR NOT public.is_dm_participant(p_conversation_id) THEN
    RAISE EXCEPTION 'not a participant' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.hub_messages m
     WHERE m.conversation_id = p_conversation_id
       AND m.user_id = v_uid
       AND m.created_at > now() - interval '2 minutes'
  ) THEN
    RAISE EXCEPTION 'no recent message' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_text_clean(v_preview, FALSE) THEN
    RAISE EXCEPTION 'message_profanity' USING ERRCODE = '23514';
  END IF;

  UPDATE public.hub_conversations
     SET last_message_at = now(),
         last_message_preview = v_preview
   WHERE id = p_conversation_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.bump_my_conversation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bump_my_conversation(uuid, text) TO authenticated;

-- Probe, run as the participant who did NOT start the thread and rolled
-- back: the direct UPDATE the client used to send changes nothing, the RPC
-- bumps the preview after a real reply, and it is refused for an outsider
-- and for a participant who has sent nothing.
DO $probe$
DECLARE
  v_starter uuid := gen_random_uuid();
  v_replier uuid := gen_random_uuid();
  v_outside uuid := gen_random_uuid();
  v_st_em   text;
  v_rp_em   text;
  v_conv    uuid;
  v_id      uuid;
  v_prev    text;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_starter, 'probe_b_' || v_starter || '@probe.invalid', 'authenticated', 'authenticated'),
    (v_replier, 'probe_b_' || v_replier || '@probe.invalid', 'authenticated', 'authenticated'),
    (v_outside, 'probe_b_' || v_outside || '@probe.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.user_profiles (id, email, username) VALUES
    (v_starter, 'probe_b_' || v_starter || '@probe.invalid', 'probe_b_' || left(v_starter::text, 8)),
    (v_replier, 'probe_b_' || v_replier || '@probe.invalid', 'probe_b_' || left(v_replier::text, 8)),
    (v_outside, 'probe_b_' || v_outside || '@probe.invalid', 'probe_b_' || left(v_outside::text, 8))
  ON CONFLICT (id) DO NOTHING;
  SELECT email INTO v_st_em FROM public.user_profiles WHERE id = v_starter;
  SELECT email INTO v_rp_em FROM public.user_profiles WHERE id = v_replier;

  INSERT INTO public.hub_conversations
    (created_by, user_id, participant_emails, participant_key, accepted_emails,
     last_message_at, last_message_preview)
  VALUES
    (v_st_em, v_starter, ARRAY[v_st_em, v_rp_em], 'probe|' || v_starter,
     ARRAY[v_st_em, v_rp_em], now() - interval '1 day', 'old')
  RETURNING id INTO v_conv;

  -- The replier, before sending anything.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_replier, 'role', 'authenticated', 'email', v_rp_em)::text, true);
  EXECUTE 'SET LOCAL role authenticated';
  BEGIN
    PERFORM public.bump_my_conversation(v_conv, 'nothing sent');
    RAISE EXCEPTION 'probe: bump allowed with no message sent';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Reply, then the old direct update: refused by the policy, as in production.
  INSERT INTO public.hub_messages
    (created_by, user_id, conversation_id, sender_email, recipient_id, body, content)
  VALUES (v_rp_em, v_replier, v_conv, v_rp_em, v_starter, 'reply', 'reply');
  BEGIN
    UPDATE public.hub_conversations
       SET last_message_at = now(), last_message_preview = 'reply'
     WHERE id = v_conv RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
      RAISE EXCEPTION 'probe: direct update now works, this migration may be redundant';
    END IF;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  PERFORM public.bump_my_conversation(v_conv, 'reply');
  SELECT last_message_preview INTO v_prev FROM public.hub_conversations WHERE id = v_conv;
  IF v_prev IS DISTINCT FROM 'reply' THEN
    RAISE EXCEPTION 'probe: preview is % after bump', v_prev;
  END IF;

  -- Someone outside the thread.
  EXECUTE 'RESET role';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_outside, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL role authenticated';
  BEGIN
    PERFORM public.bump_my_conversation(v_conv, 'hijack');
    RAISE EXCEPTION 'probe: outsider could bump';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  EXECUTE 'RESET role';
  RAISE EXCEPTION 'probe_ok';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
END
$probe$;
