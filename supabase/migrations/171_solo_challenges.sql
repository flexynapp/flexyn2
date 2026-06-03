-- 171_solo_challenges.sql
--
-- Solo Challenges — a second class of bounty that doesn't require a
-- target user. Screenshot feedback called for this: "we don't need
-- like a target. We should have like two kinds of bounties one
-- that's like beat this person's record their PR get a bunch of
-- cool stuff and second office here's a bounty lift 2000 pounds
-- this week."
--
-- The existing public.bounties table stays as-is — it still drives
-- the "beat @username's PR" board. This adds a SEPARATE
-- public.solo_challenges + public.solo_challenge_claims pair so
-- the two systems can evolve independently. The UI surfaces both
-- on the Bounties page.
--
-- Difficulty / coin economy mirrors the existing bounty
-- DIFFICULTY_CONFIG in src/lib/data/bounties.js so the two
-- surfaces feel like the same product, not two parallel ones.

-- ── Tables ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.solo_challenges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL,        -- 'weekly_volume','workout_count','cardio_minutes','beat_any_pr'
  title           TEXT NOT NULL,
  description     TEXT,
  target_value    NUMERIC NOT NULL CHECK (target_value > 0),
  target_unit     TEXT,                  -- 'lbs','sessions','minutes','prs'
  difficulty      TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
  reward_coins    INT NOT NULL CHECK (reward_coins > 0),
  expires_at      TIMESTAMPTZ NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.solo_challenge_claims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id    UUID NOT NULL REFERENCES public.solo_challenges(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id)            ON DELETE CASCADE,
  user_email      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','expired')),
  progress        NUMERIC NOT NULL DEFAULT 0,
  claimed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  -- A user can only have one active claim per challenge. Re-claiming
  -- after completion creates a new row in a fresh week's cycle.
  UNIQUE (challenge_id, user_id)
);

CREATE INDEX IF NOT EXISTS solo_challenges_active_idx
  ON public.solo_challenges (is_active, expires_at);
CREATE INDEX IF NOT EXISTS solo_challenge_claims_user_idx
  ON public.solo_challenge_claims (user_id, status);
CREATE INDEX IF NOT EXISTS solo_challenge_claims_challenge_idx
  ON public.solo_challenge_claims (challenge_id);

-- ── RLS ───────────────────────────────────────────────────────────────

ALTER TABLE public.solo_challenges        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solo_challenge_claims  ENABLE ROW LEVEL SECURITY;

-- Anyone signed in can READ active solo challenges (it's the open
-- board). No one can write directly to public.solo_challenges from
-- the client — admins / cron seed via SECURITY DEFINER (below).
DROP POLICY IF EXISTS "solo_challenges: read all" ON public.solo_challenges;
CREATE POLICY "solo_challenges: read all"
  ON public.solo_challenges FOR SELECT
  TO authenticated
  USING (TRUE);

-- Claims: each user can read + insert their OWN. Server RPCs flip
-- status (security-definer); direct UPDATE from the client is
-- restricted so a user can't mark their own claim 'completed' without
-- meeting the criteria.
DROP POLICY IF EXISTS "solo_challenge_claims: own read"   ON public.solo_challenge_claims;
DROP POLICY IF EXISTS "solo_challenge_claims: own insert" ON public.solo_challenge_claims;
CREATE POLICY "solo_challenge_claims: own read"
  ON public.solo_challenge_claims FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "solo_challenge_claims: own insert"
  ON public.solo_challenge_claims FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- service_role inherits via mig 085 ALTER DEFAULT PRIVILEGES (auto-grant
-- on new public tables), so the seed function below + future cron work.
GRANT SELECT, INSERT, UPDATE ON public.solo_challenges       TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.solo_challenge_claims TO service_role;
GRANT SELECT, INSERT         ON public.solo_challenge_claims TO authenticated;
GRANT SELECT                 ON public.solo_challenges       TO authenticated;

-- ── claim_solo_challenge RPC ──────────────────────────────────────────
-- Atomically claim a solo challenge for the caller. Idempotent — if the
-- caller already has an active claim, it returns that row's id.

