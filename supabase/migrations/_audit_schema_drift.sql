-- ─────────────────────────────────────────────────────────────────────────
-- _audit_schema_drift.sql  —  DIAGNOSTIC ONLY, NOT A MIGRATION
-- ─────────────────────────────────────────────────────────────────────────
--
-- Run this in Supabase SQL Editor. It returns one row per finding across
-- every public.* table that looks like it might have drifted from the
-- migrations. The leading underscore in the filename keeps it out of any
-- migration runner that auto-applies NNN_*.sql files in order.
--
-- For each finding you'll see:
--   category    — what kind of drift (column_type, missing_fk, etc.)
--   table_name  — the table that's affected
--   detail      — column name + the specific issue
--   severity    — high (bug surface today), med (latent), low (cosmetic)
--   suggestion  — what a fix migration would do
--
-- This is the same diagnostic shape we use for code reviews:
-- enumerate everything, then triage, then patch.
--
-- The query runs in seconds against a normal Supabase DB.
-- ─────────────────────────────────────────────────────────────────────────

WITH

-- ── 1. Columns named "*_id" that should be UUID but are TEXT ──────────────
-- The sticker-reactions bug pattern. Any public column named user_id,
-- post_id, item_id, or anything ending _id, that's stored as text but
-- should hold a UUID, can blow up the moment a trigger compares it to
-- auth.uid() or a parent table's id. item_id legitimately is text (loot
-- slug); we exclude it.
suspect_id_columns AS (
  SELECT
    'column_type' AS category,
    table_name,
    column_name || ' is ' || data_type || ', expected uuid' AS detail,
    'high' AS severity,
    'ALTER COLUMN ' || column_name || ' TYPE uuid USING ' || column_name || '::uuid' AS suggestion
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND data_type = 'text'
    AND (column_name = 'user_id'
      OR column_name = 'post_id'
      OR column_name = 'crew_id'
      OR column_name = 'war_id'
      OR column_name = 'duel_id'
      OR column_name = 'bounty_id'
      OR column_name = 'conversation_id'
      OR column_name = 'message_id'
      OR column_name = 'reaction_id'
      OR column_name = 'comment_id'
      OR column_name = 'nemesis_id'
      OR column_name = 'gauntlet_id'
      OR column_name = 'regimen_id'
      OR column_name = 'workout_log_id'
      OR column_name = 'goal_id')
),

-- ── 2. Tables with user_id but no FK to auth.users ────────────────────────
-- If a row's owner can disappear from auth.users without the data being
-- cleaned up, we accumulate orphans (like the post_sticker_reactions
-- orphans we just deleted). ON DELETE CASCADE FK closes that.
missing_user_fk AS (
  SELECT
    'missing_fk' AS category,
    c.table_name,
    'user_id has no FK to auth.users (orphans accumulate)' AS detail,
    'med' AS severity,
    'ADD CONSTRAINT ' || c.table_name || '_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE' AS suggestion
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.column_name  = 'user_id'
    AND c.data_type    = 'uuid'
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint pc
      JOIN pg_class cls ON cls.oid = pc.conrelid
      JOIN pg_namespace n ON n.oid = cls.relnamespace
      WHERE pc.contype = 'f'
        AND n.nspname = 'public'
        AND cls.relname = c.table_name
        AND pc.conkey @> ARRAY[(
          SELECT attnum FROM pg_attribute
           WHERE attrelid = cls.oid AND attname = 'user_id'
        )]
    )
),

-- ── 3. Tables with RLS enabled but no service_role GRANT ──────────────────
-- This was the second bug in migration 080. RLS-enabled tables still
-- need table-level GRANT for service_role because RLS bypass only
-- exempts you from policies, not from the GRANT layer above them.
-- Edge Functions using SUPABASE_SERVICE_ROLE_KEY 500 with 42501 when
-- this is missing.
rls_without_service_grant AS (
  SELECT
    'rls_grant' AS category,
    c.relname AS table_name,
    'RLS enabled but service_role has no table grants' AS detail,
    'med' AS severity,
    'GRANT SELECT, INSERT, UPDATE, DELETE ON public.' || c.relname || ' TO service_role' AS suggestion
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity = true
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.role_table_grants
       WHERE table_schema = 'public'
         AND table_name = c.relname
         AND grantee = 'service_role'
         AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
       LIMIT 1
    )
),

