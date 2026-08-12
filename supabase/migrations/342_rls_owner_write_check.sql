-- 342_rls_owner_write_check.sql
--
-- CROSS-USER ROW INJECTION. Any authenticated user can write a row into any
-- other user's data on 16 tables, including hub_posts — where it renders as
-- a post BY that person, in the public feed.
--
-- ── The defect ──────────────────────────────────────────────────────────
-- These tables carry the dual-key shape CLAUDE.md documents: a legacy
-- `created_by TEXT` email and a `user_id UUID`. Their policy is
--
--     ((SELECT NULLIF(current_user_email(),'')) = created_by)
--     OR ((SELECT auth.uid()) = user_id)
--
-- and it is used for BOTH `USING` and `WITH CHECK`.
--
-- As a read rule that OR is correct — a row is yours if either key is yours.
-- As a WRITE rule it is a hole, because satisfying ONE branch leaves the
-- OTHER column entirely unconstrained. Set `user_id` to your own uid and
-- `created_by` to anybody's email, and the check passes.
--
-- ── Verified against production, 2026-08-11 ────────────────────────────
-- All inside BEGIN…ROLLBACK, as the real `authenticated` role with real
-- JWT claims — MCP and the SQL editor run as `postgres` and bypass RLS, so
-- nothing here was concluded from reading the expression:
--
--   · A inserted a cardio_logs row with created_by = B's email and
--     user_id = A's uid.                                  INSERT SUCCEEDED
--   · Read back AS B, filtered the way the whole cardio UI filters
--     (`.eq('created_by', email)`): the row was THERE.     B SEES IT
--   · A reading B's genuine rows: 0 rows.        READ IS PROPERLY BLOCKED
--   · Same insert into hub_posts with author_email = B: SUCCEEDED, and the
--     row is attributed to B.                    IMPERSONATION CONFIRMED
--
-- So: injection only. No read leak, and A cannot modify B's real rows —
-- for those, neither branch matches A. That bounds the severity but does
-- not reduce it much, because an injected cardio_log lands in B's saved
-- list, B's goal progress, B's PR detection and B's Progress totals, and an
-- injected hub_post is speech attributed to someone who did not say it.
--
-- Not an economy exploit: XP, coins and total_distance_meters all come from
-- SECURITY DEFINER RPCs keyed on auth.uid(), so none of them move.
--
-- ── The fix ────────────────────────────────────────────────────────────
-- Keep the OR for reading. Constrain WRITING so every key that is PRESENT
-- must be yours, and at least one must be:
--
--   (created_by IS NULL OR created_by = <me>)
--   AND (user_id  IS NULL OR user_id  = <my uid>)
--   AND (created_by IS NOT NULL OR user_id IS NOT NULL)
--
-- Null-tolerant per column because these tables are mid-migration between
-- the two keys and some paths still write only one; `makeEntity().create`
-- injects both. The third clause stops a row owned by nobody, which the
-- first two would otherwise permit.
--
-- ALTER POLICY, not DROP/CREATE. It replaces WITH CHECK and leaves USING
-- untouched, which matters twice: hub_conversations' USING is a
-- participant rule rather than the owner pair, and restating any of these
-- expressions risks the `alias.column` clipboard mangling in CLAUDE.md.
--
-- VERIFIED FIX, same rolled-back method: with this WITH CHECK applied to
-- cardio_logs, the spoofed insert raised insufficient_privilege and a
-- legitimate insert (both columns, both mine) still succeeded.
--
-- PASTE-SAFE: bare column names, schema-qualified function calls, no table
-- aliases and no record-field access anywhere.

DO $$
DECLARE
  v_pair   TEXT;
  v_table  TEXT;
  v_policy TEXT;
  v_done   INTEGER := 0;
BEGIN
  FOREACH v_pair IN ARRAY ARRAY[
    'body_metrics|body_metrics: owner full access',
    'cardio_logs|cardio_logs: owner full access',
    'exercise_forms|exercise_forms: owner full access',
    'food_items|food_items: owner full access',
    'goals|goals: owner full access',
    'hub_comment_likes|hub_comment_likes: owner write',
    'hub_comments|hub_comments: owner write',
    'hub_conversations|hub_conversations: participant read/write',
    'hub_follows|hub_follows: owner write',
    'hub_messages|hub_messages: insert',
    'hub_messages|hub_messages: update',
    'hub_posts|hub_posts: owner write',
    'hub_reactions|hub_reactions: owner write',
    'nutrition_logs|nutrition_logs: owner full access',
    'regimens|regimens: owner full access',
    'workout_logs|workout_logs: owner full access',
    'workout_templates|workout_templates: owner full access'
  ] LOOP
    v_table  := split_part(v_pair, '|', 1);
    v_policy := split_part(v_pair, '|', 2);

    -- Skip anything already gone or renamed rather than failing the batch.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = v_table AND policyname = v_policy
    ) THEN
      RAISE NOTICE 'skipped % / % — not present', v_table, v_policy;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER POLICY %I ON public.%I WITH CHECK ('
      || '(created_by IS NULL OR created_by = (SELECT NULLIF(public.current_user_email(), '''''''')))'
      || ' AND (user_id IS NULL OR user_id = (SELECT auth.uid()))'
      || ' AND (created_by IS NOT NULL OR user_id IS NOT NULL))',
      v_policy, v_table);

    v_done := v_done + 1;
  END LOOP;

  RAISE NOTICE 'hardened % policies', v_done;
END $$;

-- Proof it ran. The Supabase editor swallows RAISE NOTICE, so every handover
-- ends in a SELECT that shows its work. `remaining_vulnerable` must be 0.
SELECT
  count(*) FILTER (
    WHERE with_check = '((( SELECT NULLIF(current_user_email(), ''''::text) AS email) = created_by) OR (( SELECT auth.uid() AS uid) = user_id))'
  ) AS remaining_vulnerable,
  -- Postgres re-renders the expression with its own parentheses, so this
  -- matches `(created_by IS NOT NULL) OR` rather than the text as written.
  -- The first version of this line counted 0 against a fully-applied fix.
  count(*) FILTER (WHERE with_check LIKE '%IS NOT NULL) OR%') AS hardened,
  CASE
    WHEN count(*) FILTER (
      WHERE with_check = '((( SELECT NULLIF(current_user_email(), ''''::text) AS email) = created_by) OR (( SELECT auth.uid() AS uid) = user_id))'
    ) = 0 THEN 'OK — no policy still accepts a spoofed owner column'
    ELSE 'INCOMPLETE — some policies still carry the OR write rule'
  END AS result
FROM pg_policies
WHERE schemaname = 'public';
