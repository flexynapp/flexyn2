-- 382_drop_regimens_clone_count.sql
--
-- `regimens.clone_count` goes. `copy_count` is the counter (kegan, 2026-08-30).
--
-- Migration 381 added clone_count because production had it and no migration
-- described it. Reading the history behind it makes clear it should never have
-- existed: it is residue of a code-vs-schema drift that `crews.js` already
-- documents in full. The 2026-05-25 audit found `cloneRegimen` incrementing
-- `clone_count`, a column mig 005 never created — the .catch swallowed the
-- PGRST204 and the badge read "0 clones" on every regimen. That audit fixed the
-- CODE to say `copy_count`, and the orphan column was left behind in the
-- database, described by nothing.
--
-- So there are two counters for one idea and only one of them is real:
--
--   copy_count   mig 005, incremented by the increment_copy_count RPC (mig 042)
--   clone_count  created by no migration, written by nothing, 0 on all 33 rows
--
-- NO DATA IS LOST. Measured before writing this: clone_count is 0 on 33 of 33
-- regimens, max 0. Nothing has ever written to it — there is no trigger, RPC or
-- client path that sets it.
--
-- NOTHING DEPENDS ON IT. Checked against production: no index, no RLS policy,
-- no view, no constraint, and no function body references the column. The DROP
-- needs no CASCADE and takes nothing with it.
--
-- THE CLIENT MOVED FIRST, and there is no flag day either way. As of the commit
-- carrying this file, all five reads are on `copy_count`:
--
--   RegimenDetailView    clone_count ?? 0            -> copy_count ?? 0
--   RegimenStorePage x4  copy_count || clone_count   -> copy_count
--
-- Those were `select('*')` reads, so even in the window where an old bundle
-- meets this schema nothing 400s: the column is simply absent and `?? 0` /
-- `|| 0` already handle it. The old behaviour was 0 regardless, because the
-- column was 0. Whichever order deploy and paste happen in, the number on
-- screen does not change.
--
-- Worth knowing separately: `copy_count` is ALSO 0 on all 33 rows, and that is
-- a different bug with a different cause, already analysed in crews.js — two
-- real clones exist and both counter bumps were dropped because a cross-user
-- UPDATE matches zero rows under the owner-scoped RLS policy and returns 200.
-- That path now calls increment_copy_count. Dropping clone_count neither
-- causes nor fixes it; the two are unrelated beyond sharing a name.
--
-- Paste-safe: plain DDL, idempotent, no plpgsql.

-- ── 1. Drop the orphan ────────────────────────────────────────────────────
ALTER TABLE public.regimens
  DROP COLUMN IF EXISTS clone_count;

-- ── 2. Proof it ran ───────────────────────────────────────────────────────
-- The SQL editor hides RAISE NOTICE, so a migration that reports nothing looks
-- exactly like one that was never pasted. `clone_count_gone` must be true and
-- `copy_count_kept` must be true: this drops one counter and must not have
-- touched the other.
SELECT
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'regimens'
       AND column_name = 'clone_count'
  ) AS clone_count_gone,
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'regimens'
       AND column_name = 'copy_count'
  ) AS copy_count_kept,
  (SELECT count(*)::int FROM public.regimens) AS regimens_intact;
