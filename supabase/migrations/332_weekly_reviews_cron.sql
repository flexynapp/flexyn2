-- 332_weekly_reviews_cron.sql
--
-- Schedules the weekly review generator, and does it the way the LAST attempt
-- should have been done.
--
-- The predecessor (cron.job id 5, 'weekly-debrief-generator') did two things
-- wrong and both are corrected here:
--
--   1. It carried the project's service_role JWT in PLAINTEXT inside
--      cron.job.command. A service_role key bypasses every RLS policy in the
--      project; it does not belong in a table. Secrets live in the Vault and
--      the cron command is a bare function call, matching kick_storage_gc.
--   2. It posted to /functions/v1/generateWeeklyDebriefs, which had never
--      been deployed, so it 404'd every Sunday at 20:00 for TEN WEEKS while
--      reporting success — `net.http_post` only queues, so the job always
--      records 'succeeded' regardless of what comes back. It was also the
--      only row in net._http_response most weeks, which is how it got
--      misdiagnosed as a push-delivery failure (see the Push section of
--      CLAUDE.md).
--
-- Lesson encoded here: **the dispatch is async, so the cron's own status
-- tells you nothing.** net._http_response is the only place the outcome
-- shows. kick_weekly_reviews() raises a WARNING when the Vault entries are
-- missing rather than returning quietly, because that is the other way this
-- can be silently dead.
--
-- Why async at all: the handler loops over every active user, which exceeds
-- the http extension's synchronous timeout. kick_storage_gc can afford
-- extensions.http_post because it posts a fixed small batch; this cannot.
--
-- ── ONE MANUAL STEP THIS MIGRATION CANNOT DO ───────────────────────────────
-- `DEBRIEF_CRON_SECRET` must be set as an EDGE FUNCTION SECRET (Supabase
-- dashboard → Edge Functions → Secrets) to the same value stored in the Vault
-- as 'debrief_cron_secret'. There is no SQL or MCP path to function secrets.
-- Until it is set, every run returns 401 and generates nothing — reviews still
-- generate on demand when a user opens the screen, so the app is not broken,
-- but the Sunday push does not happen.
--
-- Reveal the value to paste:
--   SELECT decrypted_secret FROM vault.decrypted_secrets
--    WHERE name = 'debrief_cron_secret';
--
-- Verify after setting it:
--   SELECT public.kick_weekly_reviews();
--   -- wait ~10s, then:
--   SELECT status_code, content FROM net._http_response ORDER BY id DESC LIMIT 1;
--   -- 200 with {"ok":true,...} is working. 401 means the values still differ.

-- The secret itself was generated IN-DATABASE with gen_random_bytes so that
-- it never passed through a transcript or a clipboard. Re-running this block
-- must NOT mint a new one — that would silently break the match with the
-- dashboard value.
DO $seed$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'debrief_cron_secret') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'debrief_cron_secret',
      'Shared secret for generateWeeklyDebriefs (X-Cron-Secret). Must match the DEBRIEF_CRON_SECRET function secret.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'debrief_func_url') THEN
    PERFORM vault.create_secret(
      'https://ebvqxuwfiptcmlkhflfj.functions.supabase.co/generateWeeklyDebriefs',
      'debrief_func_url',
      'Endpoint for the weekly review generator cron.');
  END IF;
END
$seed$;

CREATE OR REPLACE FUNCTION public.kick_weekly_reviews()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault', 'net'
AS $fn$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets WHERE name = 'debrief_func_url' LIMIT 1;
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets WHERE name = 'debrief_cron_secret' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_url := NULL; v_secret := NULL;
  END;

  -- Loud, not silent — see the migration head.
  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RAISE WARNING '[kick_weekly_reviews] vault entries missing — not dispatching';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'X-Cron-Secret', v_secret),
    body    := '{}'::jsonb
  );
END;
$fn$;

-- pg_cron runs the job as its owner, so the cron is unaffected by this. The
-- REVOKE stops any signed-in user POSTing to /rest/v1/rpc/kick_weekly_reviews
-- to fire the whole generation loop and push fan-out early — the same hole
-- migration 276 closed on fire_scheduled_workout_reminders. Every function in
-- the public schema is a PostgREST endpoint until you revoke it.
REVOKE ALL ON FUNCTION public.kick_weekly_reviews() FROM PUBLIC, anon, authenticated;

-- Sunday 20:00 UTC. The handler defaults to the CURRENT ISO week, which on a
-- Sunday is the week that is ending — do not move this to Monday without
-- passing an explicit week_start, or it would generate the new, empty week.
SELECT cron.unschedule('weekly-reviews-generator')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-reviews-generator');

SELECT cron.schedule('weekly-reviews-generator', '0 20 * * 0',
                     'SELECT public.kick_weekly_reviews();');
