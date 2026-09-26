-- Ops health timed out: purge pg_cron's run history and look up the
-- collector's last run by job id.
--
-- The 16:25 UTC run of the "Ops health" Action on 2026-09-26 got
-- `57014 canceling statement due to statement timeout` from ops_health
-- (issue #77). The workflow calls it with the anon key, and anon's
-- statement_timeout is 3s.
--
-- The slow part is the collector lookup. cron.job_run_details has never
-- been purged: 253,351 rows (46 MB) back to 2026-05-13, growing by about
-- 2,300 a day across 21 jobs, and its only index is the runid primary
-- key. ops_health joined it to cron.job by name, and the planner, working
-- from stale statistics (it estimated 939 rows), materialised the whole
-- table to temp and filtered the join row by row: 184 ms with a warm
-- cache, and slower on every future day. A cold cache on a small instance
-- pushed it past 3s.
--
-- Two changes:
--   1. A daily cron deletes run history older than 7 days, as the Supabase
--      pg_cron docs recommend. ops_collect_alerts only reads the last
--      2 hours and ops_health the last 3, so nothing that reads this
--      table loses anything. The first run removes about 237,000 rows.
--   2. ops_health resolves the job id first, then reads only that job's
--      runs from the last day. That is a single-table scan with no join
--      and no materialise, bounded by the purge above.
--
-- Nothing a user sees changes. ops_health returns the same JSON shape.

SELECT cron.schedule(
  'purge-cron-run-history',
  '23 4 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$$
);

CREATE OR REPLACE FUNCTION public.ops_health(p_secret text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_expected     text;
  v_count        integer;
  v_recent       jsonb;
  v_job_id       bigint;
  v_last_collect timestamptz;
BEGIN
  SELECT decrypted_secret INTO v_expected
    FROM vault.decrypted_secrets WHERE name = 'ops_health_secret';
  IF v_expected IS NULL OR p_secret IS NULL OR p_secret <> v_expected THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_count
    FROM public.ops_alerts WHERE observed_at > now() - interval '24 hours';

  SELECT coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_recent
    FROM (SELECT source, ref, count(*) AS n, max(observed_at) AS last_seen, max(detail) AS sample
            FROM public.ops_alerts
           WHERE observed_at > now() - interval '24 hours'
           GROUP BY source, ref
           ORDER BY count(*) DESC
           LIMIT 10) r;

  -- Resolve the id first so the run-history read is one table, one job,
  -- one day. 'ok' only looks back 3 hours, so a day is ample.
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'ops-collect-alerts';

  SELECT max(start_time) INTO v_last_collect
    FROM cron.job_run_details
   WHERE jobid = v_job_id
     AND status = 'succeeded'
     AND start_time > now() - interval '1 day';

  RETURN jsonb_build_object(
    'ok', v_count = 0 AND v_last_collect > now() - interval '3 hours',
    'alerts_24h', v_count,
    'collector_last_ok', v_last_collect,
    'groups', v_recent
  );
END;
$$;

-- CREATE OR REPLACE keeps the existing grants; restated so this file says
-- who may call it. anon is intended: the Action authenticates with the
-- vault secret, not a role.
REVOKE ALL ON FUNCTION public.ops_health(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ops_health(text) TO anon, authenticated, service_role;
