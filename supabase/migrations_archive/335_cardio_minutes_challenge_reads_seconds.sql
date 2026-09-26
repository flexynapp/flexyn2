-- 335 — the "60 min of cardio this week" challenge could never progress.
--
-- `update_solo_challenge_progress` derives the cardio_minutes kind with
-- `SELECT COALESCE(SUM(duration_min), 0) FROM public.cardio_logs`.
--
-- `cardio_logs` has BOTH `duration_min` and `duration_seconds`, and the
-- tracker writes `duration_seconds`. Measured on production 2026-08-10:
-- 5 of 5 rows have duration_seconds, 0 of 5 have duration_min. So the
-- derived value was 0 for every user on every call, and the challenge sat
-- at 0/60 no matter how much cardio anyone logged. Nothing errored —
-- SUM over all-NULL is NULL, COALESCE turns it into a confident zero.
--
-- Found by sweeping every client-written table for columns that are NULL
-- on every row, after the same shape of bug turned up twice in one day on
-- workout_logs (duration_min, then title).
--
-- WHY THIS PATCHES THE INSTALLED BODY INSTEAD OF RESTATING THE FUNCTION
--
-- CLAUDE.md's most expensive lesson is that a later migration redefining a
-- function from a stale template is invisible in the file that "owns" the
-- feature — push notifications had never sent a single request for months
-- because migrations 098 and 127 restated a function from a pre-080 copy.
-- This function is economy code (migration 192 hardened it) and it is long.
-- Restating it here would mean pasting a body copied from a migration file
-- that may not match what is deployed.
--
-- So: read `pg_get_functiondef`, replace ONE expression, re-execute. What
-- ships is whatever is actually installed, plus the fix — no other line can
-- drift. This is idempotent by construction: after it runs, the search
-- string is gone, so a second run finds nothing and says so.
--
-- Paste-safety: no `alias.column` tokens anywhere. The function is
-- addressed by `regprocedure` cast rather than by joining pg_proc to
-- pg_namespace, which is what would otherwise force `p.oid` / `n.nspname`
-- through the clipboard pipeline that mangles them.
--
-- `duration_min` is deliberately still preferred when present. It is not a
-- dead column by intent — migration 005 backfilled it from an older shape —
-- so a row that has it keeps using it, and duration_seconds is the fallback.

-- SELF-VERIFYING ON PURPOSE (revised 2026-08-10, after the first run of
-- this file appeared to succeed and changed nothing).
--
-- The original ended in RAISE NOTICE. **The Supabase SQL editor does not
-- surface NOTICE output**, so every outcome — patched, already-patched,
-- early return — rendered as a bare "Success. No rows returned." The
-- function was still unpatched afterwards and nothing on screen said so.
-- That is precisely the silent-success shape the comment above is written
-- against, reproduced by the fix for it.
--
-- So the block now ends in a SELECT that reads the function back and says
-- OK or FAILED in a row you cannot miss. Verify the OUTPUT, not the
-- absence of an error.

DO $mig$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef(
    'public.update_solo_challenge_progress(numeric,integer,integer,integer)'::regprocedure
  );

  IF position('COALESCE(SUM(duration_min), 0)' in v_def) > 0 THEN
    v_def := replace(
      v_def,
      'COALESCE(SUM(duration_min), 0)',
      'COALESCE(SUM(COALESCE(duration_min, duration_seconds / 60.0)), 0)'
    );
    EXECUTE v_def;
  END IF;
END
$mig$;

SELECT CASE
         WHEN position('duration_seconds / 60.0' in def) > 0
           THEN 'OK - cardio_minutes now reads duration_seconds'
         ELSE 'FAILED - function unchanged, do not close this tab'
       END AS result
FROM (SELECT pg_get_functiondef(
        'public.update_solo_challenge_progress(numeric,integer,integer,integer)'::regprocedure) AS def) s;
