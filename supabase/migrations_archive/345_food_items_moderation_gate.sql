-- 345_food_items_moderation_gate.sql
--
-- THE MODERATION QUEUE WAS ENFORCED IN THE CLIENT ONLY.
--
-- Migration 343 moved a barcode miss from "write straight into
-- public.food_items" to "file a food_item_requests row an admin approves".
-- It changed BarcodeNotFoundModal, added the queue, and added three
-- admin-gated RPCs. It did not change food_items' INSERT policy — so the door
-- 343 exists to close is still open at the database.
--
-- ── Measured against production, 2026-08-12 ────────────────────────────────
--
-- As a REAL non-admin authenticated user (asserted first: 0 rows in
-- admin_users, owner of neither catalogue row), via
-- SET LOCAL role authenticated + request.jwt.claims:
--
--   INSERT INTO public.food_items (created_by, user_id, name, barcode,
--     serving_label, calories, nutrition, vitamins, is_verified, source)
--   VALUES (<own email>, <own uid>, 'ZZ…', 'ZZSELFPUB1', '1 serving', 999,
--     '{"calories":999}', '{}', TRUE, 'member_request');
--   -- ACCEPTED.
--
-- That row is the exact shape approve_food_item_request produces:
-- is_verified = TRUE, source = 'member_request'. A third authenticated user
-- then read it, both by name and by the barcode-equality lookup the scanner
-- uses. The owner could also flip is_verified FALSE -> TRUE on their own row
-- (1 row updated). A non-owner could not touch it (0 rows), which is correct.
-- Everything written by that probe was deleted and the deletion verified in
-- the same call.
--
-- This is the hazard CLAUDE.md already documents as deliberately closed on
-- equipment_models: "An UPDATE scoped to submitted_by would let a user flip
-- their own approved flag and publish into the global catalog." Same shape,
-- open here.
--
-- ── The second half: a TO PUBLIC policy behind a missing GRANT ─────────────
--
-- "verified items readable by all" is TO PUBLIC, and anon DOES hold SELECT on
-- the table. Logged-out reads fail today only because the OTHER policy on the
-- same table calls public.current_user_email(), which anon has no EXECUTE on,
-- so the whole SELECT errors 42501 instead of returning the verified rows.
-- Measured: seeded one is_verified row, read as anon -> 42501, not 0 rows.
--
-- Nothing is exposed while is_verified is 0 of 2. But CLAUDE.md is explicit
-- from the hub-feed case (migration 303): depending on a missing GRANT is not
-- a boundary. The day an admin approves the first request, this decides
-- whether logged-out visitors can read it. Both read policies are therefore
-- scoped to authenticated, with ALTER POLICY ... TO role so no expression is
-- restated.
--
-- ── What this migration does NOT do ───────────────────────────────────────
--
-- It does not remove the client INSERT. The stricter shape is the one
-- scheduled_workouts uses -- no client INSERT policy at all, rows only through
-- an RPC -- and it is defensible now that the client has no food_items writer
-- (foodItems.create was deleted in the same change). It is not done here
-- because an installed PWA can be weeks behind main (CLAUDE.md), and a stale
-- build's pre-343 submission would start failing outright rather than landing
-- as the plain unreviewed row it always was. A constrained INSERT closes the
-- privilege escalation without breaking that. Tightening further is a
-- deliberate follow-up, not a side effect of this fix.
--
-- Full write-up: docs/nutrition-food-database-audit.md
--
-- Idempotent throughout.

-- ── 1. Both read policies stop being TO PUBLIC ────────────────────────────
-- ALTER POLICY ... TO role changes the role without restating the expression,
-- which is what keeps this paste-safe: the owner policy's expression carries
-- exactly the tokens the clipboard pipeline mangles.

ALTER POLICY "food_items: verified items readable by all"
  ON public.food_items TO authenticated;

-- ── 2. Split the ALL policy so INSERT can be constrained ──────────────────
-- The old policy granted SELECT / INSERT / UPDATE / DELETE on your own rows
-- with no constraint on WHICH columns you set. Read and delete keep working;
-- insert gains two guards; update goes away.

DROP POLICY IF EXISTS "food_items: owner full access" ON public.food_items;

-- Read your own rows. Unchanged expression, scoped to authenticated.
DROP POLICY IF EXISTS "food_items: owner reads own" ON public.food_items;
CREATE POLICY "food_items: owner reads own"
  ON public.food_items
  FOR SELECT
  TO authenticated
  USING (
    (SELECT NULLIF(public.current_user_email(), '')) = created_by
    OR (SELECT auth.uid()) = user_id
  );

-- Insert your own row, and ONLY as an unreviewed submission.
--
-- is_verified is what "a human read this" means, and source = 'member_request'
-- is the mark approve_food_item_request leaves. Neither may be self-assigned.
-- The RPC is SECURITY DEFINER and runs as the table owner, so it bypasses this
-- policy entirely and keeps writing both.
DROP POLICY IF EXISTS "food_items: owner submits unverified" ON public.food_items;
CREATE POLICY "food_items: owner submits unverified"
  ON public.food_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      (created_by IS NULL)
      OR (created_by = (SELECT NULLIF(public.current_user_email(), '')))
    )
    AND ((user_id IS NULL) OR (user_id = (SELECT auth.uid())))
    AND ((created_by IS NOT NULL) OR (user_id IS NOT NULL))
    AND (COALESCE(is_verified, FALSE) = FALSE)
    AND (COALESCE(source, 'user_submitted') = 'user_submitted')
  );

-- Retract your own submission while it is still unreviewed.
--
-- Deleting a row an admin has approved is a different act: that record is in
-- the shared catalogue and other people's scans resolve to it.
DROP POLICY IF EXISTS "food_items: owner deletes own unverified" ON public.food_items;
CREATE POLICY "food_items: owner deletes own unverified"
  ON public.food_items
  FOR DELETE
  TO authenticated
  USING (
    (
      (SELECT NULLIF(public.current_user_email(), '')) = created_by
      OR (SELECT auth.uid()) = user_id
    )
    AND (COALESCE(is_verified, FALSE) = FALSE)
  );

-- No client UPDATE policy, on purpose. There is no client writer that updates
-- food_items, and an UPDATE scoped to the owner is precisely how a user flips
-- their own is_verified to TRUE -- the equipment_models hazard, verified live
-- on this table before this migration.

-- ── 3. Prove it ran, and prove it worked ──────────────────────────────────
-- RAISE NOTICE is invisible in the Supabase SQL editor, so this ends in a
-- SELECT. Expect four rows: the two barcode/verified read policies now TO
-- {authenticated}, plus the new insert and delete policies. Expect NO policy
-- with cmd = 'ALL' and NO policy with cmd = 'UPDATE'.

SELECT policyname, cmd, roles::text AS applies_to
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'food_items'
 ORDER BY cmd, policyname;
