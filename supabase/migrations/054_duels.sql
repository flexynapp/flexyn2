-- 054_duels.sql
-- Workout Duels: challenger vs opponent, three duel types.

CREATE TYPE IF NOT EXISTS public.duel_type   AS ENUM ('mirror', 'open', 'exercise');
CREATE TYPE IF NOT EXISTS public.duel_status AS ENUM ('pending', 'active', 'completed', 'declined', 'expired');

CREATE TABLE IF NOT EXISTS public.duels (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenger_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opponent_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type                 public.duel_type   NOT NULL DEFAULT 'open',
  status               public.duel_status NOT NULL DEFAULT 'pending',
  session_template     JSONB,                          -- mirror: exercise list
  target_exercise_id   UUID,                           -- exercise duel focus
  window_hours         INT NOT NULL DEFAULT 24,
  challenger_result    JSONB,                          -- { volume, sets_completed, sets_prescribed, reps, weight }
  opponent_result      JSONB,
  winner_id            UUID REFERENCES auth.users(id),
  hub_posted           BOOLEAN NOT NULL DEFAULT FALSE, -- opt-out flag
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

-- Indexes
CREATE INDEX IF NOT EXISTS duels_challenger_idx ON public.duels (challenger_id);
CREATE INDEX IF NOT EXISTS duels_opponent_idx   ON public.duels (opponent_id);
CREATE INDEX IF NOT EXISTS duels_status_idx     ON public.duels (status);

ALTER TABLE public.duels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "duels_participants" ON public.duels;
CREATE POLICY "duels_participants"
  ON public.duels
  FOR ALL
  USING  (auth.uid() = challenger_id OR auth.uid() = opponent_id)
  WITH CHECK (auth.uid() = challenger_id OR auth.uid() = opponent_id);
