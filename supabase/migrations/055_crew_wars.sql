-- 055_crew_wars.sql
-- Crew Wars: weekly crew vs crew XP competitions.

CREATE TYPE IF NOT EXISTS public.crew_war_status AS ENUM ('matchmaking', 'active', 'completed');

CREATE TABLE IF NOT EXISTS public.crew_wars (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_a_id        UUID NOT NULL REFERENCES public.crews(id) ON DELETE CASCADE,
  crew_b_id        UUID NOT NULL REFERENCES public.crews(id) ON DELETE CASCADE,
  status           public.crew_war_status NOT NULL DEFAULT 'matchmaking',
  starts_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at          TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  crew_a_score     INT NOT NULL DEFAULT 0,
  crew_b_score     INT NOT NULL DEFAULT 0,
  winner_crew_id   UUID REFERENCES public.crews(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT different_crews CHECK (crew_a_id != crew_b_id)
);

CREATE TABLE IF NOT EXISTS public.crew_war_contributions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  war_id           UUID NOT NULL REFERENCES public.crew_wars(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  crew_id          UUID NOT NULL REFERENCES public.crews(id) ON DELETE CASCADE,
  xp_contributed   INT NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (war_id, user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS crew_wars_crew_a_idx      ON public.crew_wars (crew_a_id);
CREATE INDEX IF NOT EXISTS crew_wars_crew_b_idx      ON public.crew_wars (crew_b_id);
CREATE INDEX IF NOT EXISTS crew_wars_status_idx      ON public.crew_wars (status);
CREATE INDEX IF NOT EXISTS crew_war_contrib_war_idx  ON public.crew_war_contributions (war_id);
CREATE INDEX IF NOT EXISTS crew_war_contrib_user_idx ON public.crew_war_contributions (user_id);

ALTER TABLE public.crew_wars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crew_war_contributions ENABLE ROW LEVEL SECURITY;

-- Everyone can read active wars (leaderboards, hub feed)
DROP POLICY IF EXISTS "crew_wars_read" ON public.crew_wars;
CREATE POLICY "crew_wars_read"
  ON public.crew_wars FOR SELECT
  USING (TRUE);

-- Only internal service role can insert/update crew_wars (cron job)
DROP POLICY IF EXISTS "crew_war_contrib_read" ON public.crew_war_contributions;
CREATE POLICY "crew_war_contrib_read"
  ON public.crew_war_contributions FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS "crew_war_contrib_own" ON public.crew_war_contributions;
CREATE POLICY "crew_war_contrib_own"
  ON public.crew_war_contributions FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
