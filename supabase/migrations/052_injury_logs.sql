-- 052_injury_logs.sql
-- Stores user-reported injuries for Recovery Mode.
-- Downstream effects handled client-side: workout generator filters excluded
-- muscle groups, AI Coach receives active injury context, recovery prompts
-- shown when estimated_recovery_date arrives.

CREATE TABLE IF NOT EXISTS public.injury_logs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  user_email              TEXT NOT NULL,
  muscle_group            TEXT NOT NULL,  -- matches app muscle group list
  severity                TEXT NOT NULL CHECK (severity IN ('mild','moderate','serious')),
  notes                   TEXT,
  injured_at              DATE NOT NULL DEFAULT CURRENT_DATE,
  estimated_recovery_date DATE,
  cleared_at              DATE,           -- null until user confirms cleared
  status                  TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','recovering','cleared')),
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.injury_logs ENABLE ROW LEVEL SECURITY;

-- DROP-THEN-CREATE so the migration is safely re-runnable (see note in 051).
DROP POLICY IF EXISTS "injury_logs_own" ON public.injury_logs;
CREATE POLICY "injury_logs_own"
  ON public.injury_logs
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