-- ── 4. Public tables without RLS enabled ──────────────────────────────────
-- A public schema table without RLS is open by default to any
-- authenticated role. Sometimes that's intentional (lookup tables); other
-- times it's a forgotten ALTER TABLE ENABLE ROW LEVEL SECURITY. We flag
-- low severity so you can decide per table.
public_tables_no_rls AS (
  SELECT
    'no_rls' AS category,
    c.relname AS table_name,
    'no row-level security; check whether this is intentional' AS detail,
    'low' AS severity,
    'ALTER TABLE public.' || c.relname || ' ENABLE ROW LEVEL SECURITY  -- then add policies' AS suggestion
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity = false
    -- Exclude obvious meta tables
    AND c.relname NOT LIKE 'pg_%'
    AND c.relname NOT IN ('schema_migrations', 'spatial_ref_sys')
),

-- ── 5. Columns where the production "schema cache" might be stale ─────────
-- PostgREST caches the schema. If a column was added but NOTIFY pgrst
-- wasn't run, the JS client gets "column not found in schema cache"
-- errors. This finding lists columns added in the last 24h that might
-- not have been reloaded. Best-effort — pg_class doesn't track column
-- create time directly; we use the table's last analyze as a proxy.
-- Mostly informational.

-- (Skipped: no reliable timestamp per-column without pg_stat_user_tables
--  which doesn't distinguish add vs analyze. Listed here for the audit
--  doc but not implemented in the query.)

-- ── 6. Orphan rows in known parent/child tables ──────────────────────────
-- For each FK relationship we expect to see, count rows where the child
-- key has no matching parent. This is a moderate-effort but high-signal
-- check. We enumerate the known relationships rather than trying to
-- discover them at runtime — discovery would require dynamic SQL and
-- this audit script is supposed to stay one query.
--
-- (Run separately below — UNION ALL'd into the main output)
orphan_counts AS (
  -- post_sticker_reactions → hub_posts
  SELECT
    'orphan_rows' AS category,
    'post_sticker_reactions' AS table_name,
    'rows referencing deleted hub_posts: ' || COUNT(*)::text AS detail,
    CASE WHEN COUNT(*) > 0 THEN 'med' ELSE 'low' END AS severity,
    'DELETE FROM public.post_sticker_reactions WHERE post_id NOT IN (SELECT id FROM public.hub_posts)' AS suggestion
  FROM public.post_sticker_reactions p
  LEFT JOIN public.hub_posts hp ON hp.id = p.post_id
  WHERE hp.id IS NULL

  UNION ALL

  -- hub_reactions → hub_posts
  SELECT
    'orphan_rows',
    'hub_reactions',
    'rows referencing deleted hub_posts: ' || COUNT(*)::text,
    CASE WHEN COUNT(*) > 0 THEN 'med' ELSE 'low' END,
    'DELETE FROM public.hub_reactions WHERE post_id NOT IN (SELECT id FROM public.hub_posts)'
  FROM public.hub_reactions hr
  LEFT JOIN public.hub_posts hp ON hp.id = hr.post_id
  WHERE hp.id IS NULL

  UNION ALL

  -- notifications → auth.users
  SELECT
    'orphan_rows',
    'notifications',
    'rows referencing deleted auth.users: ' || COUNT(*)::text,
    CASE WHEN COUNT(*) > 0 THEN 'med' ELSE 'low' END,
    'DELETE FROM public.notifications WHERE user_id NOT IN (SELECT id FROM auth.users)'
  FROM public.notifications n
  LEFT JOIN auth.users u ON u.id = n.user_id
  WHERE u.id IS NULL
)

SELECT category, table_name, detail, severity, suggestion
FROM (
  SELECT * FROM suspect_id_columns
  UNION ALL
  SELECT * FROM missing_user_fk
  UNION ALL
  SELECT * FROM rls_without_service_grant
  UNION ALL
  SELECT * FROM public_tables_no_rls
  UNION ALL
  SELECT * FROM orphan_counts
  WHERE detail NOT LIKE '%: 0'  -- hide zero-count orphans
) findings
ORDER BY
  CASE severity WHEN 'high' THEN 0 WHEN 'med' THEN 1 ELSE 2 END,
  category,
  table_name;
