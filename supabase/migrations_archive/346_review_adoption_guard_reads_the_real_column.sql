-- 346_review_adoption_guard_reads_the_real_column.sql
--
-- `trg_enforce_review_adoption` has never enforced anything for a
-- non-owner, since the day it shipped in migration 118.
--
-- The guard is supposed to require that you either OWN a regimen or have
-- CLONED it before you can review it. It detects a clone with:
--
--     WHERE created_by = NEW.reviewer_email
--       AND (parent_regimen_id = NEW.regimen_id
--            OR parent_id      = NEW.regimen_id)
--
-- Neither `parent_regimen_id` nor `parent_id` exists on public.regimens.
-- The query therefore raises `undefined_column`, and the function's own
-- trailing handler — `EXCEPTION WHEN undefined_column THEN RETURN NEW` —
-- swallows it and ALLOWS the insert. A guard that catches its own
-- exception is a no-op.
--
-- Nobody noticed because regimen_reviews holds 0 rows.
--
-- PROVEN BY EXECUTION, 2026-08-12, as a real authenticated user
-- (SET LOCAL role authenticated + request.jwt.claims), inside a probe
-- that cleaned up after itself:
--
--   stranger (guest account, neither owner nor cloner) → INSERT ALLOWED
--   owner                                             → INSERT ALLOWED
--   genuine cloner                                    → INSERT ALLOWED
--
-- ── The fix is a column NAME, not a missing column ───────────────────
--
-- `public.regimens.original_template_id` already exists and is exactly
-- the parentage the guard wanted. Every clone path writes it:
--
--   src/lib/data/regimens.js  copyTemplate()   — the store's Adopt button
--   src/lib/data/crews.js     equipRegimen()   — crew "equip this regimen"
--
-- and 2 of 33 production rows carry it today, both pointing at
-- "Upper Body Power Day". So the guard needs one identifier corrected,
-- not a new column and not a backfill.
--
-- Verified on a SHADOW trigger over a temp table before writing this, so
-- the live trigger was never touched during testing:
--
--   stranger → 42501 review_requires_adoption   (BLOCKED, correct)
--   owner    → allowed                          (no regression)
--   cloner   → allowed                          (no regression)
--
-- ── Why the EXCEPTION handler goes ───────────────────────────────────
--
-- With a column that actually exists it can no longer fire for the
-- reason it was written, and all it can do now is mask the NEXT rename
-- the same way it masked this one — silently, for months, on a security
-- guard. Removing it is the point of the migration, not a side effect.
--
-- It is deliberately NOT replaced with `WHEN OTHERS`. That would restore
-- the same failure mode under a different name.
--
-- Note the direction matters: deleting the handler WITHOUT fixing the
-- column would have turned a silent no-op into a hard 42703 on every
-- review insert, which is worse than the bug. Both halves ship together.

CREATE OR REPLACE FUNCTION public.enforce_review_adoption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner  BOOLEAN;
  v_cloned BOOLEAN;
BEGIN
  -- You may always review your own regimen.
  SELECT (created_by = NEW.reviewer_email) INTO v_owner
    FROM public.regimens WHERE id = NEW.regimen_id;
  IF v_owner THEN RETURN NEW; END IF;

  -- Otherwise you must have adopted it. `original_template_id` is the
  -- column every clone path writes; the pre-345 body named
  -- `parent_regimen_id` / `parent_id`, neither of which has ever existed.
  SELECT EXISTS (
    SELECT 1 FROM public.regimens
     WHERE created_by = NEW.reviewer_email
       AND original_template_id = NEW.regimen_id
  ) INTO v_cloned;

  IF NOT v_cloned THEN
    RAISE EXCEPTION 'review_requires_adoption'
      USING ERRCODE = '42501',
            HINT    = 'Copy this regimen to your own list before reviewing.';
  END IF;

  RETURN NEW;
END;
$function$;

-- The trigger itself is unchanged and already exists; restated here only
-- so a rebuilt database ends up in the same place. DROP first because
-- Postgres has no CREATE TRIGGER IF NOT EXISTS.
DROP TRIGGER IF EXISTS trg_enforce_review_adoption ON public.regimen_reviews;
CREATE TRIGGER trg_enforce_review_adoption
  BEFORE INSERT ON public.regimen_reviews
  FOR EACH ROW EXECUTE FUNCTION public.enforce_review_adoption();

-- Proof it ran, and proof it took: the body must no longer name the
-- columns that never existed. RAISE NOTICE is invisible through the
-- Supabase SQL editor, so this ends in a SELECT.
SELECT
  (pg_get_functiondef(p.oid) LIKE '%original_template_id%')                    AS reads_real_column,
  (pg_get_functiondef(p.oid) NOT LIKE '%parent_regimen_id%')                   AS phantom_column_gone,
  (pg_get_functiondef(p.oid) NOT LIKE '%EXCEPTION%')                           AS handler_removed,
  (SELECT count(*) FROM pg_trigger t
    WHERE t.tgrelid = 'public.regimen_reviews'::regclass
      AND t.tgname = 'trg_enforce_review_adoption')                            AS trigger_attached
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'enforce_review_adoption';
