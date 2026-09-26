-- 380_orphaned_crew_post_finds_its_crew.sql
--
-- One post has been readable by nobody since 2026-05-25. This gives it back
-- to the crew it was written for.
--
-- ── What happened ────────────────────────────────────────────────────────
--
-- The composer sent `crew_id` with a crew-privacy post; `hub_posts` had no
-- such column; `makeEntity().create` in src/api/db.js caught PGRST204,
-- stripped the key and retried. The insert SUCCEEDED and the audience was
-- discarded silently. The row landed `privacy = 'crew'` with no crew, and the
-- read policy has no branch that admits it — not a leak, a black hole.
--
-- Migration 379 (crew posts) added the column, the read branch and a write
-- guard, so no NEW post can land this way. It did not repair the one already
-- there, because the crew it named was destroyed before it reached the
-- database and nothing in the row can recover it.
--
-- ── Why this row's crew is knowable anyway ───────────────────────────────
--
-- Not from the row — from the calendar. Measured on production:
--
--   the post          f6ebe879…  2026-05-25 05:44:39Z, @sean, body "hi"
--   crews that existed at that moment      exactly ONE: Admin Grind
--                                          (created 2026-05-19 16:33:39Z)
--   @sean's memberships at that moment     exactly ONE: Admin Grind
--                                          (joined  2026-05-19 16:33:39Z)
--   his other two memberships              2026-05-26 and 2026-05-28,
--                                          both AFTER the post
--
-- The picker had one option and he was in it. This is not the most likely
-- crew, it is the only crew that could have been selected.
--
-- ── What it exposes ──────────────────────────────────────────────────────
--
-- The post becomes readable by Admin Grind's members, which is what its
-- author chose when he picked Crew privacy. **Nobody joined Admin Grind after
-- the post** (measured: 0), so today's two members are exactly the audience
-- it was addressed to. No one gains sight of anything they were absent for.
--
-- The row keeps `content_warning = 'spoiler'`, so it stays behind the tap the
-- author put in front of it.
--
-- ── Scope ────────────────────────────────────────────────────────────────
--
-- Both ids are literals and the WHERE names the post. A rule like "repair any
-- orphan whose author was in exactly one crew" would be tidier and would put
-- a join between a guess and other people's posts; there is one row, its
-- answer was derived by hand, and it is written down above. If another orphan
-- ever appears, derive that one too rather than generalising this.

-- ── Why the UPDATE needs a session ───────────────────────────────────────
--
-- 379's guard is `BEFORE INSERT OR UPDATE OF crew_id`, so it fires on THIS
-- statement, and it asks `is_crew_member(NEW.crew_id)` which derives the
-- viewer from auth.uid(). In the SQL editor there is no JWT, auth.uid() is
-- NULL, and the repair is refused with `42501 not_a_member_of_that_crew`.
-- Measured, not predicted: the first draft of this file was pasted and
-- rejected exactly there. 379's own header warns about it, from the same
-- discovery on its seed data.
--
-- So the transaction claims the AUTHOR, who is a member of Admin Grind. The
-- guard then passes on its own terms. The alternative — DISABLE TRIGGER
-- around the write — switches a privacy check off to edit the row it guards,
-- and would be the wrong habit to leave in the runbook for the next person
-- who needs to touch a crew post.
--
-- SET LOCAL is transaction-scoped: it is gone at COMMIT whatever happens.

BEGIN;

SET LOCAL request.jwt.claims = '{"sub":"ead69f89-3a1e-4bf2-9d3e-444648e01f98","role":"authenticated"}';

UPDATE public.hub_posts
   SET crew_id = 'f5f64705-a055-4a5f-9644-a01b444fe32a'::uuid
 WHERE id      = 'f6ebe879-251b-472c-bf36-75082e4f94b5'::uuid
   AND privacy = 'crew'
   AND crew_id IS NULL;

RESET request.jwt.claims;

COMMIT;

-- ── APPLIED 2026-08-22, and not the way it should have been ─────────────
--
-- This landed on production through a DRY RUN THAT WAS NOT DRY. The file
-- carries its own BEGIN/COMMIT, and it was wrapped in an outer
-- BEGIN … ROLLBACK to test it — so the inner COMMIT ended the outer
-- transaction and the ROLLBACK had nothing left to undo.
--
-- **Never wrap a bundle that already opens a transaction.** Strip the file's
-- own BEGIN/COMMIT before wrapping, or dry-run the statements alone. The
-- rolled-back-transaction technique used everywhere else in this runbook is
-- only rolled back while the transaction is still open.
--
-- The change itself is the intended one and was verified twice before and
-- once after: crew member 0 -> 1, outsider 0 -> 0.

-- ── Proof it ran ─────────────────────────────────────────────────────────
-- The SQL editor hides RAISE NOTICE, so this bundle ends in a SELECT.
--
-- `orphans_left` is the one that matters: it is the count this migration
-- exists to drive to zero, and it stays 0 on a re-run.
SELECT
  (SELECT count(*) FROM public.hub_posts
    WHERE privacy = 'crew' AND crew_id IS NULL)                     AS orphans_left,
  (SELECT count(*) FROM public.hub_posts
    WHERE id = 'f6ebe879-251b-472c-bf36-75082e4f94b5'::uuid
      AND crew_id = 'f5f64705-a055-4a5f-9644-a01b444fe32a'::uuid)   AS post_now_addressed,
  (SELECT count(*) FROM public.crew_members
    WHERE crew_id = 'f5f64705-a055-4a5f-9644-a01b444fe32a'::uuid)   AS can_now_read_it;
