-- 238_read_receipts_opt_out.sql
--
-- Read-receipt opt-out, enforced server-side.
--
-- Mig 237 gave the conversation list three status ticks: grey check
-- (sent), green check (delivered), green eye (read). The green eye is
-- the one that carries a privacy cost — it tells the sender exactly
-- when you opened their message.
--
-- THE SETTING MUST STOP THE STAMP, NOT THE ICON
--
-- Hiding the eye client-side would be theatre: read_at would still be
-- written, still be readable by the sender through any client, and the
-- opt-out would protect nobody. So the check lives inside
-- mark_message_read (mig 141), which is SECURITY DEFINER, and it reads
-- the flag from user_profiles keyed on auth.uid() — never from a
-- client-supplied value. With the setting off, read_at is simply never
-- written for that reader, so there is nothing for the sender to see.
--
-- OPT-OUT, NOT OPT-IN
--
-- Default TRUE, so every existing user keeps today's behaviour and the
-- column can land before the UI does.
--
-- DELIVERY TICKS ARE UNAFFECTED
--
-- delivered_at (mig 237) keeps being stamped regardless. This toggle
-- covers read receipts only — same scope as WhatsApp's, where the
-- second grey tick still appears when receipts are off.
--
-- EXISTING read_at VALUES ARE LEFT ALONE
--
-- Turning the setting off is not retroactive. Two reasons:
--   • The sender already legitimately saw the green eye. Erasing it
--     would rewrite something that genuinely happened, which is its own
--     kind of dishonesty — and would look like the app had lied.
--   • read_at is also the cross-device unread fallback (see _isUnread in
--     src/lib/data/hubMessages.js and mig 223's dm_unread_count).
--     Clearing it would resurrect long-read threads as unread on the
--     user's other devices. That is a functional bug, not a nicety.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
-- Paste-safe: single-table statements, bare columns, no bare
-- angle-bracket comparison operators.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS read_receipts_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- ─────────────────────────────────────────────────────────────────────
-- mark_message_read — mig 141's body, plus the opt-out gate
-- ─────────────────────────────────────────────────────────────────────
-- Everything up to the UPDATE is unchanged, deliberately: the existing
-- membership check and its 42501 are load-bearing, and the gate is
-- placed immediately before the write so a user who has opted out gets
-- exactly the same errors as anyone else for every other failure mode.
-- The only difference is that the final UPDATE does not happen.
CREATE OR REPLACE FUNCTION public.mark_message_read(p_message_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $mark_message_read$
DECLARE
  v_uid      UUID := auth.uid();
  v_email    TEXT := auth.email();
  v_conv     UUID;
  v_receipts BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_message_id IS NULL THEN
    RAISE EXCEPTION 'message_id required' USING ERRCODE = '22023';
  END IF;

  -- Resolve the conversation and verify the caller is a participant
  -- AND is not the sender (a sender doesn't "read" their own message).
  SELECT conversation_id INTO v_conv
    FROM public.hub_messages
   WHERE id = p_message_id
     AND read_at IS NULL
     AND (created_by IS DISTINCT FROM v_email)
     AND (user_id    IS DISTINCT FROM v_uid);

  IF v_conv IS NULL THEN
    -- Either the message doesn't exist, is already read, or the caller
    -- is the sender. All three cases are no-ops, not errors.
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.hub_conversations
     WHERE id = v_conv
       AND (v_email = ANY(participant_emails)
            OR v_uid = ANY(participant_ids))
  ) THEN
    RAISE EXCEPTION 'not a conversation participant' USING ERRCODE = '42501';
  END IF;

  -- The opt-out gate. Read from the DB, keyed on auth.uid(), so no
  -- client can assert someone else's preference or its own.
  SELECT coalesce(read_receipts_enabled, TRUE)
    INTO v_receipts
    FROM public.user_profiles
   WHERE id = v_uid;

  IF v_receipts IS NOT NULL AND NOT v_receipts THEN
    -- Receipts off: silently skip the stamp. The reader's own unread
    -- state still clears locally (the client writes its per-device
    -- last-read marker before ever calling this), and delivered_at is
    -- untouched, so the sender still gets their green check.
    RETURN;
  END IF;

  UPDATE public.hub_messages
     SET read_at = now()
   WHERE id = p_message_id
     AND read_at IS NULL;
END;
$mark_message_read$;

REVOKE ALL    ON FUNCTION public.mark_message_read(UUID) FROM PUBLIC;
REVOKE ALL    ON FUNCTION public.mark_message_read(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_message_read(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
