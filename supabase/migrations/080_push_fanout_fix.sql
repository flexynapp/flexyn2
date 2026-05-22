-- 080_push_fanout_fix.sql
--
-- Two production bugs in the Web Push fanout pipeline, discovered while
-- bringing up the first live deploy. Both made the trigger silently no-op
-- so notifications inserted fine but no push was ever attempted.
--
-- ── Bug 1: extensions.http_post does not exist ──────────────────────────
--
-- Migrations 034 and 038 install pg_net via `CREATE EXTENSION pg_net WITH
-- SCHEMA extensions`, then call `extensions.http_post(...)`. The SCHEMA
-- clause moves the extension's bookkeeping into `extensions`, but pg_net
-- still creates its own `net` schema and exposes `http_post` ONLY at
-- `net.http_post(url text, body jsonb DEFAULT '{}', ...)`. The call
-- `extensions.http_post(...)` raises `42883: function does not exist`,
-- which the surrounding EXCEPTION WHEN OTHERS block swallowed silently.
-- Result: the trigger function returned NEW without ever queuing a
-- request, so `net._http_response` stayed empty and the Edge Function
-- Invocations page showed nothing.
--
-- Fix: re-create notify_push_fanout calling `net.http_post` directly.
-- The body is otherwise identical to migration 038's version.
--
-- ── Bug 2: service_role lacks SELECT on push_subscriptions ──────────────
--
-- Migration 033 enables RLS and creates policies for the `authenticated`
-- role (clients reading their own subscriptions) but never grants the
-- `service_role` access to the table. The send-push Edge Function
-- authenticates with SUPABASE_SERVICE_ROLE_KEY, and even though
-- service_role bypasses RLS, it still needs table-level GRANT to issue
-- a SELECT. Without it, every subscription lookup returns Postgres
-- error 42501 ("permission denied for table push_subscriptions"), the
-- function returns 500 `lookup_failed`, and no push goes out even for
-- users who DO have a subscription row.
--
-- Fix: grant service_role full DML on push_subscriptions. The function
-- also needs to DELETE rows when an endpoint returns 410 Gone (expired
-- subscription cleanup), so SELECT alone isn't enough.
--
-- ── Forward-compatibility ────────────────────────────────────────────────
--
-- Re-running 034/038 unchanged would re-introduce both bugs. This
-- migration is the post-deploy fix; future schema dumps and fresh
-- environments will get a correctly-functioning pipeline after applying
-- 033 → 080 in order. The original migrations are left untouched as
-- historical record.

-- ── Fix 1: notify_push_fanout calling net.http_post ─────────────────────

CREATE OR REPLACE FUNCTION public.notify_push_fanout()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, net
AS $$
DECLARE
  v_url      TEXT;
  v_secret   TEXT;
  v_body     JSONB;
  v_category TEXT;
  v_prefs    JSONB;
BEGIN
  -- Vault-first (preferred). EXCEPTION-wrapped so a missing extension /
  -- secret / permissions issue degrades to no-op — the in-app
  -- notification insert MUST always succeed.
  BEGIN
    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets WHERE name = 'send_push_url'    LIMIT 1;
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets WHERE name = 'send_push_secret' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_url := NULL; v_secret := NULL;
  END;

  -- Legacy fallback for environments still configured via ALTER DATABASE
  -- (self-hosted Postgres or non-managed Supabase).
  IF v_url IS NULL OR v_url = '' THEN
    BEGIN
      v_url := current_setting('app.send_push_url', true);
    EXCEPTION WHEN OTHERS THEN v_url := NULL;
    END;
  END IF;
  IF v_secret IS NULL OR v_secret = '' THEN
    BEGIN
      v_secret := current_setting('app.send_push_secret', true);
    EXCEPTION WHEN OTHERS THEN v_secret := NULL;
    END;
  END IF;

  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    -- Not configured yet → no-op. The in-app notification still lands.
    RETURN NEW;
  END IF;

  -- Honor per-category notification preferences (migration 036). If the
  -- type maps to a category the user muted, skip push (in-app row still
  -- inserts).
  BEGIN
    v_category := public.notification_type_category(NEW.type);
    IF v_category IS NOT NULL THEN
      SELECT notification_prefs INTO v_prefs
        FROM public.user_profiles WHERE id = NEW.user_id;
      IF v_prefs IS NOT NULL
         AND v_prefs ? v_category
         AND (v_prefs ->> v_category) = 'false' THEN
        RETURN NEW;
      END IF;
    END IF;
  EXCEPTION WHEN undefined_function THEN
    NULL;  -- migration 036 not yet applied
  WHEN OTHERS THEN
    NULL;  -- prefs subsystem failure → over-deliver rather than mute
  END;

  v_body := jsonb_build_object(
    'user_id', NEW.user_id,
    'title',   COALESCE(NEW.title, 'Flexyn'),
    'body',    COALESCE(NEW.body,  ''),
    'icon',    NEW.icon,
    'url',     COALESCE(NEW.link_url, '/'),
    'tag',     NEW.type
  );

  -- The fix: net.http_post, not extensions.http_post. Wrap in EXCEPTION
  -- because pg_net background worker can return transient errors and we
  -- must never break the notification insert.
  BEGIN
    PERFORM net.http_post(
      url     := v_url,
      body    := v_body,
      headers := jsonb_build_object(
        'Content-Type',       'application/json',
        'X-Send-Push-Secret', v_secret
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_push_fanout] pg_net dispatch failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_push_fanout() FROM PUBLIC;

-- ── Fix 2: service_role grants on push_subscriptions ────────────────────
-- send-push Edge Function uses SUPABASE_SERVICE_ROLE_KEY. Needs SELECT
-- (to find subscriptions for a user_id) and DELETE (to clean up 410-Gone
-- endpoints). Granting full DML keeps room for future server-side
-- bookkeeping (e.g. last_seen_at touches from a cleanup cron).

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO service_role;

-- Schema usage shouldn't already be missing, but include it idempotently
-- in case a future migration drops the default.
GRANT USAGE ON SCHEMA public TO service_role;

NOTIFY pgrst, 'reload schema';
