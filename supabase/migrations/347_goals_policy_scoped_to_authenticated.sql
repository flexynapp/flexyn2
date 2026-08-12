-- 347_goals_policy_scoped_to_authenticated.sql
--
-- `goals` carries exactly one policy — "goals: owner full access" [ALL] —
-- and its `polroles` is EMPTY, which in Postgres means TO PUBLIC. `anon`
-- holds SELECT on the table (anon=rDxtm/postgres), so the policy is
-- offered to a role that can reach the table.
--
-- What actually stops anon today is not the policy. Probed as `anon`
-- against production on 2026-08-12:
--
--     SELECT count(*) FROM public.goals;
--       → 42501 permission denied for function current_user_email
--
-- i.e. anon is blocked only because it lacks EXECUTE on the helper the
-- predicate calls. CLAUDE.md is explicit that this is not a boundary:
-- "Depending on a missing GRANT is not a boundary" — the same finding
-- migration 303 fixed on the hub feed, where read policies were TO PUBLIC
-- and unreachable by anon only for want of EXECUTE on the same function.
-- Granting anon that helper for any unrelated reason would silently open
-- this table.
--
-- The case is stronger here than on `workout_templates` (flagged in
-- docs/regimens-audit.md and deliberately left): that table is empty,
-- while `goals` holds real user rows — titles, targets, and free-text
-- notes such as "For army".
--
-- NOT a live leak. Verified in the same session, as a real authenticated
-- user who owns none of the rows:
--     SELECT count(*) FROM public.goals WHERE created_by = <other user>
--       → 0 rows, correctly scoped to the owner
-- The predicate is right. Only the audience is wrong.
--
-- ── Why ALTER POLICY and not DROP + CREATE ───────────────────────────
--
-- The existing USING clause is:
--
--   ((( SELECT NULLIF(current_user_email(), ''::text) AS email) = created_by)
--     OR (( SELECT auth.uid() AS uid) = user_id))
--
-- and the WITH CHECK clause is longer still. Both are full of the exact
-- `alias.column` and quoted-empty-string tokens that the paste pipeline
-- mangles into `42601 syntax error at "<"`. `ALTER POLICY … TO role`
-- changes the roles WITHOUT restating the expression, so nothing that
-- could be mangled appears in this file at all. This is the case
-- CLAUDE.md recommends it for.
--
-- Idempotent: re-running sets the same role list.

ALTER POLICY "goals: owner full access"
  ON public.goals
  TO authenticated;

-- Proof it ran and proof it took. RAISE NOTICE is invisible in the
-- Supabase SQL editor, so this ends in a SELECT.
--
-- Expect: roles = 'authenticated', still_one_policy = 1, and the two
-- expressions UNCHANGED (both booleans true) — if either flipped, the
-- ALTER did more than it was supposed to.
SELECT
  array_to_string(polroles::regrole[], ',')                        AS roles,
  (SELECT count(*) FROM pg_policy p2 JOIN pg_class c2 ON c2.oid = p2.polrelid
    WHERE c2.relname = 'goals')                                    AS still_one_policy,
  (pg_get_expr(polqual, polrelid) LIKE '%current_user_email%')     AS using_expr_intact,
  (pg_get_expr(polwithcheck, polrelid) LIKE '%auth.uid%')          AS with_check_intact
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
WHERE c.relname = 'goals';

-- ─────────────────────────────────────────────────────────────────────
-- NOT IN THIS FILE, ON PURPOSE: the duplicate-goal cleanup.
--
-- sjoudrie@gmail.com holds three byte-identical Deadlift 350x5 goals
-- inserted 334 ms apart on 2026-05-14 by a double-submit that the
-- `disabled={isSubmitting}` guard fixed on 2026-05-21 (commit 3238e25c) —
-- seven days later. The bug is gone; the rows are not.
--
-- Kegan chose to keep the oldest and delete the other two. That DELETE is
-- handed over inline rather than shipped here, because a migration that
-- deletes user rows would re-run against any rebuilt database where those
-- ids do not exist, and because deleting someone's data is his call and
-- not a thing this file should do silently. Same posture as migration 344.
--
-- The statement he was given, recorded here so a future reader can tell
-- production from a fresh build:
--
--   DELETE FROM public.goals
--    WHERE id IN ('54391c41-8d06-4ac9-8fac-06d950a60844',
--                 'ba9dd4e3-d534-4da6-b8f5-58409c898adf');
--
--   -- keeps 7384fda0-7e5c-4bde-8181-2a80cfbf7081 (created 00:31:54.482485,
--   -- the first of the three)
-- ─────────────────────────────────────────────────────────────────────
