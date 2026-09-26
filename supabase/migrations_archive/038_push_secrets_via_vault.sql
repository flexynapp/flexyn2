-- 038_push_secrets_via_vault.sql
--
-- Why this migration exists:
--
-- The original plan in migration 034 used PostgreSQL's `ALTER DATABASE
-- postgres SET app.send_push_url = …` + `current_setting('app.send_push_url')`
-- to feed the Edge Function URL and shared secret into the push-fanout
-- trigger. That works on self-hosted Postgres but FAILS on managed
-- Supabase with `42501: permission denied to set parameter`: the
-- database is owned by `supabase_admin`, and the regular `postgres`
-- role used by the SQL editor isn't allowed to mutate database-scoped
-- GUCs.
--
-- Supabase's recommended replacement is Supabase Vault — a pgsodium-
-- backed encrypted key/value store with a read view `vault.decrypted_secrets`
-- that SECURITY DEFINER functions can SELECT from. This migration
-- re-points the trigger at Vault.
--
-- ── ONE-TIME OPERATOR STEPS (run in Supabase SQL Editor) ────────────────
--
-- After running this migration:
--
--   SELECT vault.create_secret(
--     'https://<project-ref>.functions.supabase.co/send-push',
--     'send_push_url'
--   );
--
--   SELECT vault.create_secret(
--     '<openssl rand -hex 32 — same value you set as SEND_PUSH_TRIGGER_SECRET
--      on the Edge Function via `supabase secrets set`>',
--     'send_push_secret'
--   );
--
-- To rotate later:
--
--   SELECT vault.update_secret(
--     (SELECT id FROM vault.secrets WHERE name = 'send_push_secret'),
--     '<new value>'
--   );
--
-- The trigger reads both secrets on every notification insert; rotation
-- takes effect immediately on the next push without redeploy.

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- ── Refreshed trigger function ──────────────────────────────────────────
-- Identical contract to migration 034's version, but reads from Vault
-- instead of current_setting(). Falls back to current_setting() if the
-- vault rows aren't present yet, so this is forward-compatible with the
-- old wiring during a rolling deploy.

CREATE OR REPLACE FUNCTION public.notify_push_fanout()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_url      TEXT;
  v_secret   TEXT;
  v_body     JSONB;
  v_category TEXT;
  v_prefs    JSONB;
BEGIN
  -- Try Vault first. Wrapped in EXCEPTION so a missing extension /
  -- secret / permissions issue silently degrades to no-op — the
  -- notification insert MUST always succeed.
  BEGIN
    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets
     WHERE name = 'send_push_url'
     LIMIT 1;
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets
     WHERE name = 'send_push_secret'
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_url := NULL; v_secret := NULL;
  END;

  -- Legacy fallback: if Vault rows aren't set up yet but the operator
  -- still has the GUCs configured from migration 034, honor those.
  -- Removes the need for an in-place cutover.
  IF v_url IS NULL OR v_url = '' THEN
    BEGIN
      v_url := current_setting('app.send_push_url', true);
    EXCEPTION WHEN OTHERS THEN
      v_url := NULL;
    END;
  END IF;
  IF v_secret IS NULL OR v_secret = '' THEN
    BEGIN
      v_secret := current_setting('app.send_push_secret', true);
    EXCEPTION WHEN OTHERS THEN
      v_secret := NULL;
    END;
  END IF;

  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    -- Not configured yet → no-op. In-app notification still inserts.
    RETURN NEW;
  END IF;

  -- Honor per-category notification preferences (migration 036).
  BEGIN
    v_category := public.notification_type_category(NEW.type);
    IF v_category IS NOT NULL THEN
      SELECT notification_prefs INTO v_prefs
        FROM public.user_profiles
       WHERE id = NEW.user_id;
      IF v_prefs IS NOT NULL
         AND v_prefs ? v_category
         AND (v_prefs ->> v_category) = 'false' THEN
        RETURN NEW;
      END IF;
    END IF;
  EXCEPTION WHEN undefined_function THEN
    NULL;
  WHEN OTHERS THEN
    NULL;
  END;

  -- Build the push payload (matches send-push's PushPayload shape).
  v_body := jsonb_build_object(
    'user_id', NEW.user_id,
    'title',   COALESCE(NEW.title, 'Flexyn'),
    'body',    COALESCE(NEW.body,  ''),
    'icon',    NEW.icon,
    'url',     COALESCE(NEW.link_url, '/'),
    'tag',     NEW.type
  );

  -- Fire-and-forget via pg_net. Errors logged, never raised.
  BEGIN
    PERFORM extensions.http_post(
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

-- The trigger itself doesn't need re-creating — CREATE OR REPLACE on
-- the function above is enough; PostgreSQL re-binds the existing
-- trigger to the new function body automatically.

NOTIFY pgrst, 'reload schema';
