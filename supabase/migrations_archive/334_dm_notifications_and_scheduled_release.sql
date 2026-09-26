-- 334_dm_notifications_and_scheduled_release.sql
--
-- Four defects found auditing the DM surface end to end. All four are
-- server-side; the matching client fixes ship in the same push.
--
-- ── 1. A photo, sticker, GIF or voice memo never notified anybody ──────
--
-- notify_dm_received (mig 181) opens with:
--
--     IF NEW.content IS NULL OR length(btrim(NEW.content)) = 0
--       THEN RETURN NEW; END IF;
--
-- and the client writes `content: body || ''`, so every media-only
-- message — the sticker picker, the GIF picker, the voice recorder, a
-- photo with no caption — inserts a row with content = '' and returns
-- before the notification is built. Measured on production:
-- 4 of 47 hub_messages have empty content and every one of them is a
-- media message. Those four recipients were never told.
--
-- The guard is kept for a genuinely empty row (no text, no attachment,
-- no sticker) — that is a malformed insert, not a message.
--
-- ── 2. Voting in a poll pinged the other person as a new message ───────
--
-- A vote is a [POLL_VOTE_V1] control message. Everything else in the
-- app knows to hide them — the inbox preview skips them, dm_unread_count
-- excludes them by prefix, HubChat filters them out of the thread — but
-- the notification trigger did not, so tapping a poll option sent the
-- other participant "New message". A three-option poll answered by two
-- people is six phantom notifications.
--
-- ── 3. A SCHEDULED message notified its recipient at COMPOSE time ──────
--
-- trg_notify_dm_received is AFTER INSERT with no status guard, and
-- schedule_my_message inserts the row immediately with
-- status = 'scheduled'. So scheduling a message for Friday notified the
-- recipient on Tuesday — while mig 295's RESTRICTIVE policy correctly
-- hides the row from them until release. They got "New message", opened
-- the thread, and found nothing there.
--
-- Fixed at both ends: the trigger function now returns early on a
-- scheduled row, and a second trigger fires the SAME function when the
-- cron flips status to 'sent'. The notification now lands when the
-- message does.
--
-- ── 4. A released message landed in the middle of the thread ──────────
--
-- release_scheduled_messages set created_at = now() but not
-- created_date. The client reads and sorts on created_date throughout
-- (listMessages orders by -created_date, the inbox sorts on it, the
-- unread cut-off compares against it), and created_date defaults to
-- now() at INSERT — i.e. compose time. So a message scheduled a week
-- out was released into the position it was written, buried under every
-- message sent in between, and the recipient would most likely never
-- scroll back far enough to see it.
--
-- The release also never touched hub_conversations, so the thread did
-- not rise in the inbox and its preview still showed the older message.
-- Both are now updated as part of the release.
--
-- Bonus, same cause: mark_messages_delivered is SECURITY DEFINER, so it
-- bypassed 295 and stamped delivered_at on rows that had not been sent
-- yet — the sender saw a green "Delivered" tick against a message still
-- sitting in the schedule queue. dm_unread_count counted those same rows
-- toward the recipient's badge, for a message they could not open.
-- Both now skip scheduled rows.
--
-- Nothing here is destructive and there are 0 scheduled rows in
-- production today, so this changes no existing data.
--
-- Paste-safe: single-table statements with bare columns, NEW./OLD. only,
-- scalar SELECT ... INTO rather than record fields.

-- ─────────────────────────────────────────────────────────────────────
-- notify_dm_received — media-aware, vote-aware, schedule-aware
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_dm_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT; v_rcpt_id UUID; v_rcpt_lang TEXT; v_text JSONB; v_emails TEXT[];
  v_content TEXT;
BEGIN
  -- Held for later delivery. The row exists but the recipient cannot
  -- read it yet (mig 295), so announcing it now is a notification that
  -- leads nowhere. trg_notify_dm_released re-runs this on release.
  IF NEW.status = 'scheduled' THEN RETURN NEW; END IF;

  v_content := btrim(coalesce(NEW.content, NEW.body, ''));

  -- Poll votes are control messages, not chat. Everything else in the
  -- app hides them; this used to be the one surface that shouted them.
  IF left(v_content, 14) = '[POLL_VOTE_V1]' THEN RETURN NEW; END IF;

  -- A message with no text is still a message when it carries media —
  -- a sticker, a GIF, a voice memo, a photo. Only a row with nothing at
  -- all in it is skipped.
  IF v_content = ''
     AND NEW.attachment_url IS NULL
     AND NEW.sticker_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT participant_emails INTO v_emails
    FROM public.hub_conversations WHERE id = NEW.conversation_id;
  IF v_emails IS NULL THEN RETURN NEW; END IF;

  FOREACH v_email IN ARRAY v_emails LOOP
    CONTINUE WHEN lower(v_email) = lower(COALESCE(NEW.sender_email, ''));
    SELECT id, COALESCE(preferred_language, 'en') INTO v_rcpt_id, v_rcpt_lang
      FROM public.user_profiles WHERE lower(email) = lower(v_email);
    CONTINUE WHEN v_rcpt_id IS NULL;
    CONTINUE WHEN public.is_blocked(v_rcpt_id, NEW.sender_email);

    v_text := public.dm_received_text(v_rcpt_lang, NEW.sender_name);
    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES (v_rcpt_id, v_email, 'dm_received', v_text->>'title', v_text->>'body',
            NULLIF(NEW.sender_avatar, ''), '/messages',
            jsonb_build_object('conversation_id', NEW.conversation_id));
  END LOOP;
  RETURN NEW;
