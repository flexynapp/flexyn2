-- 060_gauntlet.sql
-- Gauntlet Path: 10-challenge linear progression + weekly community gauntlet.

-- ── Enums ─────────────────────────────────────────────────────────────────────
DO $x$ BEGIN
  CREATE TYPE public.gauntlet_challenge_type AS ENUM (
    'single_session', 'weekly_volume', 'streak', 'nutrition', 'pr', 'final'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $x$;

DO $x$ BEGIN
  CREATE TYPE public.weekly_gauntlet_status AS ENUM ('upcoming', 'active', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $x$;

DO $x$ BEGIN
  CREATE TYPE public.weekly_gauntlet_scoring AS ENUM ('completion_pct', 'total_volume', 'fastest_time');
EXCEPTION WHEN duplicate_object THEN NULL; END $x$;

DO $x$ BEGIN
  CREATE TYPE public.gauntlet_attempt_status AS ENUM ('in_progress', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $x$;

-- ── Personal path tables ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.gauntlet_challenges (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_number     INT NOT NULL UNIQUE,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL,
  flavor_text         TEXT NOT NULL,
  type                public.gauntlet_challenge_type NOT NULL,
  metric              TEXT,
  target_value        FLOAT,
  xp_reward           INT NOT NULL DEFAULT 150,
  coin_reward         INT NOT NULL DEFAULT 50,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_gauntlet_progress (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                      UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  current_challenge_sequence   INT NOT NULL DEFAULT 1,
  challenges_completed         INT NOT NULL DEFAULT 0,
  last_completed_at            TIMESTAMPTZ,
  final_gauntlet_attempts      INT NOT NULL DEFAULT 0,
  final_gauntlet_last_attempt  TIMESTAMPTZ,
  path_completed               BOOLEAN NOT NULL DEFAULT FALSE,
  path_completed_at            TIMESTAMPTZ,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_gauntlet_completions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge_id    UUID NOT NULL REFERENCES public.gauntlet_challenges(id),
  sequence_number INT NOT NULL,
  completed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  score           FLOAT,
  workout_log_id  UUID,
  UNIQUE (user_id, challenge_id)
);

-- ── Weekly gauntlet tables ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.weekly_gauntlets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  flavor_text       TEXT NOT NULL,
  session_template  JSONB,
  scoring_method    public.weekly_gauntlet_scoring NOT NULL DEFAULT 'total_volume',
  passing_threshold FLOAT NOT NULL DEFAULT 10000,
  week_start        DATE NOT NULL,
  week_end          DATE NOT NULL,
  status            public.weekly_gauntlet_status NOT NULL DEFAULT 'upcoming',
  attempt_count     INT NOT NULL DEFAULT 0,
  completion_count  INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.weekly_gauntlet_attempts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gauntlet_id    UUID NOT NULL REFERENCES public.weekly_gauntlets(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status         public.gauntlet_attempt_status NOT NULL DEFAULT 'in_progress',
  score          FLOAT,
  percentile     FLOAT,
  rank           INT,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  workout_log_id UUID,
  UNIQUE (gauntlet_id, user_id)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS gauntlet_challenges_seq_idx     ON public.gauntlet_challenges (sequence_number);
CREATE INDEX IF NOT EXISTS user_gauntlet_progress_user_idx ON public.user_gauntlet_progress (user_id);
CREATE INDEX IF NOT EXISTS user_gauntlet_completions_user_idx ON public.user_gauntlet_completions (user_id);
CREATE INDEX IF NOT EXISTS weekly_gauntlets_status_idx     ON public.weekly_gauntlets (status);
CREATE INDEX IF NOT EXISTS weekly_gauntlet_attempts_user_idx ON public.weekly_gauntlet_attempts (user_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.gauntlet_challenges         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_gauntlet_progress      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_gauntlet_completions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_gauntlets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_gauntlet_attempts    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gauntlet_challenges_read" ON public.gauntlet_challenges;
CREATE POLICY "gauntlet_challenges_read" ON public.gauntlet_challenges FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "user_gauntlet_progress_own" ON public.user_gauntlet_progress;
CREATE POLICY "user_gauntlet_progress_own" ON public.user_gauntlet_progress
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_gauntlet_completions_own" ON public.user_gauntlet_completions;
CREATE POLICY "user_gauntlet_completions_own" ON public.user_gauntlet_completions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Anyone can read weekly gauntlet counts (for stats card)
DROP POLICY IF EXISTS "weekly_gauntlets_read" ON public.weekly_gauntlets;
CREATE POLICY "weekly_gauntlets_read" ON public.weekly_gauntlets FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "weekly_gauntlet_attempts_own" ON public.weekly_gauntlet_attempts;
CREATE POLICY "weekly_gauntlet_attempts_own" ON public.weekly_gauntlet_attempts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── complete_gauntlet_challenge RPC ───────────────────────────────────────────
-- Atomically: writes completion, advances progress, awards XP + coins.
-- Returns JSON: { challenge_id, next_sequence, xp_awarded, coins_awarded, path_completed }
CREATE OR REPLACE FUNCTION public.complete_gauntlet_challenge(
  p_sequence_number INT,
  p_workout_log_id  UUID DEFAULT NULL,
  p_score           FLOAT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $x$
DECLARE
  v_user_id   UUID := auth.uid();
  v_challenge public.gauntlet_challenges%ROWTYPE;
  v_progress  public.user_gauntlet_progress%ROWTYPE;
  v_next_seq  INT;
  v_path_done BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_challenge FROM public.gauntlet_challenges
   WHERE sequence_number = p_sequence_number;
  IF NOT FOUND THEN RAISE EXCEPTION 'challenge_not_found'; END IF;

  -- Upsert progress row
  INSERT INTO public.user_gauntlet_progress (user_id, current_challenge_sequence)
  VALUES (v_user_id, 1)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_progress FROM public.user_gauntlet_progress
   WHERE user_id = v_user_id FOR UPDATE;

  -- Guard: must be on this challenge (or admin replay — allow equal)
  IF v_progress.current_challenge_sequence <> p_sequence_number THEN
    RAISE EXCEPTION 'wrong_challenge';
  END IF;

  -- Guard: not already completed
  IF EXISTS (
    SELECT 1 FROM public.user_gauntlet_completions
     WHERE user_id = v_user_id AND challenge_id = v_challenge.id
  ) THEN
    RAISE EXCEPTION 'already_completed';
  END IF;

  -- Write completion record
  INSERT INTO public.user_gauntlet_completions
    (user_id, challenge_id, sequence_number, score, workout_log_id)
  VALUES (v_user_id, v_challenge.id, p_sequence_number, p_score, p_workout_log_id);

  -- Advance progress
  v_next_seq := p_sequence_number + 1;
  SELECT COUNT(*) = 0 INTO v_path_done FROM public.gauntlet_challenges
   WHERE sequence_number = v_next_seq;

  UPDATE public.user_gauntlet_progress SET
    current_challenge_sequence = CASE WHEN v_path_done THEN p_sequence_number ELSE v_next_seq END,
    challenges_completed       = challenges_completed + 1,
    last_completed_at          = NOW(),
    path_completed             = v_path_done,
    path_completed_at          = CASE WHEN v_path_done THEN NOW() ELSE NULL END
  WHERE user_id = v_user_id;

  -- Award XP
  UPDATE public.user_profiles SET
    total_xp     = COALESCE(total_xp, 0)     + v_challenge.xp_reward,
    lifetime_xp  = COALESCE(lifetime_xp, 0)  + v_challenge.xp_reward,
    flex_coins   = COALESCE(flex_coins, 0)   + v_challenge.coin_reward
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'challenge_id',    v_challenge.id,
    'challenge_title', v_challenge.title,
    'next_sequence',   v_next_seq,
    'xp_awarded',      v_challenge.xp_reward,
    'coins_awarded',   v_challenge.coin_reward,
    'path_completed',  v_path_done
  );
END;
$x$;

-- ── Seed: all 10 challenges ───────────────────────────────────────────────────
INSERT INTO public.gauntlet_challenges
  (sequence_number, title, description, flavor_text, type, metric, target_value, xp_reward, coin_reward)
VALUES
  (1,  'First Blood',
       'Complete any full workout session with at least 4 exercises and zero skipped sets.',
       'Everyone starts somewhere. Start here.',
       'single_session', 'min_exercises_no_skip', 4, 150, 50),

  (2,  'Three and Done',
       'Log 3 workout sessions within any 7-day window.',
       'Three sessions. No excuses. Just reps.',
       'streak', 'sessions_in_7_days', 3, 200, 75),

  (3,  'Volume Check',
       'Hit 10,000 lbs of total volume in a single workout session.',
       'Ten thousand pounds. You''ve moved mountains before.',
       'single_session', 'session_volume', 10000, 275, 100),

  (4,  'No Days Off',
       'Complete 4 workout sessions within any 5-day window.',
       'Four sessions. Five days. Can you hold the pace?',
       'streak', 'sessions_in_5_days', 4, 350, 125),

  (5,  'Ironclad',
       'Complete a session with 5 or more exercises and zero sets skipped.',
       'Not a single rep left behind.',
       'single_session', 'min_exercises_no_skip', 5, 450, 150),

  (6,  'Double Shift',
       'Log 6 workout sessions in a single calendar week.',
       'Six in seven. The grind doesn''t negotiate.',
       'streak', 'sessions_in_7_days', 6, 550, 200),

  (7,  'The Grind',
       'Move 50,000 lbs of total volume in a single week.',
       'Fifty thousand pounds. You''ll feel every one.',
       'weekly_volume', 'weekly_lbs', 50000, 700, 250),

  (8,  'No Excuses',
       'Maintain a 14-day consecutive workout streak.',
       'Fourteen days. No gaps. No mercy.',
       'streak', 'consecutive_days', 14, 850, 300),

  (9,  'Last Rep',
       'Hit a new personal record on any compound lift in a single session.',
       'You don''t hit PRs. You take them.',
       'pr', 'any_compound_pr', NULL, 1000, 400),

  (10, 'The Final Gauntlet',
       'Move 100,000 lbs of total volume in a single week. The mountain doesn''t end. You do.',
       'One hundred thousand pounds. The mountain doesn''t care how tired you are.',
       'weekly_volume', 'weekly_lbs', 100000, 1500, 500)
ON CONFLICT (sequence_number) DO NOTHING;

-- ── Seed: active weekly gauntlet (first public week) ─────────────────────────
INSERT INTO public.weekly_gauntlets
  (title, description, flavor_text, scoring_method, passing_threshold,
   week_start, week_end, status)
VALUES (
  'Opening Week — The 10K',
  'Log a single workout session totaling at least 10,000 lbs of volume. Any exercises, any order. Just move the weight.',
  'Week one. Everyone starts equal. Not everyone finishes.',
  'total_volume',
  10000,
  date_trunc('week', CURRENT_DATE)::date,
  (date_trunc('week', CURRENT_DATE) + INTERVAL '6 days')::date,
  'active'
)
ON CONFLICT DO NOTHING;
