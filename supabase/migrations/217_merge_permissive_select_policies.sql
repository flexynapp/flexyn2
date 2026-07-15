-- 217_merge_permissive_select_policies.sql
--
-- Performance/hygiene: collapse pairs of PERMISSIVE SELECT policies that target
-- the SAME role set on the same table into one policy (multiple_permissive_
-- policies advisor finding). Postgres OR-combines permissive policies anyway,
-- so merging two `USING (a)` + `USING (b)` into one `USING ((a) OR (b))` is
-- exactly semantics-preserving — it just saves evaluating a second policy.
--
-- SCOPE, deliberately narrow:
--   • SELECT only — no WITH CHECK to reconcile.
--   • Same-role groups only (HAVING one distinct role set) — merging policies
--     that target DIFFERENT roles (e.g. an anon policy + an authenticated one on
--     gym_businesses/gym_members/food_items) would change who matches which
--     branch, so those are left alone on purpose.
--   • The UPDATE/ALL overlaps on crew_members / crews / weekly_debriefs are also
--     left for a separate review (WITH CHECK semantics).
-- Net effect here: merges the SELECT pairs on crews, trainer_listings,
-- trainer_purchases, weekly_debriefs.
--
-- Catalog-driven at apply time: the OR-combined USING expression is built from
-- pg_policies.qual inside the DB, so the policy bodies (which contain dotted
-- EXISTS-subquery refs) never appear in this file — paste-safe. The pasted code
-- itself is a single-table read with a comma-separated scalar FOR target (no
-- record.field access) and format(%I)/%L-free identifier quoting.
-- Idempotent: after merging, each table has a single SELECT policy, so the
-- HAVING count(*) > 1 filter makes a re-run a no-op.

DO $$
DECLARE
  v_schema    text;
  v_table     text;
  v_roles     text;
  v_using     text;
  v_dropnames name[];
  v_name      text;
BEGIN
  FOR v_schema, v_table, v_roles, v_using, v_dropnames IN
    SELECT schemaname,
           tablename,
           (array_agg(DISTINCT array_to_string(roles, ',')))[1],
           string_agg('(' || qual || ')', ' OR ' ORDER BY policyname),
           array_agg(policyname)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd = 'SELECT'
      AND permissive = 'PERMISSIVE'
      AND qual IS NOT NULL
    GROUP BY schemaname, tablename
    HAVING count(*) > 1
       AND count(DISTINCT array_to_string(roles, ',')) = 1
  LOOP
    FOREACH v_name IN ARRAY v_dropnames LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', v_name, v_schema, v_table);
    END LOOP;

    EXECUTE format('CREATE POLICY %I ON %I.%I AS PERMISSIVE FOR SELECT TO %s USING (%s);',
                   v_table || '_select_merged', v_schema, v_table, v_roles, v_using);
  END LOOP;
END $$;