END;
$$;

-- Fire the same notification when a scheduled message is actually
-- released. WHEN-gated on the exact transition so no ordinary edit
-- (read_at, delivered_at, is_pinned, deleted_at) can re-notify.
DROP TRIGGER IF EXISTS trg_notify_dm_released ON public.hub_messages;
CREATE TRIGGER trg_notify_dm_released
AFTER UPDATE OF status ON public.hub_messages
FOR EACH ROW
WHEN (OLD.status = 'scheduled' AND NEW.status = 'sent')
EXECUTE FUNCTION public.notify_dm_received();

-- ─────────────────────────────────────────────────────────────────────
-- release_scheduled_messages — land the message at the time it was SENT
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.release_scheduled_messages()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_id    UUID;
  v_conv  UUID;
  v_text  TEXT;
BEGIN
  FOR v_id IN
    SELECT id
      FROM public.hub_messages
     WHERE status = 'scheduled'
       AND scheduled_at <= now()
     ORDER BY scheduled_at
  LOOP
    -- created_date is the column the client sorts on; created_at is kept
    -- in step because both are read as fallbacks for each other.
    UPDATE public.hub_messages
       SET status       = 'sent',
           created_at   = now(),
           created_date = now(),
           scheduled_at = NULL
     WHERE id = v_id;

    SELECT conversation_id,
           left(coalesce(NULLIF(btrim(body), ''), content, ''), 80)
      INTO v_conv, v_text
      FROM public.hub_messages
     WHERE id = v_id;

    -- Raise the thread in the inbox and refresh its preview, the way a
    -- normal send does from the client.
    UPDATE public.hub_conversations
       SET last_message_at      = now(),
           last_message_preview = COALESCE(NULLIF(v_text, ''), '📎 Attachment')
     WHERE id = v_conv;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- mark_messages_delivered — never mark an unsent message as delivered
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_messages_delivered(p_conv_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := lower(coalesce(NULLIF(public.current_user_email(), ''), ''));
  v_uid   UUID := auth.uid();
  v_ok    UUID[];
  v_done  INTEGER := 0;
BEGIN
  IF v_email = '' THEN
    RETURN 0;
  END IF;
  IF p_conv_ids IS NULL OR array_length(p_conv_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;
  IF NOT (array_length(p_conv_ids, 1) = least(array_length(p_conv_ids, 1), 200)) THEN
    RAISE EXCEPTION 'too_many_conversations' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(id)
    INTO v_ok
    FROM public.hub_conversations
   WHERE id = ANY (p_conv_ids)
     AND (
       v_email = ANY (
         ARRAY(
           SELECT lower(participant_email)
             FROM unnest(coalesce(participant_emails, ARRAY[]::text[]))
               AS participant_email
         )
       )
       OR v_uid = ANY (coalesce(participant_ids, ARRAY[]::uuid[]))
     );

  IF v_ok IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.hub_messages
     SET delivered_at = now()
   WHERE conversation_id = ANY (v_ok)
     AND delivered_at IS NULL
     AND status <> 'scheduled'
     AND NOT (lower(coalesce(sender_email, created_by, '')) = v_email);

  GET DIAGNOSTICS v_done = ROW_COUNT;
  RETURN v_done;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- dm_unread_count — don't badge a message the reader cannot open
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dm_unread_count(p_last_reads jsonb DEFAULT '{}'::jsonb)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT lower(NULLIF(public.current_user_email(), '')) AS my_email
  ),
  my_convs AS (
    SELECT id AS conv_id
      FROM public.hub_conversations
     WHERE EXISTS (
             SELECT 1 FROM unnest(participant_emails) AS pe
              WHERE lower(pe) = (SELECT my_email FROM me)
           )
  )
  SELECT COALESCE(count(*), 0)::integer
    FROM public.hub_messages
   WHERE conversation_id IN (SELECT conv_id FROM my_convs)
     AND status <> 'scheduled'
     AND lower(COALESCE(sender_email, '')) IS DISTINCT FROM (SELECT my_email FROM me)
     AND left(COALESCE(NULLIF(body, ''), content, ''), 14) <> '[POLL_VOTE_V1]'
     AND CASE
           WHEN p_last_reads ? conversation_id::text
             THEN COALESCE(created_date, created_at)
                  > to_timestamp(((p_last_reads ->> conversation_id::text)::numeric) / 1000.0)
           ELSE read_at IS NULL
         END;
$$;

NOTIFY pgrst, 'reload schema';
