-- 383_backfill_regimen_copy_count.sql
--
-- `regimens.copy_count` reads 0 on all 33 rows while clones exist. This
-- recomputes it from the clones themselves.
--
-- IT IS ONE BUMP, NOT TWO. `crews.js` says "TWO clones exist and both counter
-- bumps were dropped on the floor", and the first half is right — there are
-- exactly two rows with a non-null `original_template_id`, both copies of
-- `Upper Body Power Day` (eae29838…, sjoudrie@gmail.com):
--
--   2026-05-22  cloner sjoudrie@gmail.com        <- the AUTHOR copying himself
--   2026-07-28  cloner keganbergeron@gmail.com   <- a real adoption
--
-- `equipRegimen` bumps only when `user.email !== source.created_by`, and its
-- comment says why: "This prevents creators from inflating their own adoption
-- count." The self-copy was never owed a bump. Only one was lost, and paying
-- two would write in exactly the inflation that rule exists to stop.
--
-- WHY THEY WERE LOST, which is already fixed and is not what this repairs: the
-- bump was a direct cross-user UPDATE, and the owner-scoped RLS policy on
-- `regimens` matches zero rows for a non-owner and returns 200 with an empty
-- array. No error, nothing for the `.catch()` to catch, the write simply did
-- not happen. That call site now uses the `increment_copy_count` SECURITY
-- DEFINER RPC (mig 042), so new adoptions count. Nothing backfilled the old
-- one.
--
-- RECOMPUTED, NOT INCREMENTED. `SET copy_count = <count of qualifying clones>`
-- rather than `copy_count + 1`, so running this twice is the same as running it
-- once. A `+1` repair that gets pasted twice is how a counter ends up wrong in
-- the other direction, and this file cannot know how many times it has run.
--
-- ONE CAVEAT FOR WHOEVER READS THIS NEXT. Two code paths create regimen clones
-- and they disagree about self-copies:
--
--   crews.js  equipRegimen  bumps only when cloner != author
--   regimens.js copyTemplate bumps unconditionally
--
-- This backfill applies the equipRegimen rule, because both existing clones
-- were written by equipRegimen — identified by the `original_author_username`
-- fingerprint, which it fills from the source's email local-part while
-- copyTemplate falls back to the literal 'Unknown'. If a copyTemplate self-copy
-- ever appears, this query would score it 0 where the live code scored it 1.
-- The two paths should agree on the rule; deciding which one is right is a
-- product call and not this migration's job.
--
-- Paste-safe: one UPDATE, no plpgsql, no dotted record access.

-- ── 1. Recompute from the clone rows ──────────────────────────────────────
-- Scoped to regimens that actually have a clone, so this cannot zero the
-- counter on rows whose history predates the fingerprint.
UPDATE public.regimens s
   SET copy_count = (
         SELECT count(*)
           FROM public.regimens c
          WHERE c.original_template_id = s.id
            AND c.created_by IS DISTINCT FROM s.created_by
       )
 WHERE EXISTS (
         SELECT 1 FROM public.regimens c2 WHERE c2.original_template_id = s.id
       )
   AND coalesce(s.copy_count, 0) IS DISTINCT FROM (
         SELECT count(*)
           FROM public.regimens c
          WHERE c.original_template_id = s.id
            AND c.created_by IS DISTINCT FROM s.created_by
       );

-- ── 2. Proof it ran, and that it did not overpay ──────────────────────────
-- The editor hides RAISE NOTICE, so a migration that reports nothing looks
-- exactly like one that was never pasted. Expected on first run:
--
--   source_name          Upper Body Power Day
--   copy_count           1        <- not 2; the self-copy does not count
--   clones_total         2
--   clones_qualifying    1
--   rows_with_a_count    1
--
-- `copy_count` must equal `clones_qualifying` on every row below. If it equals
-- `clones_total` instead, the exclusion was lost and the count is inflated.
SELECT s.name                        AS source_name,
       s.copy_count,
       (SELECT count(*) FROM public.regimens c
         WHERE c.original_template_id = s.id)                     AS clones_total,
       (SELECT count(*) FROM public.regimens c
         WHERE c.original_template_id = s.id
           AND c.created_by IS DISTINCT FROM s.created_by)        AS clones_qualifying,
       (s.copy_count = (SELECT count(*) FROM public.regimens c
                         WHERE c.original_template_id = s.id
                           AND c.created_by IS DISTINCT FROM s.created_by))
                                                                  AS agrees
FROM public.regimens s
WHERE EXISTS (SELECT 1 FROM public.regimens c2 WHERE c2.original_template_id = s.id)
ORDER BY s.name;
