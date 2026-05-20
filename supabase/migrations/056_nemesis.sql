-- 056_nemesis.sql
-- Nemesis System: auto-assigned rival slightly above the user's level.

CREATE TYPE IF NOT EXISTS public.nemesis_status AS ENUM ('active', 'overthrown', 'reassigned');

CREATE TABLE IF NOT EXISTS public.nemesis_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nemesis_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          public.nemesis_status NOT NULL DEFAULT 'active',
  overthrown_at   TIMESTAMPTZ,
  CONSTRAINT different_users CHECK (user_id != nemesis_id)
);

-- Only one active nemesis per user at a time
CREATE UNIQUE INDEX IF NOT EXISTS nemesis_one_active_per_user
  ON public.nemesis_assignments (user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS nemesis_user_idx    ON public.nemesis_assignments (user_id);
CREATE INDEX IF NOT EXISTS nemesis_nemesis_idx ON public.nemesis_assignments (nemesis_id);

ALTER TABLE public.nemesis_assignments ENABLE ROW LEVEL SECURITY;

-- User can only see their own nemesis assignments (assignments are private)
DROP POLICY IF EXISTS "nemesis_own" ON public.nemesis_assignments;
CREATE POLICY "nemesis_own"
  ON public.nemesis_assignments
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add overthrow_count to user_profiles (safe if column already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'overthrow_count'
  ) THEN
    ALTER TABLE public.user_profiles ADD COLUMN overthrow_count INT NOT NULL DEFAULT 0;
  END IF;

  -- Opt-out of being a nemesis
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'nemesis_opt_out'
  ) THEN
    ALTER TABLE public.user_profiles ADD COLUMN nemesis_opt_out BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;
