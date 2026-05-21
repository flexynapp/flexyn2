-- supabase/tests/push_smoke_test.sql
--
-- Smoke test for the Web Push pipeline. Paste this into the Supabase SQL
-- Editor AFTER you've completed the deploy steps in CLAUDE.md's "Push
-- notifications" section:
--
--   1. VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT set as
--      Supabase Edge Function secrets
--   2. SEND_PUSH_TRIGGER_SECRET set, mirrored to the database as
--      app.send_push_secret
--   3. app.send_push_url set to your deployed Edge Function URL
--   4. send-push function deployed (supabase functions deploy send-push)
--   5. At least one client has opted in to push (so a row exists in
--      public.push_subscriptions for your auth.uid())
--
-- This script is non-destructive — it only reads config, inserts ONE
-- self-targeted notification, then prints what happens.
--
-- If you see the test push arrive on your device, the pipeline is live.
-- Subsequent inserts into public.notifications (from streak-break cron,
-- friend follows, duel invites, etc.) will fan out automatically.

-- ── Stage 1: config sanity ──────────────────────────────────────────────
DO $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
BEGIN
  v_url    := current_setting('app.send_push_url',    true);
  v_secret := current_setting('app.send_push_secret', true);
  RAISE NOTICE '────────────────────────────────────────────────────────';
  RAISE NOTICE 'app.send_push_url     : %', COALESCE(NULLIF(v_url, ''), '(UNSET — push will silently no-op)');
  RAISE NOTICE 'app.send_push_secret  : %',
    CASE WHEN v_secret IS NOT NULL AND v_secret <> ''
         THEN '(set, ' || length(v_secret) || ' chars)'
         ELSE '(UNSET — push will silently no-op)' END;
  RAISE NOTICE '────────────────────────────────────────────────────────';
END $$;

-- ── Stage 2: scheduled crons ────────────────────────────────────────────
SELECT jobname, schedule, active
  FROM cron.job
 WHERE jobname IN ('streak_break_reminders_hourly',
                   'welcome_back_hourly',
                   'quest_expiry_15min')
 ORDER BY jobname;

-- ── Stage 3: push subscription count ────────────────────────────────────
-- Total opt-ins and how many unique users they cover. If both are 0, no
-- client has subscribed yet — the toggle in Settings probably needs
-- VITE_VAPID_PUBLIC_KEY set in the client build env.
SELECT
  COUNT(*)             AS total_subscriptions,
  COUNT(DISTINCT user_id) AS unique_users,
  COUNT(*) FILTER (WHERE last_seen_at >  now() - INTERVAL '7 days') AS active_in_last_7d
FROM public.push_subscriptions;

-- ── Stage 4: confirm the 034 trigger is wired ───────────────────────────
SELECT trigger_name, event_manipulation, event_object_table, action_timing
  FROM information_schema.triggers
 WHERE event_object_table = 'notifications'
   AND trigger_name = 'trg_notifications_push_fanout';

-- ── Stage 5: send a self-targeted test push ─────────────────────────────
-- This inserts ONE notification row for the currently authenticated user.
-- The 034 AFTER INSERT trigger will POST to your Edge Function, which
-- delivers Web Push to every subscription you own.
--
-- After running, check:
--   • Your device — a push notification should appear within ~5 seconds.
--   • The Edge Function logs in the Supabase dashboard — should show one
--     POST with sent=1 (or sent=N if you've subscribed multiple devices).
--   • The bell icon in your client — the row also lands in-app.

INSERT INTO public.notifications
  (user_id, user_email, type, title, body, icon, link_url, metadata)
VALUES
  (auth.uid(),
   auth.email(),
   'push_smoke_test',
   '🚀 Push pipeline test',
   'If you see this on your device, the pipeline is live.',
   '🚀',
   '/dashboard',
   jsonb_build_object('source', 'push_smoke_test.sql', 'when', now()))
RETURNING id, user_id, type, title, created_at;

-- ── Cleanup (optional) ──────────────────────────────────────────────────
-- Uncomment to remove the smoke-test row after you've confirmed delivery.
-- DELETE FROM public.notifications
--  WHERE user_id = auth.uid() AND type = 'push_smoke_test';
