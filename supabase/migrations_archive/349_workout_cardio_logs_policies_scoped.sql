-- 349_workout_cardio_logs_policies_scoped.sql
--
-- The same shape migration 347 fixed on `goals`, on the two tables behind
-- All Workouts. Both carry exactly one policy — "<table>: owner full
-- access" [ALL] — whose `polroles` is EMPTY, which in Postgres means
-- TO PUBLIC. `anon` holds SELECT on both tables, so the policy is offered
-- to a role that can reach them.
--
-- What actually stops anon today is not the policy. Probed as `anon`
-- against production on 2026-08-12, inside a rolled-back transaction:
--
--     SELECT count(*) FROM public.workout_logs;
--       → 42501 permission denied for function current_user_email
--     SELECT count(*) FROM public.cardio_logs;
--       → 42501 permission denied for function current_user_email
--
-- i.e. anon is blocked only because it lacks EXECUTE on the helper the
-- predicate calls. CLAUDE.md is explicit that this is not a boundary:
-- "Depending on a missing GRANT is not a boundary" — the finding migration
-- 303 fixed on the hub feed and 347 fixed on goals.
--
-- ── The predicate is RIGHT; only the audience is wrong ─────────────────
-- Probed in the same transaction as a REAL authenticated non-owner
-- (`SET LOCAL role authenticated` + jwt claims, probe identity asserted
-- distinct from the row owner), and both directions were checked:
--
--     non-owner → workout_logs   0 rows   (correctly blocked)
--     non-owner → cardio_logs    0 rows   (correctly blocked)
--     OWNER     → workout_logs   2 rows   (legitimate case still works)
--
-- So there is no live leak. This closes a latent exposure, it does not
-- patch an open one.
--
-- ── Why scoping ONE policy is safe here ───────────────────────────────
-- The `food_items` trap (see CLAUDE.md, migration 345) is that scoping one
-- of SEVERAL permissive policies removes the throwing expression from
-- anon's evaluation and lets a different TO PUBLIC policy succeed — opening
-- the hole while looking like the fix. That cannot happen here: each of
-- these tables has EXACTLY ONE policy. Scoping it to `authenticated`
-- leaves anon with no permissive policy at all, which is 0 rows, not a
-- leak. Verified by counting policies before writing this:
--
--     SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
--      WHERE c.relname IN ('workout_logs','cardio_logs');   -- → 2, one each
--
-- ── ALTER POLICY, not DROP/CREATE ─────────────────────────────────────
-- Per CLAUDE.md's paste-safety rule. Both expressions are full of the bare
-- `alias.column` and record-field tokens the user's clipboard pipeline
-- mangles into `42601`; ALTER POLICY … TO changes the role list without
-- restating a single character of them.
--
-- Idempotent: re-running sets the same role list.

ALTER POLICY "workout_logs: owner full access" ON public.workout_logs TO authenticated;
ALTER POLICY "cardio_logs: owner full access"  ON public.cardio_logs  TO authenticated;

-- Self-verifying tail. The Supabase SQL editor hides RAISE NOTICE, so this
-- ends in a SELECT that proves it ran: expect exactly two rows, both with
-- roles = {authenticated} and both qual expressions intact.
SELECT tablename,
       policyname,
       roles,
       cmd,
       (qual IS NOT NULL) AS using_expr_intact
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('workout_logs', 'cardio_logs')
 ORDER BY tablename;
