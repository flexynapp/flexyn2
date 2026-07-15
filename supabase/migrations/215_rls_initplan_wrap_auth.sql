-- 215_rls_initplan_wrap_auth.sql
--
-- Performance: fix the Supabase advisor's auth_rls_initplan finding across all
-- 191 public RLS policies (102 tables). Those policies call auth.uid() /
-- auth.email() unwrapped, so Postgres re-evaluates the function PER ROW. Wrapping
-- each as (select auth.uid()) makes the planner treat it as an InitPlan —
-- evaluated ONCE per query — which is a large win on any table scan.
-- Value-identical rewrite: (select auth.uid()) == auth.uid(); only evaluation
-- frequency changes. Roles / command / permissive / qual / with_check are all
-- preserved exactly.
--
-- Implementation notes:
--   • Driven off the catalog (pg_policies) at APPLY time, so the policy bodies
--     never appear in this file — no paste-mangling of column names, and it
--     auto-covers every in-scope policy without hand-transcribing 191 of them.
--   • Uses a comma-separated SCALAR target list in the FOR loop (NOT a record
--     variable) so there is no dotted record.field access — paste-safe per the
--     repo SQL rules. All identifiers are emitted via format(%I); the schema.
--     table qualifier is built by format(%I.%I) at runtime, never as a literal.
--   • Idempotent: the WHERE clause skips any policy already containing a
--     wrapped `select auth.` form, so re-running is a no-op.
--   • Runs in one transaction — a failure on any policy rolls back the whole
--     migration, so there is no partial/half-dropped-policy state.

DO $$
DECLARE
  v_schema     text;
  v_table      text;
  v_policy     text;
  v_permissive text;
  v_roles_arr  name[];
  v_cmd        text;
  v_qual       text;
  v_check      text;
  v_roles      text;
  v_sql        text;
BEGIN
  FOR v_schema, v_table, v_policy, v_permissive, v_roles_arr, v_cmd, v_qual, v_check IN
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'auth\.(uid|email)\(\)'
      AND (coalesce(qual,'') || ' ' || coalesce(with_check,'')) !~* 'select auth\.'
  LOOP
    v_roles := array_to_string(v_roles_arr, ', ');

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', v_policy, v_schema, v_table);

    v_sql := format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
                    v_policy, v_schema, v_table, v_permissive, v_cmd, v_roles);

    IF v_qual IS NOT NULL THEN
      v_sql := v_sql || ' USING (' ||
        replace(replace(v_qual, 'auth.uid()', '(select auth.uid())'),
                'auth.email()', '(select auth.email())') || ')';
    END IF;

    IF v_check IS NOT NULL THEN
      v_sql := v_sql || ' WITH CHECK (' ||
        replace(replace(v_check, 'auth.uid()', '(select auth.uid())'),
                'auth.email()', '(select auth.email())') || ')';
    END IF;

    EXECUTE v_sql || ';';
  END LOOP;
END $$;
