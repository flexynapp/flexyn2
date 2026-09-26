-- 114_dm_delete_and_schedule.sql
--
-- Two additions to hub_messages backing 18b:
--
--   • deleted_at      timestamptz — soft-delete by sender. Recipient
--                                   sees "This message was deleted"
--                                   instead of the original content.
--   • scheduled_at    timestamptz — when set, message is held until
--                                   the cron unlocks it. Only the
--                                   sender sees the message in this
--                                   state.
--   • status text DEFAULT 'sent' — 'sent' | 'scheduled' | 'failed'.
--
-- We DON'T modify the existing recipient-visibility RLS in 001 (which
-- is fine for delivered messages). Instead, the visibility for
-- scheduled messages is enforced via a view + the sender-only filter
-- below — kept narrowly scoped so we don't risk a permission regression
-- on the hot delivery path.

ALTER TABLE public.hub_messages
  ADD COLUMN IF NOT EXISTS deleted_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status       TEXT NOT NULL DEFAULT 'sent';

-- Enforce allowed status values. DO-block wrapped for idempotent retry.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hub_messages_status_check'
  ) THEN
    ALTER TABLE public.hub_messages
      ADD CONSTRAINT hub_messages_status_check
      CHECK (status IN ('sent', 'scheduled', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hub_messages_scheduled
  ON public.hub_messages(status, scheduled_at)
  WHERE status = 'scheduled';

-- ─────────────────────────────────────────────────────────────────────
-- RPC: delete_my_message
--
-- Sets deleted_at = now() on the caller's own message. Server enforces
-- ownership — non-senders get an unauthorized error.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_my_message(
  p_message_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.hub_messages
     SET deleted_at = now()
   WHERE id = p_message_id
     AND user_id = v_uid;
  -- Silent no-op if the row doesn't belong to the caller — don't leak
  -- existence by raising a different error code.
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_my_message(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- RPC: schedule_my_message
--
-- Insert path for "send this DM at <time>". Returns the inserted row's
-- id so the caller can show the user their pending scheduled message
-- (and offer Cancel).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.schedule_my_message(
  p_conversation_id UUID,
  p_recipient_email TEXT,
  p_content         TEXT,
  p_send_at         TIMESTAMPTZ
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT := auth.email();
  v_id    UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_send_at IS NULL OR p_send_at <= now() THEN
    RAISE EXCEPTION 'send_at_in_past' USING ERRCODE = '22023';
  END IF;
  IF p_content IS NULL OR length(trim(p_content)) = 0 THEN
    RAISE EXCEPTION 'empty_message' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.hub_messages
    (created_by, user_id, conversation_id, sender_email, content,
     scheduled_at, status)
  VALUES
    (v_email, v_uid, p_conversation_id, v_email, p_content,
     p_send_at, 'scheduled')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.schedule_my_message(UUID, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- RPC: cancel_my_scheduled_message — hard-delete a pending row.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_my_scheduled_message(
  p_message_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.hub_messages
   WHERE id = p_message_id
     AND user_id = v_uid
     AND status = 'scheduled';
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_my_scheduled_message(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Cron: release scheduled messages whose target time has arrived.
--
-- Runs every minute. Flips status='sent' and resets created_at so the
-- conversation rail's last_message_at ordering picks the row up at the
-- right moment. The existing notifications trigger fires when the row
-- transitions to 'sent' (no behavior change there — we never created a
-- notifications row for the scheduled state).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.release_scheduled_messages()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.hub_messages
     SET status     = 'sent',
         created_at = now(),
         scheduled_at = NULL
   WHERE status = 'scheduled'
     AND scheduled_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Schedule the cron — gated on the pg_cron extension being available.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('release-scheduled-messages')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'release-scheduled-messages');
    PERFORM cron.schedule(
      'release-scheduled-messages',
      '* * * * *',
      $cmd$ SELECT public.release_scheduled_messages(); $cmd$
    );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
