-- 039_notifications_delete_policy.sql
--
-- Allow users to delete their own notifications. Migration 017 created
-- read / insert / update policies but no DELETE — meaning the new
-- swipe-to-delete and per-row delete buttons in NotificationPanel can't
-- actually remove rows for users.
--
-- The policy mirrors the "update own" semantics from migration 017:
-- only the recipient can delete their own row. Server-side cron jobs
-- (welcome-back, quest-expiry, streak-break) run as SECURITY DEFINER
-- functions and bypass RLS, so they're unaffected.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'notifications'
       AND policyname = 'notifications: delete own'
  ) THEN
    CREATE POLICY "notifications: delete own"
      ON public.notifications FOR DELETE
      TO authenticated USING (user_id = auth.uid());
  END IF;
END $$;

GRANT DELETE ON public.notifications TO authenticated;

NOTIFY pgrst, 'reload schema';
