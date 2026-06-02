-- 059_bounties.sql
-- Bounty System: auto-generated social challenges with Flex Coin rewards.

-- ── Enums ─────────────────────────────────────────────────────────────────────
CREATE TYPE IF NOT EXISTS public.bounty_metric AS ENUM (
  'single_lift_weight',
  'single_lift_reps',
  'weekly_volume',
  'session_volume'
);

CREATE TYPE IF NOT EXISTS public.bounty_difficulty AS ENUM ('easy', 'medium', 'hard');
CREATE TYPE IF NOT EXISTS public.bounty_claim_status AS ENUM ('active', 'completed', 'failed', 'expired');

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.bounties (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_username   TEXT NOT NULL,
  target_avatar_url TEXT,
  metric            public.bounty_metric NOT NULL,
  exercise_name     TEXT,                       -- null for volume-based bounties
  target_value      FLOAT NOT NULL,
  difficulty        public.bounty_difficulty NOT NULL DEFAULT 'medium',
  entry_fee         INT NOT NULL,
  reward            INT NOT NULL,
  claimed_by_id     UUID REFERENCES auth.users(id),  -- null = open, set = taken
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bounty_claims (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_id      UUID NOT NULL REFERENCES public.bounties(id) ON DELETE CASCADE,
  claimant_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status         public.bounty_claim_status NOT NULL DEFAULT 'active',
  claimed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deadline       TIMESTAMPTZ NOT NULL,
  completed_at   TIMESTAMPTZ,
  workout_log_id UUID,
  UNIQUE (bounty_id, claimant_id)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS bounties_target_idx    ON public.bounties (target_user_id);
CREATE INDEX IF NOT EXISTS bounties_expires_idx   ON public.bounties (expires_at);
CREATE INDEX IF NOT EXISTS bounties_claimed_idx   ON public.bounties (claimed_by_id);
CREATE INDEX IF NOT EXISTS bounty_claims_user_idx ON public.bounty_claims (claimant_id);
CREATE INDEX IF NOT EXISTS bounty_claims_status_idx ON public.bounty_claims (claimant_id, status);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.bounties       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bounty_claims  ENABLE ROW LEVEL SECURITY;

-- Active bounties visible to everyone
DROP POLICY IF EXISTS "bounties_read" ON public.bounties;
CREATE POLICY "bounties_read"
  ON public.bounties FOR SELECT
  USING (TRUE);

-- Authenticated users can insert bounties (cron + client generation)
DROP POLICY IF EXISTS "bounties_insert" ON public.bounties;
CREATE POLICY "bounties_insert"
  ON public.bounties FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Update bounty (mark claimed) via RPC only (SECURITY DEFINER bypasses RLS)
DROP POLICY IF EXISTS "bounties_update" ON public.bounties;
CREATE POLICY "bounties_update"
  ON public.bounties FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- Own claims only
DROP POLICY IF EXISTS "bounty_claims_read" ON public.bounty_claims;
CREATE POLICY "bounty_claims_read"
  ON public.bounty_claims FOR SELECT
  USING (auth.uid() = claimant_id);

DROP POLICY IF EXISTS "bounty_claims_insert" ON public.bounty_claims;
CREATE POLICY "bounty_claims_insert"
  ON public.bounty_claims FOR INSERT
  WITH CHECK (auth.uid() = claimant_id);

DROP POLICY IF EXISTS "bounty_claims_update" ON public.bounty_claims;
CREATE POLICY "bounty_claims_update"
  ON public.bounty_claims FOR UPDATE
  USING (auth.uid() = claimant_id);

-- ── claim_bounty RPC ──────────────────────────────────────────────────────────
-- Atomically: validates bounty, deducts entry fee, marks bounty claimed,
-- inserts claim row. Returns the new claim UUID.
CREATE OR REPLACE FUNCTION public.claim_bounty(p_bounty_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_bounty   public.bounties%ROWTYPE;
  v_coins    INT;
  v_claim_id UUID;
  v_deadline TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Lock bounty row
  SELECT * INTO v_bounty
    FROM public.bounties
   WHERE id = p_bounty_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bounty_not_found';
  END IF;

  IF v_bounty.expires_at < NOW() THEN
    RAISE EXCEPTION 'bounty_expired';
  END IF;

  IF v_bounty.target_user_id = v_user_id THEN
    RAISE EXCEPTION 'cannot_claim_own_bounty';
  END IF;

  IF v_bounty.claimed_by_id IS NOT NULL THEN
    RAISE EXCEPTION 'bounty_already_claimed';
  END IF;

  -- Only one active claim at a time
  IF EXISTS (
    SELECT 1 FROM public.bounty_claims
     WHERE claimant_id = v_user_id
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'already_have_active_claim';
  END IF;

  -- Check and deduct coins
  SELECT flex_coins INTO v_coins
    FROM public.user_profiles
   WHERE id = v_user_id
     FOR UPDATE;

  IF v_coins < v_bounty.entry_fee THEN
    RAISE EXCEPTION 'insufficient_coins';
  END IF;

  UPDATE public.user_profiles
     SET flex_coins = flex_coins - v_bounty.entry_fee
   WHERE id = v_user_id;

  -- Mark bounty as taken
  UPDATE public.bounties
     SET claimed_by_id = v_user_id
   WHERE id = p_bounty_id;

  -- Deadline: 48h easy/medium, 72h hard
  v_deadline := NOW() + CASE
    WHEN v_bounty.difficulty = 'hard' THEN INTERVAL '72 hours'
    ELSE INTERVAL '48 hours'
  END;

  INSERT INTO public.bounty_claims (bounty_id, claimant_id, deadline)
  VALUES (p_bounty_id, v_user_id, v_deadline)
  RETURNING id INTO v_claim_id;

  RETURN v_claim_id;
END;
$$;

-- ── complete_bounty_claim RPC ─────────────────────────────────────────────────
-- Credits reward and marks claim completed. Called client-side after
-- verifying the metric was beaten, or by the Edge Function on log write.
CREATE OR REPLACE FUNCTION public.complete_bounty_claim(
  p_claim_id      UUID,
  p_workout_log_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_claim   public.bounty_claims%ROWTYPE;
  v_bounty  public.bounties%ROWTYPE;
BEGIN
  SELECT * INTO v_claim
    FROM public.bounty_claims
   WHERE id = p_claim_id
     AND claimant_id = v_user_id
     FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'claim_not_found'; END IF;
  IF v_claim.status <> 'active' THEN RAISE EXCEPTION 'claim_not_active'; END IF;

  SELECT * INTO v_bounty FROM public.bounties WHERE id = v_claim.bounty_id;

  UPDATE public.bounty_claims
     SET status = 'completed',
         completed_at = NOW(),
         workout_log_id = p_workout_log_id
   WHERE id = p_claim_id;

  -- Credit reward
  UPDATE public.user_profiles
     SET flex_coins = flex_coins + v_bounty.reward
   WHERE id = v_user_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
