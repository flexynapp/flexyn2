-- 381_columns_the_migrations_never_described.sql
--
-- Two columns exist in production and no migration in this repo creates them:
--
--     regimens.clone_count       integer  NOT NULL  DEFAULT 0
--     workout_logs.tags          text[]   NOT NULL  DEFAULT '{}'::text[]
--
-- Found on 2026-08-30 by diffing every column the migrations declare against
-- information_schema in production. 140 of 147 tables matched exactly; these
-- two are the entire "production has something the migrations do not describe"
-- side of the difference. Neither appears anywhere under supabase/ — not in a
-- CREATE TABLE, not in an ADD COLUMN, not in a comment.
--
-- THIS MIGRATION CHANGES NOTHING TODAY, AND THAT IS THE POINT. Both columns
-- are already there, so `ADD COLUMN IF NOT EXISTS` is a no-op against the
-- current database. What it fixes is the REBUILD: replay this repo into an
-- empty project today and you get a schema missing both, which is a difference
-- that would not surface as an error.
--
-- `regimens.clone_count` is the one that would bite. RegimenDetailView reads
-- `regimen.clone_count ?? 0` and RegimenStorePage reads
-- `regimen.copy_count || regimen.clone_count || 0` in two places. Those are
-- `select('*')` reads, so a missing column is not a 400 — it is `undefined`,
-- silently coerced to 0, and the store shows every regimen with no copies.
-- That is the same shape as the four other defects found this week: a 200 with
-- a field that is not there.
--
-- MEASURED BEFORE WRITING THIS, because a column worth restoring should be a
-- column something fills:
--
--     regimens.clone_count    33 rows, 0 non-zero, max 0
--     regimens.copy_count     33 rows, 0 non-zero, max 0
--     workout_logs.tags        9 rows, 0 non-empty
--
-- All three are empty today, so restoring them changes nothing anyone can see.
-- It is still right — the migrations should describe the database — and two of
-- those rows are worth a second look:
--
--   • `clone_count` and `copy_count` are TWO counters for one idea, both zero,
--     and the client reads `copy_count || clone_count`. The `increment_copy_count`
--     RPC maintains copy_count only. One of them should go, and which one is a
--     product decision rather than a schema one, so this migration keeps both.
--   • `workout_logs.tags` is empty on every row but it is NOT unused: the saved
--     workout list filters on it (`WorkoutSavedList` joins it into the search
--     haystack and renders TagPillRow) and EditWorkoutModal edits it. It is a
--     live feature nobody has typed a tag into yet, so it stays.
--
-- Types, nullability and defaults below are copied from information_schema as
-- it stands, not guessed, so a rebuilt database matches byte for byte.
--
-- Paste-safe: plain DDL, no plpgsql, no dotted record access, no angle
-- brackets. Idempotent — running it twice, or against a database that already
-- has both columns, does nothing.

-- ── 1. regimens.clone_count ───────────────────────────────────────────────
-- NOT NULL with a DEFAULT is safe to add to a populated table on PG 11+: the
-- default is stored in the catalogue rather than written into every row, so
-- this does not rewrite the table.
ALTER TABLE public.regimens
  ADD COLUMN IF NOT EXISTS clone_count INTEGER NOT NULL DEFAULT 0;

-- ── 2. workout_logs.tags ──────────────────────────────────────────────────
ALTER TABLE public.workout_logs
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'::text[];

-- ── 3. Proof it ran ───────────────────────────────────────────────────────
-- The SQL editor hides RAISE NOTICE, so a migration that reports nothing is
-- indistinguishable from one that was never pasted. Both rows below must come
-- back `true`, and the type/default columns are there so a rebuilt database
-- can be compared against production rather than merely confirmed non-empty.
SELECT
  c.table_name || '.' || c.column_name AS column,
  (c.is_nullable = 'NO')               AS not_null,
  c.data_type,
  c.column_default,
  TRUE                                 AS present
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND (   (c.table_name = 'regimens'     AND c.column_name = 'clone_count')
       OR (c.table_name = 'workout_logs' AND c.column_name = 'tags'))
ORDER BY 1;
