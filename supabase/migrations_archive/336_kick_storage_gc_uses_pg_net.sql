-- 336 — the storage GC cron has never dispatched a single request.
--
-- `kick_storage_gc()` ends in:
--
--     PERFORM extensions.http_post(url := ..., headers := ..., body := ...)
--
-- There is no such function. This project's only `http_post` is pg_net's
-- `net.http_post(url text, body jsonb, params jsonb, headers jsonb,
-- timeout_milliseconds integer)` — right name, right parameter names,
-- wrong SCHEMA in the call. And `net` is not on this function's pinned
-- search_path ('public', 'extensions', 'vault'), so it cannot be found
-- unqualified either; it has to be spelled `net.http_post`.
--
-- Measured on production 2026-08-10: cron job 18 runs `*/5 * * * *` and
-- logged, on every single firing in the visible window:
--
--     [kick_storage_gc] dispatch failed: function extensions.http_post(
--     url => text, headers => jsonb, body => jsonb) does not exist
--
-- Everything else was already correct. The `storage-gc` Edge Function is
-- deployed and ACTIVE (v8, verify_jwt false — it authenticates on its own
-- X-Storage-GC-Secret, so a gateway JWT check would reject the call before
-- its auth gate ran). The vault carries both `storage_gc_url` and
-- `storage_gc_secret`, and that URL does point at `storage-gc`. One token
-- was wrong, and it was the only thing between the queue and the worker.
--
-- WHY IT NEVER SURFACED AS A BUG
--
-- The dispatch sits inside `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE
-- WARNING`, which is right — a failed GC dispatch must not abort the cron
-- or roll back the queue. But a WARNING in the postgres log is not a place
-- anyone looks, and the two guards above it (no secrets, empty queue) both
-- `RETURN` in silence. So "healthy no-op" and "broken call" are
-- indistinguishable from outside, and pg_cron recorded `succeeded` every
-- five minutes for as long as this has been deployed.
--
-- Worth keeping: reaching that WARNING is itself evidence. It can only
-- fire after the secrets resolved AND the queue was non-empty, so its
-- presence proves the two silent guards passed. An empty log here would
-- have been genuinely ambiguous; a noisy one was diagnostic.
--
-- Only 2 rows are pending, so nothing is lost yet — the point is to fix it
-- before the queue is big enough to matter.
--
-- WHY THIS PATCHES THE INSTALLED BODY INSTEAD OF RESTATING THE FUNCTION
--
-- Same reasoning as 335, and it is CLAUDE.md's most expensive lesson: a
-- later migration redefining a function from a stale template is invisible
-- in the file that "owns" the feature — push notifications sent nothing for
-- months that way. This function is SECURITY DEFINER with a pinned
-- search_path, i.e. exactly the kind whose deployed body you should not
-- retype from memory. Read `pg_get_functiondef`, replace one token,
-- re-execute: what ships is whatever is actually installed, plus the fix.
-- Idempotent by construction — after it runs the search string is gone.
--
-- Verified before shipping, not assumed: applying this replace inside a
-- transaction and calling the function moved `net.http_request_queue` from
-- 0 to 1, proving it genuinely dispatches rather than merely compiling.
-- Then rolled back, and prod re-checked to confirm it was still unpatched.
--
-- ENDS IN A SELECT, NOT A RAISE NOTICE — the Supabase SQL editor does not
-- surface NOTICE output. 335's first run reported "Success. No rows
-- returned." having done nothing at all, and was believed for hours.
-- Anything handed to an operator must state its own outcome in a row.
--
-- Paste-safety: no `alias.column` tokens. The function is addressed by a
-- `regprocedure` cast rather than joining pg_proc to pg_namespace, which
-- would otherwise force `p.oid` / `n.nspname` through the clipboard
-- pipeline that mangles them.

DO $mig$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.kick_storage_gc()'::regprocedure);

  IF position('extensions.http_post(' in v_def) > 0 THEN
    v_def := replace(v_def, 'extensions.http_post(', 'net.http_post(');
    EXECUTE v_def;
  END IF;
END
$mig$;

SELECT CASE
         WHEN position('net.http_post(' in def) > 0
          AND position('extensions.http_post(' in def) = 0
           THEN 'OK - kick_storage_gc now calls net.http_post'
         ELSE 'FAILED - function unchanged, do not close this tab'
       END AS result
FROM (SELECT pg_get_functiondef(
        'public.kick_storage_gc()'::regprocedure) AS def) s;
