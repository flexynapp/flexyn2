-- Migration 014: Gamification — Daily Quests + Login Streak
--
-- Adds the data foundation for the daily-engagement system:
--   • user_daily_quests — three rotating quests per user per day
--   • user_profiles.{login_streak, last_login_date, longest_login_streak,
--                    streak_freezes_available} — streak tracking
--
-- Safe to re-run: every ALTER and CREATE uses IF NOT EXISTS / IF EXISTS guards.
-- Run in Supabase SQL Editor (same process as previous migrations).

-- ─────────────────────────────────────────────────────────────────────────────
-- Login streak columns on user_profiles
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS login_streak INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_login_date DATE,
  ADD COLUMN IF NOT EXISTS longest_login_streak INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_freezes_available INTEGER DEFAULT 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- user_daily_quests — three quest rows per user per day
--   quest_id is a stable identifier from src/lib/questCatalog.js
--   progress / target track completion (e.g. 3/4 glasses of water)
--   completed_at fires when progress >= target
--   claimed_at fires when user taps "Claim" — coins credited, row stays
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_daily_quests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email    TEXT NOT NULL,
  quest_date    DATE NOT NULL,
  quest_id      TEXT NOT NULL,
  difficulty    TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  coin_reward   INTEGER NOT NULL,
  progress      INTEGER NOT NULL DEFAULT 0,
  target        INTEGER NOT NULL DEFAULT 1,
  completed_at  TIMESTAMPTZ,
  claimed_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, quest_date, quest_id)
);

CREATE INDEX IF NOT EXISTS idx_user_daily_quests_lookup
  ON public.user_daily_quests(user_id, quest_date);

ALTER TABLE public.user_daily_quests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_daily_quests' AND policyname = 'quests: users view own') THEN
    CREATE POLICY "quests: users view own"
      ON public.user_daily_quests FOR SELECT
      TO authenticated USING (user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_daily_quests' AND policyname = 'quests: users insert own') THEN
    CREATE POLICY "quests: users insert own"
      ON public.user_daily_quests FOR INSERT
      TO authenticated WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_daily_quests' AND policyname = 'quests: users update own') THEN
    CREATE POLICY "quests: users update own"
      ON public.user_daily_quests FOR UPDATE
      TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.user_daily_quests TO authenticated;

NOTIFY pgrst, 'reload schema';
