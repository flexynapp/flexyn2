-- 113_message_requests.sql
--
-- Conversation acceptance flag for the new "Message Requests" inbox.
-- Conversations from people you don't follow (and who don't follow you)
-- land in Requests instead of the main inbox. Once you reply, the
-- conversation is "accepted" and moves to the main view.
--
-- Stores a list of participant emails who have accepted; checking
-- `auth.email() = any(accepted_emails)` tells the client to show the
-- thread in the main view vs. the Requests folder.
--
-- Auto-acceptance: sending a message also accepts the conversation
-- for the sender (you implicitly accept by replying). The originator
-- of a fresh DM is auto-accepted at create time too — they wouldn't
-- send into a folder they can't see.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE on the
-- RPC + DROP TRIGGER IF EXISTS before CREATE TRIGGER.

ALTER TABLE public.hub_conversations
  ADD COLUMN IF NOT EXISTS accepted_emails TEXT[] DEFAULT '{}'::text[];

-- Backfill: pretend every existing conversation is fully accepted
-- (anything pre-existing was opened the old way and is already in
-- the main inbox). Without this, the requests filter would yank
-- every existing thread into Requests on next render.
UPDATE public.hub_conversations
   SET accepted_emails = participant_emails
 WHERE coalesce(array_length(accepted_emails, 1), 0) = 0
   AND participant_emails IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- RPC: accept_conversation
--
-- Appends auth.email() to accepted_emails. Idempotent (array_position
-- guard) so the client can call it on every "Accept" tap without
-- worrying about duplicates.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_conversation(
  p_conv_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := auth.email();
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.hub_conversations
     SET accepted_emails = (
       CASE
         WHEN v_email = ANY(coalesce(accepted_emails, ARRAY[]::text[]))
           THEN accepted_emails
         ELSE array_append(coalesce(accepted_emails, ARRAY[]::text[]), v_email)
       END
     )
   WHERE id = p_conv_id
     AND v_email = ANY(participant_emails); -- must be a participant
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_conversation(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Trigger: auto-accept the sender of any new message.
--
-- When user X sends into a conversation, they've implicitly accepted
-- it. This avoids the "I replied but it's still in Requests" UX bug.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_accept_on_send()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  IF NEW.conversation_id IS NULL OR NEW.created_by IS NULL THEN
    RETURN NEW;
  END IF;
  v_email := NEW.created_by;
  UPDATE public.hub_conversations
     SET accepted_emails = (
       CASE
         WHEN v_email = ANY(coalesce(accepted_emails, ARRAY[]::text[]))
           THEN accepted_emails
         ELSE array_append(coalesce(accepted_emails, ARRAY[]::text[]), v_email)
       END
     )
   WHERE id = NEW.conversation_id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_accept_on_send ON public.hub_messages;
CREATE TRIGGER trg_auto_accept_on_send
  AFTER INSERT ON public.hub_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_accept_on_send();

NOTIFY pgrst, 'reload schema';
