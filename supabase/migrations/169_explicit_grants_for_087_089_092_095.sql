-- 169_explicit_grants_for_087_089_092_095.sql
--
-- Defense-in-depth — add explicit service_role GRANTs for the four
-- tables introduced in migrations 087 / 089 / 092 / 095. Those
-- migrations relied on the `ALTER DEFAULT PRIVILEGES` chain added in
-- migration 085, which auto-grants service_role on every new public
-- table going forward.
--
-- The auto-grant is correct for the CURRENT deploy but it's fragile:
--   1. Any future migration that uses `ALTER DEFAULT PRIVILEGES`
--      and accidentally resets the chain would silently strip the
--      grants from these four tables, breaking the SECURITY DEFINER
--      RPCs that touch them.
--   2. A user replaying migrations 086–095 against a fresh DB will
--      get the grants automatically (085 runs first), but a partial
--      restore from a backup that captured AFTER 085 but lost it
--      could leave these tables grant-less.
--   3. The Supabase managed dashboard's security panel flags tables
--      relying solely on default-privilege chains as a soft warning.
--
-- Explicit GRANT statements here lock in the access regardless of
-- what happens to the default-privileges chain. The grants are
-- idempotent (multiple runs are no-ops), so this migration is safe
-- to re-run.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.streak_rescues          TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.referrals               TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memory_reengagement_log TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sleep_logs              TO service_role;

-- Sequence grants — INSERT requires the sequence's USAGE + SELECT
-- when the row uses a serial/identity column. None of these four
-- tables use serial PKs currently (all UUIDs), so this block is
-- defensive against a future schema change that adds one. The
-- pg_class lookup is wrapped in a DO block so a missing sequence
-- (the normal case) doesn't fail the migration.
DO $$
DECLARE
  seq_name TEXT;
BEGIN
  FOR seq_name IN
    SELECT c.oid::regclass::text
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'S'
       AND n.nspname = 'public'
       AND c.relname IN (
         'streak_rescues_id_seq', 'referrals_id_seq',
         'memory_reengagement_log_id_seq', 'sleep_logs_id_seq'
       )
  LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', seq_name);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
