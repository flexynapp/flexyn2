-- 026_notifications_harden.sql
--
-- Security hardening for the notifications table. The original 017 policy
-- allowed ANY authenticated user to insert notifications into ANY user's
-- inbox (`WITH CHECK (true)`). That's a phishing/spam surface:
--   • Forge a notification "Friend request from @somebody" with a link_url
--     pointing wherever the attacker wants.
--   • Spam a user's inbox with bogus rows.
--   • Set is_read=false on existing rows for the wrong recipient (no — the
--     UPDATE policy is already user_id=auth.uid() — only INSERT was loose).
--
-- This migration:
--   1. Replaces the open INSERT policy with one that requires
--      user_id = auth.uid(). Users can only insert into THEIR OWN inbox.
--   2. Adds a SECURITY DEFINER RPC `create_notification_for(user_id,...)`
--      for the legitimate cross-user case (friend-followed-you, comment
--      reply, league rollover for other members). The RPC validates the
--      `type` against a whitelist so an attacker can't dispatch arbitrary
--      types — only those the server explicitly allows.

-- Drop the over-permissive policy.
DROP POLICY IF EXISTS "notifications: insert authenticated" ON public.notifications;

-- Replace with self-only.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'notifications' AND policyname = 'notifications: insert own'
  ) THEN
    CREATE POLICY "notifications: insert own"
      ON public.notifications FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- ── Cross-user notification RPC ──────────────────────────────────────────────
-- The whitelist deliberately omits sensitive types (e.g. coin grants,
-- account state changes). Only social/engagement events go through here.
CREATE OR REPLACE FUNCTION public.create_notification_for(
  p_user_id  UUID,
  p_type     TEXT,
  p_title    TEXT,
  p_body     TEXT,
  p_icon     TEXT,
  p_link_url TEXT,
  p_metadata JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender UUID := auth.uid();
  v_email  TEXT;
  v_id     UUID;
  -- Whitelist of types the client can legitimately fan out to other users.
  -- Add new types here only after auditing what link_url they'll set.
  v_allowed TEXT[] := ARRAY[
    'friend_follow',
    'friend_post',
    'comment_reply',
    'post_reaction',
    'sticker_reaction',
    'trade_offer'
  ];
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_type IS NULL THEN
    RAISE EXCEPTION 'user_id and type required' USING ERRCODE = '22023';
  END IF;
  IF NOT (p_type = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'notification type % not allowed for cross-user dispatch', p_type
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id = v_sender THEN
    -- Self-targeted: just go through the regular RLS-checked insert.
    -- The caller can do this directly, but supporting it here keeps the
    -- API uniform.
    RETURN NULL;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'recipient not found' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (p_user_id, v_email, p_type, COALESCE(p_title, ''),
          p_body, p_icon, p_link_url, COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_notification_for(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
