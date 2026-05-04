-- audit_rls.sql
-- Run in Supabase SQL Editor to verify every public table has RLS enabled
-- and at least one policy. Every row must show rowsecurity = true.

-- ── 1. Tables with RLS status ─────────────────────────────────────────────────
SELECT
  t.tablename,
  t.rowsecurity AS rls_enabled,
  COUNT(p.policyname) AS policy_count,
  CASE
    WHEN NOT t.rowsecurity THEN '🔴 NO RLS — OPEN TO ANON READS/WRITES'
    WHEN COUNT(p.policyname) = 0 THEN '🟡 RLS ON BUT NO POLICIES — blocks everything (ok if intentional)'
    ELSE '🟢 OK'
  END AS status
FROM pg_tables t
LEFT JOIN pg_policies p ON p.tablename = t.tablename AND p.schemaname = 'public'
WHERE t.schemaname = 'public'
GROUP BY t.tablename, t.rowsecurity
ORDER BY t.rowsecurity ASC, t.tablename;

-- ── 2. All policies (what each table actually allows) ─────────────────────────
SELECT
  tablename,
  policyname,
  cmd       AS operation,
  qual      AS using_check,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd;

-- ── 3. Check for any function with SECURITY DEFINER (elevated privilege) ─────
SELECT
  routine_name,
  security_type,
  routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND security_type = 'DEFINER'
ORDER BY routine_name;
