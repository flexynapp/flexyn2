-- 062_chat_pinning.sql
-- Adds is_pinned flag to both hub_messages (DMs) and crew_messages (Crew chats).
-- Pinned messages are surfaced first in their conversation.
-- Only the conversation participants (DM) or crew members (Crew) may pin messages.

-- ── DM messages ──────────────────────────────────────────────────────────────
ALTER TABLE public.hub_messages
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_hub_messages_pinned
  ON public.hub_messages (conversation_id, is_pinned)
  WHERE is_pinned = TRUE;

-- ── Crew messages ─────────────────────────────────────────────────────────────
ALTER TABLE public.crew_messages
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_crew_messages_pinned
  ON public.crew_messages (crew_id, is_pinned)
  WHERE is_pinned = TRUE;

-- ── RPC: pin/unpin a DM message ──────────────────────────────────────────────
-- Only a conversation participant may toggle the pin on a message.
CREATE OR REPLACE FUNCTION public.toggle_pin_dm_message(p_message_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $x$
DECLARE
  v_user_email TEXT := (SELECT email FROM auth.users WHERE id = auth.uid());
  v_conv_id    UUID;
  v_new_val    BOOLEAN;
BEGIN
  -- Confirm the caller is a participant of the conversation that owns this message
  SELECT conversation_id INTO v_conv_id
  FROM public.hub_messages
  WHERE id = p_message_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.hub_conversations
    WHERE id = v_conv_id
      AND v_user_email = ANY(participant_emails)
  ) THEN
    RAISE EXCEPTION 'not_a_participant';
  END IF;

  UPDATE public.hub_messages
  SET is_pinned = NOT is_pinned
  WHERE id = p_message_id
  RETURNING is_pinned INTO v_new_val;

  RETURN v_new_val;
END;
$x$;

-- ── RPC: pin/unpin a crew message ────────────────────────────────────────────
-- Only a crew member may toggle the pin on a crew message.
CREATE OR REPLACE FUNCTION public.toggle_pin_crew_message(p_message_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $x$
DECLARE
  v_user_id UUID := auth.uid();
  v_crew_id UUID;
  v_new_val BOOLEAN;
BEGIN
  SELECT crew_id INTO v_crew_id
  FROM public.crew_messages
  WHERE id = p_message_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.crew_members
    WHERE crew_id = v_crew_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'not_a_crew_member';
  END IF;

  UPDATE public.crew_messages
  SET is_pinned = NOT is_pinned
  WHERE id = p_message_id
  RETURNING is_pinned INTO v_new_val;

  RETURN v_new_val;
END;
$x$;

NOTIFY pgrst, 'reload schema';
