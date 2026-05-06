-- Migration 016: Weekly Leagues + Workout Streak
--
-- Two retention systems landing together:
--   1. Leagues — weekly cohort competition. Every active user is auto-placed
--      into a 30-person league at their tier (bronze/silver/gold/platinum/
--      diamond/legend). Top 10 promote · bottom 5 demote · weekly reset.
--   2. Workout streak — a *separate* streak from login streak. Counts
--      consecutive days the user actually completes a workout (strength OR
--      cardio). Harder to maintain → more meaningful badge.
--
-- Safe to re-run: every CREATE / ALTER uses IF NOT EXISTS guards.

-- ─────────────────────────────────────────────────────────────────────────────
-- Workout streak columns on user_profiles
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS workout_streak INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_workout_date DATE,
  ADD COLUMN IF NOT EXISTS longest_workout_streak INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS league_tier TEXT DEFAULT 'bronze';

-- ─────────────────────────────────────────────────────────────────────────────
-- leagues — one row per (tier, week_start) pair, holds up to MAX_LEAGUE_SIZE
-- members. New leagues are created lazily as users join.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leagues (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier         TEXT NOT NULL CHECK (tier IN ('bronze','silver','gold','platinum','diamond','legend')),
  week_start   DATE NOT NULL,            -- Monday of the league's active week
  week_end     DATE NOT NULL,            -- Sunday of the league's active week
  member_count INTEGER NOT NULL DEFAULT 0,
  is_resolved  BOOLEAN NOT NULL DEFAULT false,  -- true after weekly rollover applied
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leagues_tier_week
  ON public.leagues(tier, week_start);

CREATE INDEX IF NOT EXISTS idx_leagues_open
  ON public.leagues(tier, week_start, member_count)
  WHERE is_resolved = false;

ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read all leagues (so the UI can show standings).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'leagues' AND policyname = 'leagues: read all') THEN
    CREATE POLICY "leagues: read all"
      ON public.leagues FOR SELECT
      TO authenticated USING (true);
  END IF;
END $$;

-- Inserts/updates happen via supabase from the client right now (lazy creation).
-- On migration to a server function, narrow this with WITH CHECK rules.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'leagues' AND policyname = 'leagues: insert authenticated') THEN
    CREATE POLICY "leagues: insert authenticated"
      ON public.leagues FOR INSERT
      TO authenticated WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'leagues' AND policyname = 'leagues: update authenticated') THEN
    CREATE POLICY "leagues: update authenticated"
      ON public.leagues FOR UPDATE
      TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- league_members — one row per (league, user). Holds the user's weekly XP
-- and final rank after the week resolves.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.league_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email  TEXT NOT NULL,
  weekly_xp   INTEGER NOT NULL DEFAULT 0,
  rank        INTEGER,                   -- set on rollover; null while active
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(league_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_league_members_user
  ON public.league_members(user_id, joined_at DESC);

CREATE INDEX IF NOT EXISTS idx_league_members_league_xp
  ON public.league_members(league_id, weekly_xp DESC);

ALTER TABLE public.league_members ENABLE ROW LEVEL SECURITY;

-- Read all rows in a league you're a member of (so you see the full standings).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'league_members' AND policyname = 'league_members: read same league') THEN
    CREATE POLICY "league_members: read same league"
      ON public.league_members FOR SELECT
      TO authenticated USING (
        EXISTS (
          SELECT 1 FROM public.league_members lm2
          WHERE lm2.league_id = league_members.league_id
            AND lm2.user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Users can insert their own membership row.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'league_members' AND policyname = 'league_members: insert own') THEN
    CREATE POLICY "league_members: insert own"
      ON public.league_members FOR INSERT
      TO authenticated WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- Users can update their own membership row (weekly_xp accrual).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'league_members' AND policyname = 'league_members: update own') THEN
    CREATE POLICY "league_members: update own"
      ON public.league_members FOR UPDATE
      TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.leagues          TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.league_members   TO authenticated;
