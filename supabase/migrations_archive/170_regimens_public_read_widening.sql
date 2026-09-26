-- 170_regimens_public_read_widening.sql
--
-- BUG: user-published regimens stopped showing up in the public store.
-- A user reports "I published a bunch on my main account, but there
-- are none here huge issue" — the screenshot shows the public store
-- under any-level/intermediate/advanced filters all reading
-- "No matching regimens" / "No public regimens yet."
--
-- ROOT CAUSE: migration 143 added a NEW column `is_public_free` and a
-- gated SELECT policy keyed on `is_public_free = TRUE`. The previous
-- public flag was `is_public` (mig 005). Client code kept writing
-- `is_public = TRUE` when users tapped "Publish" but never set
-- `is_public_free`, so the new RLS gate filtered every legacy-flag
-- publication out of cross-user reads. The owner could still see
-- their own row (the OR'd "regimens: owner full access" policy from
-- mig 001), so the publish UI didn't appear broken — the regimens
-- just never reached anyone else.
--
-- FIX (two-part):
--   1. Widen the gated SELECT policy so a TRUE on EITHER column
--      counts as public. is_public_free remains the canonical flag
--      for the trainer-marketplace tier (free vs. paid), but the
--      community store reads both.
--   2. Backfill is_public_free = TRUE wherever is_public = TRUE
--      AND is_public_free is currently FALSE. One-shot — new writes
--      from the client now set both flags simultaneously
--      (RegimenForm.jsx, RegimensSection.jsx).
--
-- Idempotent. Safe to re-run.

-- ── 1. Widen the gated SELECT policy ──────────────────────────────────
DROP POLICY IF EXISTS "regimens: gated marketplace read" ON public.regimens;
CREATE POLICY "regimens: gated marketplace read"
  ON public.regimens FOR SELECT TO authenticated
  USING (
    is_public_free = TRUE
    OR is_public = TRUE
    OR id IN (
      SELECT regimen_id FROM public.trainer_listings
       WHERE regimen_id IS NOT NULL
         AND id IN (SELECT listing_id FROM public.trainer_purchases WHERE user_id = auth.uid())
    )
  );

-- ── 2. Backfill is_public_free for legacy-flag rows ───────────────────
UPDATE public.regimens
   SET is_public_free = TRUE
 WHERE is_public = TRUE
   AND COALESCE(is_public_free, FALSE) = FALSE;

NOTIFY pgrst, 'reload schema';
