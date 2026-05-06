-- Migration 020: Fix infinite recursion in league_members RLS
--
-- The original policy from migration 016 was:
--
--   CREATE POLICY "league_members: read same league" ON league_members
--     FOR SELECT USING (EXISTS (
--       SELECT 1 FROM league_members lm2
--       WHERE lm2.league_id = league_members.league_id
--         AND lm2.user_id = auth.uid()
--     ));
--
-- The SELECT inside the policy is itself filtered by the same policy,
-- causing Postgres to recurse infinitely. Symptom in logs:
--
--   {code: '42P17', message: 'infinite recursion detected in policy for
--   relation "league_members"'}
--
-- Fix: replace with a simple "all authenticated users can read" policy.
-- League standings are inherently public information (it's a leaderboard);
-- there's no privacy harm in exposing the rows to other authenticated users,
-- and it removes the recursion entirely. Insert/update policies remain
-- locked to the row's owner.

DROP POLICY IF EXISTS "league_members: read same league" ON public.league_members;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'league_members' AND policyname = 'league_members: read all'
  ) THEN
    CREATE POLICY "league_members: read all"
      ON public.league_members FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
