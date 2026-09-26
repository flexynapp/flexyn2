-- 387_ops_alerts.sql
--
-- Failure alerting for the things that fail silently.
--
-- Why: pg_cron records a job as 'succeeded' when net.http_post QUEUES a
-- request, so an Edge Function answering 401/404/500 never shows as a failed
-- job. That is exactly how the weekly-review cron 404'd every Sunday for ten
-- weeks unnoticed (see CLAUDE.md, Push notifications). The only evidence is
-- net._http_response, and pg_net deletes those rows after about six hours, so
-- anything that is not looking within that window never sees them.
--
-- This migration:
--   1. public.ops_alerts        — a durable copy of every failure.
--   2. ops_collect_alerts()      — hourly cron: copies the last hour's failed
--                                  cron runs and non-2xx / errored HTTP calls
--                                  into ops_alerts before pg_net forgets them.
--   3. ops_health(p_secret)      — what the GitHub "Ops health" workflow calls
--                                  every six hours. It opens a GitHub issue
--                                  (so you get an email) when anything failed.
--
-- The secret: ops_health is callable with the public anon key, so it is gated
-- on a Vault secret instead of a role. Step 4 below creates that secret once;
-- copy it into the GitHub repo secret OPS_HEALTH_SECRET.
--
-- Paste-safe: bare columns, public.<table>, and a CTE-renamed join key.

-- ── 1. Table ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_alerts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source      text        NOT NULL,          -- 'cron' | 'http'
  ref         text,                          -- cron job name, or HTTP status
  detail      text,                          -- trimmed error / response body
  source_id   bigint,                        -- runid or net response id
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS ops_alerts_observed_at_idx ON public.ops_alerts (observed_at DESC);

-- No policies on purpose: only the SECURITY DEFINER functions touch it.
ALTER TABLE public.ops_alerts ENABLE ROW LEVEL SECURITY;

-- ── 2. Collector ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_collect_alerts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cron integer := 0;
  v_http integer := 0;
BEGIN
  -- Failed cron runs. 2h lookback against an hourly schedule, so one missed
  -- tick loses nothing; UNIQUE (source, source_id) makes the overlap harmless.
  INSERT INTO public.ops_alerts (source, ref, detail, source_id, observed_at)
  SELECT 'cron', jobname, left(coalesce(return_message, ''), 500), runid, coalesce(end_time, start_time, now())
    FROM cron.job_run_details
    JOIN (SELECT jobid AS j_id, jobname FROM cron.job) jobs ON jobid = j_id
   WHERE status = 'failed'
     AND start_time > now() - interval '2 hours'
  ON CONFLICT (source, source_id) DO NOTHING;
  GET DIAGNOSTICS v_cron = ROW_COUNT;

  -- HTTP calls made by pg_net (push fan-out, weekly reviews, storage GC...)
  -- that errored, timed out, or answered outside 2xx.
  INSERT INTO public.ops_alerts (source, ref, detail, source_id, observed_at)
  SELECT 'http',
         coalesce(status_code::text, 'no response'),
         left(coalesce(error_msg, content, ''), 500),
         id,
         created
    FROM net._http_response
   WHERE created > now() - interval '2 hours'
     AND (status_code IS NULL OR status_code < 200 OR status_code >= 300
          OR timed_out IS TRUE OR error_msg IS NOT NULL)
  ON CONFLICT (source, source_id) DO NOTHING;
  GET DIAGNOSTICS v_http = ROW_COUNT;

  -- Keep 90 days.
  DELETE FROM public.ops_alerts WHERE observed_at < now() - interval '90 days';

  RETURN v_cron + v_http;
END;
$$;

-- Cron-only. Without this REVOKE it is a public PostgREST endpoint
-- (CLAUDE.md, Scheduled workouts).
REVOKE ALL ON FUNCTION public.ops_collect_alerts() FROM PUBLIC, anon, authenticated;

-- ── 3. Health read for the GitHub workflow ───────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_health(p_secret text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_expected text;
  v_count    integer;
  v_recent   jsonb;
  v_last_collect timestamptz;
BEGIN
  SELECT decrypted_secret INTO v_expected
    FROM vault.decrypted_secrets
   WHERE name = 'ops_health_secret';

  IF v_expected IS NULL OR p_secret IS NULL OR p_secret <> v_expected THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_count
    FROM public.ops_alerts
   WHERE observed_at > now() - interval '24 hours';

  SELECT coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_recent
    FROM (SELECT source, ref, count(*) AS n, max(observed_at) AS last_seen, max(detail) AS sample
            FROM public.ops_alerts
           WHERE observed_at > now() - interval '24 hours'
           GROUP BY source, ref
           ORDER BY count(*) DESC
           LIMIT 10) r;

  -- The collector itself is the one thing that cannot report its own death.
  SELECT max(start_time) INTO v_last_collect
    FROM cron.job_run_details
    JOIN (SELECT jobid AS j_id, jobname FROM cron.job) jobs ON jobid = j_id
   WHERE jobname = 'ops-collect-alerts'
     AND status = 'succeeded';

  RETURN jsonb_build_object(
    'ok',            v_count = 0 AND v_last_collect > now() - interval '3 hours',
    'alerts_24h',    v_count,
    'collector_last_ok', v_last_collect,
    'groups',        v_recent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ops_health(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ops_health(text) TO anon, authenticated;

-- ── 4. Schedule, and the shared secret (both idempotent) ─────────────────
SELECT cron.unschedule('ops-collect-alerts')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ops-collect-alerts');
SELECT cron.schedule('ops-collect-alerts', '50 * * * *', 'SELECT public.ops_collect_alerts()');

SELECT vault.create_secret(replace(gen_random_uuid()::text, '-', ''), 'ops_health_secret')
 WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'ops_health_secret');

-- A wrong secret must be refused. If ops_health ever accepts one, this block
-- aborts the paste with a clear message.
DO $$
BEGIN
  PERFORM public.ops_health('not-the-secret');
  RAISE EXCEPTION 'ops_health accepted a wrong secret';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END;
$$;

-- Check: run the collector once and show
-- the secret to copy into GitHub (Settings > Secrets > Actions >
-- OPS_HEALTH_SECRET). The last column is that value.
SELECT
  public.ops_collect_alerts() AS alerts_collected_now,
  (SELECT count(*) FROM cron.job WHERE jobname = 'ops-collect-alerts') AS collector_scheduled,
  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'ops_health_secret') AS ops_health_secret;
