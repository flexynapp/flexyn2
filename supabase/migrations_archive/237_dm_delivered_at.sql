-- 237_dm_delivered_at.sql
--
-- A real delivery signal for DM status ticks.
--
-- The conversation list is getting iMessage-style status icons on the
-- sender's own last message: grey check (sent), green check (delivered),
-- green eye (read). Two of those three already had honest backing:
--
--   sent  — the hub_messages row exists, i.e. the insert succeeded
--   read  — hub_messages.read_at, stamped by mig 141's mark_message_read
--           when the RECIPIENT opens the thread
--
-- DELIVERED had nothing. The only nearby column, user_profiles
-- .last_active_at, is pinged once per session from Layout.jsx and on
-- own-profile open — it means "this person opened the app at some
-- point", NOT "their device received this message". Deriving a green
-- delivered tick from it would be a tick that lies, which is worse than
-- no tick at all.
--
-- So this adds the missing signal honestly. `delivered_at` is stamped
-- when the RECIPIENT'S CLIENT ACTUALLY DOWNLOADS THE MESSAGE ROW —
-- listMyConversations pulls the recent messages for its previews, and
-- calls mark_messages_delivered with the conversation ids it just read.
-- That is delivery in the WhatsApp sense: the bytes reached their
-- device. It is strictly weaker than read_at (downloaded, not opened),
-- so the three states are genuinely distinct.
--
-- Cost: the UPDATE only touches rows where delivered_at IS NULL, so it
-- is one write per message ever. After a thread is caught up the call
-- is an indexed no-op scan over that user's own conversations.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
-- Paste-safe: single-table statements, bare columns, no 3-part column
-- references, and no bare angle-bracket comparison operators.

ALTER TABLE public.hub_messages
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- Backfill: anything already READ was self-evidently delivered first.
-- Without this, every historical read message would render a green eye
-- with no green-check stage ever having existed, and any message read
-- before this migration would look "sent" if it were later un-read.
UPDATE public.hub_messages
   SET delivered_at = read_at
 WHERE delivered_at IS NULL
   AND read_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- mark_messages_delivered — called by the RECIPIENT's client
-- ─────────────────────────────────────────────────────────────────────
-- Stamps delivered_at on messages the caller RECEIVED in the given
-- conversations. Gated on auth.uid()/auth.email(): the conversation
-- list is filtered to threads the caller actually participates in
-- before anything is written, and the caller's own sent messages are
-- excluded (you don't deliver a message to yourself).
--
-- Returns the number of rows stamped, so the client can skip work when
-- there is nothing to do.
CREATE OR REPLACE FUNCTION public.mark_messages_delivered(
  p_conv_ids UUID[]
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := lower(coalesce(auth.email(), ''));
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
  -- Bound the batch. 200 is well past the 50-conversation inbox window.
  IF NOT (array_length(p_conv_ids, 1) = least(array_length(p_conv_ids, 1), 200)) THEN
    RAISE EXCEPTION 'too_many_conversations' USING ERRCODE = '22023';
  END IF;

  -- Narrow to conversations the caller is genuinely a participant of.
  -- Everything after this point is scoped by v_ok, so no membership
  -- check has to be repeated inside the UPDATE.
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
     AND NOT (lower(coalesce(sender_email, created_by, '')) = v_email);

  GET DIAGNOSTICS v_done = ROW_COUNT;
  RETURN v_done;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_messages_delivered(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_messages_delivered(UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_messages_delivered(UUID[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
