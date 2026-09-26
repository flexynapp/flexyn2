-- 338 — enqueue the upload blobs that nothing references and nothing ever
-- queued.
--
-- 336 and 337 fixed the storage GC's dispatch. Neither reclaims a byte of
-- what leaked while it was broken, and that is not a gap in those fixes —
-- the GC only ever removes what is in `storage_cleanup_queue`, and these
-- objects were never put there. `purge_expired_stories` enqueues correctly
-- today; the purges that ran before the enqueue path existed deleted the
-- `stories` rows and walked away from the blobs. That is why the queue had
-- only ever held 2 rows while the bucket held dozens of dead files.
--
-- Measured on production 2026-08-10, after the 19:35 cycle drained the
-- backlog: `uploads` held 47 objects / 51 MB, of which 39 (~49 MB) were
-- referenced by nothing anywhere. Oldest 2026-05-14. So ~96% of the bucket
-- was garbage that no amount of correct GC would ever have collected.
--
-- HOW "REFERENCED" IS DECIDED
--
-- By scanning EVERY text / varchar / jsonb column in `public` — 466 of them
-- — not the one table that looks obvious. A check against
-- `stories.image_url` alone would have been wrong twice over: story blobs
-- are also reachable through `story_highlights` (highlighted stories are
-- explicitly exempt from expiry purge), and the bucket also holds DM
-- attachments, hub post images and journal attachments that live in
-- entirely different tables. `auth.users.raw_user_meta_data` was checked
-- separately and holds no upload references.
--
-- The scan is rebuilt from `information_schema` AT RUN TIME rather than
-- baked in as the 39 names measured today. This is the whole safety
-- argument of the migration: a hardcoded list would be a snapshot of a
-- moment that has already passed by the time anyone pastes this, and would
-- happily delete a blob that got attached to a row in the interval. What
-- runs is a fresh measurement, whenever it runs.
--
-- WHY THE 7-DAY FLOOR
--
-- Several upload paths write the blob BEFORE inserting the row that points
-- at it — `HubComposer` and `HubChat` both do, and `JournalView` documents
-- the same leak in its own comments. For a few seconds during any normal
-- composition, a perfectly live object is indistinguishable from an orphan.
-- Seven days is roughly five orders of magnitude past that race, and it
-- also spares anything a user is slowly drafting.
--
-- The cost is honesty about coverage: on today's data this enqueues 38 of
-- the 39 and skips one uploaded 2026-08-05. The report at the bottom prints
-- that skipped count rather than rounding it away — re-running this file
-- next week collects the remainder. Deliberately not tuned down to catch
-- the last file: recovering a wrongly-deleted blob is impossible, and
-- waiting a week is free.
--
-- ONE-WAY DOOR
--
-- Per `supabase/functions/storage-gc/index.ts`, removing an object is
-- irreversible in a way normal deletes are not: the Storage API finds
-- objects through their metadata row, so once the row is gone the S3 blob
-- is unreachable through every supported path, forever. There is no
-- undelete and no recovery from a backup of the database alone. Run the
-- read-only preview query first; this file is the one that acts.
--
-- Nothing is deleted by this migration directly. It only enqueues, and the
-- existing 5-minute cron drains the queue through the real Storage API on
-- its next firing — a batch limit of 200 covers the whole backlog in one
-- pass. Idempotent: `enqueue_storage_cleanup` is `ON CONFLICT DO NOTHING`,
-- and an object already collected is no longer in `storage.objects` to be
-- found a second time.
--
-- Paste-safety: no `alias.column` tokens and no record-field access. The
-- two working sets are single-column temp tables, so every correlated
-- reference below is a bare column name resolved by scope rather than a
-- dotted alias.

DO $mig$
DECLARE
  v_scan    text;
  v_names   text[];
  v_unref   integer := 0;
  v_recent  integer := 0;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _gc_refs (val text) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _gc_cand (obj text) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _gc_report
    (enqueued integer, skipped_recent integer, columns_scanned integer) ON COMMIT DROP;
  DELETE FROM _gc_refs;
  DELETE FROM _gc_cand;
  DELETE FROM _gc_report;

  -- Every text-ish column in public, as a UNION of single-table scans.
  SELECT string_agg(
           format('SELECT %I::text FROM public.%I WHERE %I::text LIKE ''%%/uploads/%%''',
                  column_name, table_name, column_name),
           ' UNION ALL ')
    INTO v_scan
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND data_type IN ('text', 'character varying', 'jsonb')
     AND table_name IN (SELECT table_name
                          FROM information_schema.tables
                         WHERE table_schema = 'public'
                           AND table_type = 'BASE TABLE');

  IF v_scan IS NULL THEN
    RAISE EXCEPTION '338: found no columns to scan - refusing to treat every object as an orphan';
  END IF;

  EXECUTE 'INSERT INTO _gc_refs (val) ' || v_scan;

  INSERT INTO _gc_cand (obj)
  SELECT name
    FROM storage.objects
   WHERE bucket_id = 'uploads'
     AND created_at < now() - interval '7 days';

  SELECT count(*)
    INTO v_recent
    FROM storage.objects
   WHERE bucket_id = 'uploads'
     AND created_at >= now() - interval '7 days';

  SELECT array_agg(obj)
    INTO v_names
    FROM _gc_cand
   WHERE NOT EXISTS (SELECT 1 FROM _gc_refs WHERE val LIKE '%' || obj || '%');

  v_unref := coalesce(array_length(v_names, 1), 0);

  IF v_unref > 0 THEN
    PERFORM public.enqueue_storage_cleanup('uploads', v_names, 'orphan_backfill_338');
  END IF;

  INSERT INTO _gc_report (enqueued, skipped_recent, columns_scanned)
  VALUES (v_unref, v_recent, (length(v_scan) - length(replace(v_scan, ' UNION ALL ', ''))) / 11 + 1);
END
$mig$;

SELECT CASE
         WHEN enqueued = 0
           THEN 'OK - nothing to backfill, no unreferenced objects older than 7 days'
         ELSE 'OK - enqueued ' || enqueued || ' orphaned object(s) across '
              || columns_scanned || ' scanned columns; the 5-minute cron drains them next firing'
       END
       || CASE
            WHEN skipped_recent > 0
              THEN ' (skipped ' || skipped_recent || ' object(s) newer than 7 days - re-run later to collect them)'
            ELSE ''
          END AS result
FROM _gc_report;
