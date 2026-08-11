-- 340_drop_planned_cardio.sql
--
-- Retire the second scheduler.
--
-- Cardio had its own: `planned_cardio` (migration 117), behind
-- Cardio → Planned Sessions. It stored a date and nothing else — no time,
-- so nothing could be resolved against the user's local clock; no cron, so
-- nothing fired; no notification, so nothing was delivered; and no deep
-- link, so a plan was a row you had to remember to come back and look at.
-- `completed_cardio_id` was read by the UI to show "Completed" vs
-- "Not logged" and written by NOTHING, so a past plan could only ever say
-- "Not logged", including one you actually did.
--
-- Meanwhile `scheduled_workouts` (migration 276) does all of it: local date
-- + local hour resolved against timezone_offset_minutes, an hourly cron, a
-- notification row that pushes, a `/workout?scheduled=<id>` deep link that
-- opens the session, and a real status lifecycle. Its `workout` column is
-- free-form JSONB and `schedule_workout()` only requires a JSON object, so
-- a cardio plan needed no new table, no new RPC and no schema change at
-- all — just a `kind: 'cardio'` discriminator inside the payload.
--
-- The client stopped reading `planned_cardio` in the commit that added
-- this file. This drops it.
--
-- ROW COUNT: 0, measured against production 2026-08-11, and 0 on every
-- check since the cardio audit began. The table has never held a row in
-- its entire life — which is most of why replacing it was cheap.
--
-- The guard below is not ceremony. This script may be pasted days after it
-- was written, and "it was empty when I checked" is not the same claim as
-- "it is empty now". If anything has appeared, this RAISES and drops
-- nothing, and the rows are recoverable by re-pointing the UI rather than
-- from a backup.
--
-- PASTE-SAFE: single-table statements, bare column names, no aliases, no
-- record-field access. Per the clipboard rule in CLAUDE.md.

DO $$
DECLARE
  v_rows INTEGER;
BEGIN
  IF to_regclass('public.planned_cardio') IS NULL THEN
    RAISE NOTICE 'planned_cardio is already gone — nothing to do.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_rows FROM public.planned_cardio;

  IF v_rows > 0 THEN
    RAISE EXCEPTION
      'planned_cardio holds % row(s) — refusing to drop. Migrate them to scheduled_workouts first.', v_rows;
  END IF;

  DROP TABLE public.planned_cardio;
  RAISE NOTICE 'planned_cardio dropped (was empty).';
END $$;

-- Proof it ran. The Supabase SQL editor swallows RAISE NOTICE, so a bundle
-- that only notices looks identical to one that silently did nothing —
-- every handover ends in a SELECT that shows its work.
SELECT
  CASE
    WHEN to_regclass('public.planned_cardio') IS NULL
      THEN 'OK — planned_cardio is gone; scheduled_workouts is the only scheduler'
    ELSE 'STILL PRESENT — read the exception above'
  END AS result;
