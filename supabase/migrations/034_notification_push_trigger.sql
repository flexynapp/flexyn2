-- 034_notification_push_trigger.sql
--
-- Auto-fanout Web Push for every row inserted into public.notifications.
--
-- WHY a DB trigger (not application code):
--   • Every code path that creates a notification — direct INSERT,
--     create_notification_for() RPC, future server-side jobs, the
--     streak-break cron in migration 035 — runs through the same trigger.
--     Nobody can forget to call send-push because they can't bypass it.
--   • Fan-out is fire-and-forget via pg_net. If the Edge Function is slow
--     or down, the INSERT still commits and the user still sees the
--     in-app notification on next refresh. Push is best-effort, by design.
--
-- WHY the trigger never raises on delivery failure:
--   If the Edge Function call fails (network, secret unset, function
--   undeployed), we MUST NOT roll back the notification insert — the
--   in-app notification is the source of truth and push is supplementary.
--   Every pg_net call is wrapped in an exception-swallowing block.
--
-- ── REQUIRED CONFIGURATION ────────────────────────────────────────────────
--
-- The trigger reads two runtime settings via current_setting(... , true).
-- Until these are set, the trigger is a no-op (gracefully degrades —
-- the notification still inserts, just without push fanout):
--
--   ALTER DATABASE postgres SET app.send_push_url    =
--     'https://<project-ref>.functions.supabase.co/send-push';
--   ALTER DATABASE postgres SET app.send_push_secret = '<openssl rand -hex 32>';
--
-- The same secret MUST be set on the Edge Function as
-- SEND_PUSH_TRIGGER_SECRET (see supabase/functions/send-push/index.ts).
-- After running ALTER DATABASE, reconnect (or restart your Supabase
-- pooler / `SELECT pg_reload_conf();`) so the new settings take effect
-- in the trigger session.
--
-- ── REQUIRED EXTENSION ────────────────────────────────────────────────────
--
-- pg_net is preinstalled on Supabase but lives in the `extensions`
-- schema by default. We grant ourselves the right to call it explicitly.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── Trigger function ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_push_fanout()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
  v_body   JSONB;
BEGIN
  -- Read runtime config. Missing settings → silently no-op so the
  -- notification insert still succeeds in dev / partially-configured
  -- environments.
  BEGIN
    v_url    := current_setting('app.send_push_url',    true);
    v_secret := current_setting('app.send_push_secret', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;

  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RETURN NEW;
  END IF;

  -- Build the payload matching send-push's PushPayload shape.
  v_body := jsonb_build_object(
    'user_id', NEW.user_id,
    'title',   COALESCE(NEW.title, 'Flexyn'),
    'body',    COALESCE(NEW.body,  ''),
    'icon',    NEW.icon,
    'url',     COALESCE(NEW.link_url, '/'),
    'tag',     NEW.type
  );

  -- Fire-and-forget. pg_net queues the request and returns immediately;
  -- the actual HTTP POST happens in the pg_net background worker.
  -- Wrap in BEGIN/EXCEPTION so a missing extension or transient error
  -- never breaks the notification insert.
  BEGIN
    PERFORM extensions.http_post(
      url     := v_url,
      body    := v_body,
      headers := jsonb_build_object(
        'Content-Type',         'application/json',
        'X-Send-Push-Secret',   v_secret
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Log but don't fail. The in-app notification is the source of truth.
    RAISE WARNING '[notify_push_fanout] pg_net dispatch failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Lock down execution. Only the trigger context (superuser/owner) should
-- ever call this directly. We do NOT grant EXECUTE to authenticated.
REVOKE ALL ON FUNCTION public.notify_push_fanout() FROM PUBLIC;

-- ── Wire up the trigger ──────────────────────────────────────────────────
-- AFTER INSERT so the row is already visible to subsequent reads (the
-- Edge Function does not read the notification row — it just receives
-- the payload — but downstream subscribers polling the table benefit).
-- FOR EACH ROW because we want one push per notification, not one per
-- statement.

DROP TRIGGER IF EXISTS trg_notifications_push_fanout ON public.notifications;

CREATE TRIGGER trg_notifications_push_fanout
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_push_fanout();

-- ── Sanity check ─────────────────────────────────────────────────────────
-- If pg_net was just installed in this migration run, the background
-- worker may not yet be active. The first INSERT after deploy may queue
-- but not deliver until the worker spins up. Subsequent inserts work
-- normally.

NOTIFY pgrst, 'reload schema';
