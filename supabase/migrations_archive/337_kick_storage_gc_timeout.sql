-- 337 — the storage GC dispatch records a timeout for work that SUCCEEDS.
--
-- 336 fixed the call so it dispatches at all. This fixes what it reports.
--
-- `net.http_post` takes `timeout_milliseconds integer DEFAULT 5000`, and
-- `kick_storage_gc` never passed one. A cold Supabase Edge Function boot
-- measures ~4.8s here, so pg_net abandons the request a few hundred
-- milliseconds before the function answers — while the function keeps
-- running and completes the work regardless.
--
-- Measured on production 2026-08-10, the first cycle that ever ran:
--
--   net._http_response id 212   timed_out = true, "Timeout of 5000 ms
--                               reached. Total time: 5002.584 ms"
--                               created 19:15:05.23
--   storage_cleanup_queue       processed_at 19:15:05.788, last_error NULL,
--                               both blobs confirmed gone from
--                               storage.objects
--
-- The work finished 0.56s AFTER the request was recorded as timed out. So
-- the single row anyone would consult to ask "did the GC run?" says no, and
-- it is wrong. That is the entire reason for this migration: the behaviour
-- is already correct, the RECORD of it is not.
--
-- This is not a livelock and 336's note should not be read as one. A
-- timed-out cold call still leaves the instance warm, so the next firing
-- five minutes later answers instantly — it self-heals. The cost is one
-- misleading row per idle gap, not a stuck job.
--
-- 30s rather than something larger: it clears the observed ~4.8s cold boot
-- by a wide margin while still being well under the cron's 5-minute period,
-- so a genuinely hung function cannot pile firings on top of each other.
--
-- WHY NAMED ARGUMENT FIRST
--
-- The new argument goes immediately after the open paren rather than after
-- the existing `body :=`. Named arguments bind in any order, and anchoring
-- on `net.http_post(` depends on nothing but the call itself — no trailing
-- whitespace, no argument order, no indentation. Anchoring on the last
-- argument would have made this migration sensitive to formatting that
-- `pg_get_functiondef` is free to change.
--
-- Verified before shipping: applying this replace in a transaction, seeding
-- one queue row so the function gets past its empty-queue guard, and calling
-- it moved `net.http_request_queue` from 0 to 1 — so the patched function
-- compiles AND still dispatches. Rolled back, and prod re-checked to confirm
-- the probe row and the patch were both gone.
--
-- Ends in a SELECT, not a RAISE NOTICE: the Supabase SQL editor does not
-- surface NOTICE output. See 336.
--
-- Paste-safety: no `alias.column` tokens; the function is addressed by a
-- `regprocedure` cast rather than joining pg_proc to pg_namespace.

DO $mig$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.kick_storage_gc()'::regprocedure);

  IF position('timeout_milliseconds' in v_def) = 0 THEN
    v_def := replace(
      v_def,
      'net.http_post(',
      'net.http_post(timeout_milliseconds := 30000, '
    );
    EXECUTE v_def;
  END IF;
END
$mig$;

SELECT CASE
         WHEN position('timeout_milliseconds := 30000' in def) > 0
           THEN 'OK - storage GC dispatch now waits 30s instead of 5s'
         ELSE 'FAILED - function unchanged, do not close this tab'
       END AS result
FROM (SELECT pg_get_functiondef(
        'public.kick_storage_gc()'::regprocedure) AS def) s;
