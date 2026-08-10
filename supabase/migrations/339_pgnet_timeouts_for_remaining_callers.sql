-- 339 — the other three pg_net callers still record timeouts for work that
-- succeeds.
--
-- 337 fixed this for `kick_storage_gc` alone. It is not a storage-GC bug; it
-- is a property of `net.http_post`, whose `timeout_milliseconds` defaults to
-- **5000**. A cold Supabase Edge Function boot measures ~4.8s here, so pg_net
-- abandons the request a few hundred milliseconds before the function answers
-- — while the function keeps running and completes the work regardless.
--
-- Measured on production 2026-08-10, every `public` function that calls
-- `net.http_post`:
--
--   kick_storage_gc            timeout_milliseconds present   (337)
--   kick_weekly_reviews        ABSENT — inherits 5000
--   notify_push_fanout         ABSENT — inherits 5000
--   notify_push_fanout_batch   ABSENT — inherits 5000
--
-- WHY THIS IS WORTH A MIGRATION RATHER THAN A SHRUG
--
-- The failure is silent and inverted: the work succeeds, the record says it
-- failed. `net._http_response` is the only table anyone consults to ask "did
-- the dispatch land?", and for these three it can answer no while the push
-- was delivered and the reviews were generated. That is the exact shape that
-- hid the storage GC fault for weeks — a WARNING nobody reads beside a cron
-- that reports `succeeded` — and it costs nothing to close.
--
-- `kick_weekly_reviews` is the most exposed of the three. Cron job 26 runs
-- `0 20 * * 0` — once a week — so its endpoint is cold EVERY time it fires.
-- It is the one caller that is guaranteed to hit the cold path rather than
-- merely risking it. The two push functions fire on triggers often enough to
-- keep `send-push` warm, so they only misreport after an idle gap.
--
-- 30s, matching 337: six times the observed ~4.8s cold boot, and far below
-- the weekly cron's period. The push functions are trigger-driven and have no
-- period to undercut. Note this only changes how long pg_net WAITS for the
-- response — `net.http_post` still merely queues, so no caller's transaction
-- blocks for any longer than it does today.
--
-- WHY PATCHING THE INSTALLED BODY, AGAIN
--
-- Same reason as 336 and 337, and CLAUDE.md's most expensive lesson: a later
-- migration redefining a function from a stale template is invisible in the
-- file that owns the feature — the push pipeline itself sent nothing for
-- months that way, which makes `notify_push_fanout` a particularly poor
-- candidate for retyping from memory. Read `pg_get_functiondef`, insert one
-- argument, re-execute. What ships is whatever is actually installed, plus
-- the fix.
--
-- Verified before shipping, not assumed: all three call sites use NAMED
-- arguments (`url :=`, `body :=`, `headers :=`), so prepending one more named
-- argument is valid — PostgreSQL rejects positional arguments after named
-- ones, and had any call been positional this replace would have produced a
-- function that no longer compiles. Each has exactly one real
-- `net.http_post(` call site. `kick_weekly_reviews` also mentions
-- "net.http_post" in a COMMENT, but with no following paren, so anchoring on
-- `net.http_post(` cannot touch it.
--
-- Replacing a trigger function's body does not detach its triggers — they
-- bind by oid, which `CREATE OR REPLACE` preserves. `notify_push_fanout` and
-- `notify_push_fanout_batch` both RETURN trigger and stay wired.
--
-- Idempotent by construction: the guard skips any function that already
-- carries a `timeout_milliseconds`, so a second run is a no-op and 337's work
-- on `kick_storage_gc` is left alone.
--
-- Ends in a SELECT, not a RAISE NOTICE — the Supabase SQL editor does not
-- surface NOTICE output, which silently cost a run of 335. The report names
-- every caller and its state, so a partial application is visible rather than
-- averaged into a single OK.
--
-- Paste-safety: no `alias.column` tokens. Functions are addressed by
-- `regprocedure` casts over a literal array rather than joining pg_proc to
-- pg_namespace, which would force `p.oid` / `n.nspname` through the clipboard
-- pipeline that mangles them.

DO $mig$
DECLARE
  v_fn  text;
  v_def text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.kick_weekly_reviews()',
    'public.notify_push_fanout()',
    'public.notify_push_fanout_batch()'
  ] LOOP
    v_def := pg_get_functiondef(v_fn::regprocedure);

    IF position('net.http_post(' in v_def) = 0 THEN
      RAISE EXCEPTION '339: % no longer calls net.http_post - refusing to patch blind', v_fn;
    END IF;

    IF position('timeout_milliseconds' in v_def) = 0 THEN
      v_def := replace(
        v_def,
        'net.http_post(',
        'net.http_post(timeout_milliseconds := 30000, '
      );
      EXECUTE v_def;
    END IF;
  END LOOP;
END
$mig$;

SELECT fn,
       CASE
         WHEN position('timeout_milliseconds' in pg_get_functiondef(fn::regprocedure)) > 0
           THEN 'OK - waits 30s'
         ELSE 'FAILED - still on the 5s default, do not close this tab'
       END AS result
FROM unnest(ARRAY[
       'public.kick_storage_gc()',
       'public.kick_weekly_reviews()',
       'public.notify_push_fanout()',
       'public.notify_push_fanout_batch()'
     ]) AS fn;
