-- Migration 183: lock user_profiles base-table reads to the owner (STAGED)
--
-- ⚠️  RUN THIS ONLY AFTER:
--      1. Migration 182 (public_profiles view) is applied, AND
--      2. The frontend that reads public_profiles is DEPLOYED to prod.
--
-- This drops the open `USING (true)` SELECT policy on user_profiles so the
-- base table is readable only by its owner (the "Users can read their own
-- profile" policy from mig 001 remains). After this, all cross-user reads
-- MUST go through public.public_profiles (mig 182). The client switch
-- (users.js selectProfiles helper) probes the view first and falls back to
-- the base table only on view-MISSING — it does NOT fall back on
-- permission-denied, so running this before the frontend is live would
-- make cross-user reads (feeds, leaderboards, search) return empty.
--
-- Splitting this out lets the view + client ship and bake first; flip this
-- last. Reversible: re-create the policy below to roll back.

DROP POLICY IF EXISTS "Public profiles are readable by all" ON public.user_profiles;

-- Rollback (run to revert):
--   CREATE POLICY "Public profiles are readable by all"
--     ON public.user_profiles FOR SELECT USING (true);

NOTIFY pgrst, 'reload schema';
