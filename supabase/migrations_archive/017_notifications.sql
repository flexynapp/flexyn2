-- Migration 017: In-App Notifications
--
-- Powers the bell icon + notification panel. Every retention-relevant event
-- (quest claimed, streak milestone, league resolved, friend posted, etc.)
-- inserts a row here. The UI polls or invalidates the unread count to drive
-- a badge that pulls users back into the app.
--
-- Schema:
--   user_id       — recipient
--   type          — stable enum string (matches NOTIFICATION_TYPES in JS)
--   title / body  — pre-rendered display strings (already-translated at write
--                   time; on language change the user sees stale text but the
--                   icon/type carries enough context to still be useful)
--   icon          — single emoji
--   link_url      — optional in-app deep link (e.g. /hub or /dashboard)
--   metadata      — jsonb for type-specific extras (rank, coins, etc.)
--   is_read       — flipped when user opens the panel or taps the row
--   created_at    — for ordering and "X minutes ago"

CREATE TABLE IF NOT EXISTS public.notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email  TEXT NOT NULL,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  icon        TEXT,
  link_url    TEXT,
  metadata    JSONB DEFAULT '{}'::jsonb,
  is_read     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_recent
  ON public.notifications(user_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Read: only your own notifications
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'notifications: read own') THEN
    CREATE POLICY "notifications: read own"
      ON public.notifications FOR SELECT
      TO authenticated USING (user_id = auth.uid());
  END IF;
END $$;

-- Insert: anyone authenticated can insert (so a follower's "they posted!" can
-- be inserted by the poster's session, which is the simplest model). We
-- don't restrict user_id here because triggers like "notify followers" need
-- to insert notifications for OTHER users. On migration to a server function,
-- narrow this to only allow inserts where created_by = auth.uid().
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'notifications: insert authenticated') THEN
    CREATE POLICY "notifications: insert authenticated"
      ON public.notifications FOR INSERT
      TO authenticated WITH CHECK (true);
  END IF;
END $$;

-- Update: only your own (used to flip is_read)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'notifications: update own') THEN
    CREATE POLICY "notifications: update own"
      ON public.notifications FOR UPDATE
      TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;

NOTIFY pgrst, 'reload schema';
