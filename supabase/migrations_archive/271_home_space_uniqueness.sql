-- 271_home_space_uniqueness.sql
--
-- One "My gear" space per user, enforced by the database.
--
-- ── The race ─────────────────────────────────────────────────────────
--
-- getOrCreateHomeSpace (src/lib/data/equipment.js) is read-then-insert:
--
--     SELECT id FROM training_spaces WHERE owner_id = … AND kind = 'home'
--     -- ← two concurrent callers both see nothing here
--     INSERT INTO training_spaces (owner_id, kind, …)
--
-- Two photo uploads started in the same moment therefore create two home
-- spaces. Nothing in mig 268 prevents it: the table's UNIQUE key is
-- (owner_id, gym_id), and gym_id is NULL for home spaces — and NULLs are
-- distinct under a unique constraint, so every home row is unique
-- regardless of how many there are.
--
-- The consequence today is mild, which is why this waited: the reader
-- orders by created_at ASC LIMIT 1, so everyone consistently gets the
-- OLDEST space and the newer one is simply never read. Gear attached to
-- the losing space becomes invisible rather than wrong.
--
-- This index closes it properly. The reader's ORDER BY stays where it is
-- — belt and braces — and is pinned by a test in
-- src/lib/data/__tests__/equipment.test.js so it can't be tidied away.
--
-- ── Why this migration refuses to merge duplicates for you ───────────
--
-- Merging is not a matter of deleting the newer row. space_equipment
-- cascades from training_spaces, and equipment_photos cascades from
-- space_equipment, so a plain DELETE of a duplicate space silently
-- destroys any photo a user attached through it. Re-parenting instead
-- collides with `UNIQUE (space_id, model_id) WHERE model_id IS NOT NULL`
-- whenever both spaces list the same machine, and resolving THAT means
-- choosing which of two photo sets survives.
--
-- That is a judgement call about someone's data, not a migration's
-- business. So: verified 2026-07-30 that production has zero users with
-- duplicate home spaces, and this migration creates the index only when
-- that still holds. If a race lands in the window before it is applied,
-- it warns with the count and creates nothing, leaving the data intact
-- and the decision to a human.
--
-- Idempotent: re-running is a no-op once the index exists.

DO $$
DECLARE
  v_dupes INTEGER;
BEGIN
  SELECT count(*) INTO v_dupes
    FROM (
      SELECT owner_id
        FROM public.training_spaces
       WHERE kind = 'home'
       GROUP BY owner_id
      HAVING count(*) > 1
    ) AS dupe_owners;

  IF v_dupes > 0 THEN
    RAISE WARNING
      'training_spaces: % owner(s) already have more than one home space. Index NOT created — merge them by hand first (see the header of this migration for why this is not automated).',
      v_dupes;
    RETURN;
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS training_spaces_one_home_per_owner_uidx
    ON public.training_spaces (owner_id)
    WHERE kind = 'home';

  RAISE NOTICE 'training_spaces: one-home-space-per-owner index is in place.';
END
$$;
