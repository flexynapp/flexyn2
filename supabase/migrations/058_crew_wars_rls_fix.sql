-- 058_crew_wars_rls_fix.sql
-- Fix crew_wars RLS: add insert/update policies so crew members can enter
-- matchmaking and update scores from the client.
-- Also make crew_b_id nullable so a matchmaking row can be created before
-- a rival crew is paired (the cron/admin fills it in later).

-- Allow crew_b_id to be NULL during matchmaking
ALTER TABLE public.crew_wars
  ALTER COLUMN crew_b_id DROP NOT NULL;

-- Re-apply SELECT policy (was defined in 055 but re-stated here for clarity)
DROP POLICY IF EXISTS "crew_wars_read" ON public.crew_wars;
CREATE POLICY "crew_wars_read"
  ON public.crew_wars FOR SELECT
  USING (TRUE);

-- Any authenticated crew member may create a matchmaking row for their crew
DROP POLICY IF EXISTS "crew_wars_insert" ON public.crew_wars;
CREATE POLICY "crew_wars_insert"
  ON public.crew_wars FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.crew_members
      WHERE crew_id = crew_a_id
        AND user_id = auth.uid()
    )
  );

-- Crew members of either side may update scores (contributeWarXp runs client-side)
DROP POLICY IF EXISTS "crew_wars_update" ON public.crew_wars;
CREATE POLICY "crew_wars_update"
  ON public.crew_wars FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.crew_members
        WHERE crew_id = crew_a_id AND user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.crew_members
        WHERE crew_id = crew_b_id AND user_id = auth.uid()
      )
    )
  );