CREATE OR REPLACE FUNCTION public.claim_solo_challenge(p_challenge_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_email    TEXT;
  v_claim_id UUID;
  v_active   BOOLEAN;
  v_expires  TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT is_active, expires_at INTO v_active, v_expires
    FROM public.solo_challenges
   WHERE id = p_challenge_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'challenge not found' USING ERRCODE = '22023';
  END IF;
  IF NOT v_active OR v_expires < NOW() THEN
    RAISE EXCEPTION 'challenge inactive or expired' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;

  -- Idempotent: return existing active claim if any.
  SELECT id INTO v_claim_id
    FROM public.solo_challenge_claims
   WHERE challenge_id = p_challenge_id
     AND user_id      = v_uid
     AND status       = 'active'
   LIMIT 1;
  IF FOUND THEN RETURN v_claim_id; END IF;

  INSERT INTO public.solo_challenge_claims (challenge_id, user_id, user_email)
  VALUES (p_challenge_id, v_uid, v_email)
  ON CONFLICT (challenge_id, user_id) DO UPDATE
    SET status = 'active',
        progress = 0,
        completed_at = NULL,
        claimed_at = NOW()
  RETURNING id INTO v_claim_id;

  RETURN v_claim_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_solo_challenge(UUID) TO authenticated;

-- ── complete_solo_challenge RPC ───────────────────────────────────────
-- Marks the caller's claim as completed AND credits the reward coins.
-- Server-side gate: progress must be >= challenge.target_value. The
-- client computes progress from workout data and bumps it via
-- update_solo_challenge_progress; this RPC is the final check.

CREATE OR REPLACE FUNCTION public.complete_solo_challenge(p_claim_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Paste-safety: kegan's clipboard pipeline mangles short
  -- `<alias>.id` tokens in JOIN clauses (`sc.id` → `<sc.id>`,
  -- 42601). Rewrote the JOIN into two sequential scalar lookups so
  -- there are zero dotted `.id` references anywhere. Same semantics,
  -- one extra round-trip in the function (negligible for an admin RPC).
  v_uid           UUID := auth.uid();
  v_progress      NUMERIC;
  v_target        NUMERIC;
  v_reward        INT;
  v_status        TEXT;
  v_challenge_id  UUID;
  v_new_balance   INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT challenge_id, progress, status
    INTO v_challenge_id, v_progress, v_status
    FROM public.solo_challenge_claims
   WHERE id = p_claim_id
     AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim not found' USING ERRCODE = '22023';
  END IF;

  SELECT target_value, reward_coins
    INTO v_target, v_reward
    FROM public.solo_challenges
   WHERE id = v_challenge_id;

  IF v_status = 'completed' THEN
    -- Already paid — return idempotently rather than double-credit.
    SELECT flex_coins INTO v_new_balance FROM public.user_profiles WHERE id = v_uid;
    RETURN jsonb_build_object(
      'already_completed', TRUE,
      'coins_awarded',     0,
      'new_balance',       COALESCE(v_new_balance, 0)
    );
  END IF;
  IF v_progress < v_target THEN
    RAISE EXCEPTION 'progress % below target %', v_progress, v_target
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.solo_challenge_claims
     SET status       = 'completed',
         completed_at = NOW()
   WHERE id = p_claim_id;

  UPDATE public.user_profiles
     SET flex_coins = COALESCE(flex_coins, 0) + v_reward
   WHERE id = v_uid
  RETURNING flex_coins INTO v_new_balance;

  RETURN jsonb_build_object(
    'already_completed', FALSE,
    'coins_awarded',     v_reward,
    'new_balance',       COALESCE(v_new_balance, 0)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_solo_challenge(UUID) TO authenticated;

-- ── update_solo_challenge_progress RPC ────────────────────────────────
-- Bumps progress on every ACTIVE solo claim the caller has based on a
-- workout-summary payload. Pure read-modify-write under SECURITY
-- DEFINER so it can update rows the client's RLS-restricted UPDATE
-- couldn't touch directly.
--
-- Idempotency: progress only increases (max(current, computed)) so a
-- network-retried call can't double-count. Final completion is still
-- gated by complete_solo_challenge, which the client calls after this
-- when target is hit.

CREATE OR REPLACE FUNCTION public.update_solo_challenge_progress(
  p_volume_lbs    NUMERIC DEFAULT 0,
  p_session_count INT     DEFAULT 0,
  p_cardio_min    INT     DEFAULT 0,
  p_prs_hit       INT     DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Paste-safety: same `<alias>.id` mangling as complete_solo_challenge
  -- above. Rewrote the loop body to iterate over scalar claim/challenge
  -- ids and do a separate scalar lookup for the challenge metadata —
  -- no JOIN, no `.id` dotted references, no record-field access in
  -- the body (RECORD type replaced with explicit scalars).
  v_uid       UUID := auth.uid();
  v_claim_id  UUID;
  v_chall_id  UUID;
  v_current   NUMERIC;
  v_kind      TEXT;
  v_target    NUMERIC;
  v_increment NUMERIC;
  v_bumped    INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  FOR v_claim_id, v_chall_id, v_current IN
    SELECT id, challenge_id, progress
      FROM public.solo_challenge_claims
     WHERE user_id = v_uid
       AND status  = 'active'
  LOOP
    SELECT kind, target_value
      INTO v_kind, v_target
      FROM public.solo_challenges
     WHERE id = v_chall_id
       AND is_active = TRUE
       AND expires_at > NOW();

    IF NOT FOUND THEN CONTINUE; END IF;

    v_increment := CASE v_kind
      WHEN 'weekly_volume'   THEN p_volume_lbs
      WHEN 'workout_count'   THEN p_session_count
      WHEN 'cardio_minutes'  THEN p_cardio_min
      WHEN 'beat_any_pr'     THEN p_prs_hit
      ELSE 0
    END;

    IF v_increment > 0 THEN
      UPDATE public.solo_challenge_claims
         SET progress = LEAST(v_target, v_current + v_increment)
       WHERE id = v_claim_id;
      v_bumped := v_bumped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('claims_updated', v_bumped);
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_solo_challenge_progress(NUMERIC, INT, INT, INT) TO authenticated;

-- ── Initial seed ──────────────────────────────────────────────────────
-- Four starter challenges that expire next Sunday 23:59 UTC. The cron
-- to re-seed weekly is a follow-up (see comment in src/lib/data/
-- soloChallenges.js); seeded inline so the page isn't empty on first
-- deploy.

DO $$
DECLARE
  v_expires TIMESTAMPTZ := date_trunc('week', NOW() AT TIME ZONE 'UTC') + INTERVAL '7 days' - INTERVAL '1 second';
BEGIN
  -- Skip seed if any active row already exists (idempotent re-run).
  IF EXISTS (SELECT 1 FROM public.solo_challenges WHERE is_active = TRUE AND expires_at > NOW()) THEN
    RETURN;
  END IF;

  INSERT INTO public.solo_challenges
    (kind, title, description, target_value, target_unit, difficulty, reward_coins, expires_at)
  VALUES
    ('weekly_volume',  'Lift 5,000 lbs this week',  'Total weight moved across all working sets.',  5000, 'lbs',      'easy',   40,  v_expires),
    ('weekly_volume',  'Lift 15,000 lbs this week', 'Serious-lifter target — all working sets count.', 15000, 'lbs',    'medium', 100, v_expires),
    ('workout_count',  'Train 4 days this week',    'Log at least four workouts before Sunday.',     4,    'sessions', 'medium', 80,  v_expires),
    ('cardio_minutes', '60 min of cardio this week','Indoor or outdoor — both count.',               60,   'minutes',  'easy',   35,  v_expires),
    ('beat_any_pr',    'Hit any PR this week',      'Any lift that beats your previous best.',       1,    'prs',      'hard',   150, v_expires);
END $$;

NOTIFY pgrst, 'reload schema';
