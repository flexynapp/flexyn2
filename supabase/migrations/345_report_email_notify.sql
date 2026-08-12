-- 345_report_email_notify.sql
--
-- Email a moderator when a content report is filed.
--
-- Sean, 12 Aug: "I don't know where these reports go… for right now send all
-- reports to <address> but we're gonna replace that email eventually, and only
-- send emails going forward. I don't care about past reports."
--
-- Three decisions, all of them load-bearing:
--
--  1. FORWARD-ONLY falls out of an AFTER INSERT trigger. There is no backfill
--     and nothing here reads historical rows, so the existing queue is left
--     exactly as it is. This also avoids the hazard documented in CLAUDE.md
--     under the weekly-league resolver, where a catch-up sweep delivered
--     months of backdated notifications in one burst.
--
--  2. The DESTINATION lives in the Vault, not in this file and not in the
--     Edge Function's env. "We're gonna replace that email eventually" should
--     be one UPDATE, not a migration and not a redeploy. Swap it with:
--        SELECT vault.update_secret(
--          (SELECT id FROM vault.secrets WHERE name = 'report_notify_to'),
--          'someone-else@example.com');
--
--  3. The trigger is SILENT on a missing config, exactly like the push fanout
--     in migration 034. A half-deployed notifier must never block someone
--     filing a report — the row still lands and the admin queue still shows
--     it. The cost of that choice is that "never dispatched" and "never
--     triggered" look identical from the outside; net._http_response is the
--     only place it shows, which is why the verification query is at the
--     bottom of this file.
--
-- Paste-safety: every statement here is single-table with bare column names,
-- or uses public.<fn>() / NEW. — no alias.column and no record-field access,
-- per the clipboard rule in CLAUDE.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Secrets. Idempotent: re-running must not create duplicates.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'report_notify_to') THEN
    PERFORM vault.create_secret('Sjoudrie@gmail.com', 'report_notify_to',
      'Where content reports are emailed. Swap with vault.update_secret.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'report_notify_url') THEN
    PERFORM vault.create_secret(
      'https://ebvqxuwfiptcmlkhflfj.functions.supabase.co/report-notify',
      'report_notify_url',
      'Edge Function endpoint for report emails.');
  END IF;

  -- Deliberately NOT auto-generated: this value must match the
  -- REPORT_NOTIFY_SECRET set on the Edge Function. Left empty so a mismatch
  -- shows up as the trigger skipping (visible, harmless) rather than as a
  -- silent 401 on every report.
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'report_notify_secret') THEN
    PERFORM vault.create_secret('', 'report_notify_secret',
      'Shared secret; must equal REPORT_NOTIFY_SECRET on the report-notify function.');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Fanout function.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_report_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_to     TEXT;
  v_url    TEXT;
  v_secret TEXT;
  v_body   JSONB;
BEGIN
  -- Scalar SELECT ... INTO rather than %ROWTYPE + dotted access: record-field
  -- tokens are what the user's paste pipeline mangles.
  SELECT decrypted_secret INTO v_to     FROM vault.decrypted_secrets WHERE name = 'report_notify_to';
  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'report_notify_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'report_notify_secret';

  -- Silent no-op when unconfigured. The report itself has already been
  -- written; refusing to insert it because an email cannot be sent would be
  -- much worse than a missed email.
  IF v_to IS NULL OR v_to = '' OR v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RETURN NEW;
  END IF;

  v_body := jsonb_build_object(
    'to', v_to,
    'report', jsonb_build_object(
      'id',                    NEW.id,
      'reported_type',         NEW.reported_type,
      'reported_id',           NEW.reported_id,
      'reported_author_email', NEW.reported_author_email,
      'reporter_email',        NEW.reporter_email,
      'reason',                NEW.reason,
      'detail',                NEW.detail,
      'created_at',            NEW.created_at
    )
  );

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-report-secret', v_secret
    ),
    body    := v_body
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure roll back the report.
  RETURN NEW;
END $$;

-- Not callable from PostgREST. Every public-schema function is an endpoint
-- until revoked, and this one is SECURITY DEFINER and reads the Vault.
REVOKE ALL ON FUNCTION public.notify_report_email() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_report_email() FROM anon;
REVOKE ALL ON FUNCTION public.notify_report_email() FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Trigger. DROP first — Postgres has no CREATE TRIGGER IF NOT EXISTS, so a
--    retry of a partially-applied migration would fail with 42710.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_hub_reports_email ON public.hub_reports;

CREATE TRIGGER trg_hub_reports_email
AFTER INSERT ON public.hub_reports
FOR EACH ROW
EXECUTE FUNCTION public.notify_report_email();

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY — run these AFTER setting the secret on both sides.
--
--   SELECT name FROM vault.secrets WHERE name LIKE 'report_notify%';
--
-- Then file a test report from the app and check what actually happened.
-- net.http_post only QUEUES, so the trigger reports success either way — this
-- table is the only place delivery shows:
--
--   SELECT status_code, content FROM net._http_response ORDER BY id DESC LIMIT 1;
--
--   200 {"ok":true,"provider":"resend"}  → working
--   401                                   → Vault secret ≠ REPORT_NOTIFY_SECRET
--   404                                   → function not deployed, or wrong URL
--   500 {"ok":false,...}                  → no email provider key on the function
-- ─────────────────────────────────────────────────────────────────────────────
