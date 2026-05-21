-- 068_atomic_claims.sql
--
-- Closes two CRITICAL economic-integrity bugs surfaced by the
-- marketplace audit:
--
--   1. DAILY CHEST DOUBLE-CLAIM. MarketplaceFeed gates the daily chest
--      on a localStorage flag — clear localStorage / use a fresh
--      browser / use incognito → claim again. Each claim grants
--      coins + a capsule, so the surface is a straight coin minter.
--
--   2. QUEST CLAIM RACE. claimQuest() in src/lib/data/quests.js reads
--      flex_coins, computes newBalance, then does Promise.all([
--        UPDATE flex_coins,
--        UPDATE claimed_at
--      ]). Two parallel calls (rapid double-tap, network retry, two
--      tabs) both pass the claimed_at IS NULL check, both compute the
--      same newBalance, both write — last write wins. Any coin grants
--      that landed BETWEEN the read and the write (e.g. a marketplace
--      purchase credit) are silently overwritten and the user loses
--      those coins. Worse: a single tap also races against any other
--      concurrent flex_coins update on the same user.
--
-- Both fixes are server-side atomic RPCs that the client calls
-- instead of the existing read-modify-write paths.

-- ── New column for daily chest cooldown ─────────────────────────────────
-- Stored as TIMESTAMPTZ so we can compare against an exact 24h window
-- via the user's local timezone (their profile already has
-- timezone_offset_minutes from migration 035). For now we gate on
-- UTC calendar date — simpler, no offset arithmetic at claim time,
-- and the "calendar day" notion is consistent with the daily quest
-- reset cadence elsewhere in the app.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS last_daily_chest_at TIMESTAMPTZ;

-- ── claim_daily_chest RPC ───────────────────────────────────────────────
-- Atomically: check the user hasn't claimed today (UTC), mark them as
-- claimed, return the granted amount. Multiple calls in the same UTC
-- day return { already_claimed: true } without crediting.
--
-- Grant payload matches what the previous client-side code awarded:
--   • 50 flex_coins (base)
--   • 25 flex_coins (bonus, was the second client-side credit)
--   • 1 standard capsule
--
-- We do the entire grant inside the function so a partial failure
-- (e.g. capsule insert succeeds but coin update fails) rolls back as
-- one transaction. Returns the new coin balance so the client can
-- update its cache without a refetch.

CREATE OR REPLACE FUNCTION public.claim_daily_chest()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              UUID := auth.uid();
  v_email            TEXT;
  v_today_utc        DATE := (now() AT TIME ZONE 'UTC')::DATE;
  v_last_utc         DATE;
  v_new_balance      INT;
  v_coins_awarded    INT := 75;  -- 50 base + 25 bonus
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Atomic claim: only update if today's chest hasn't been claimed.
  -- The WHERE clause is the lock — only one of N concurrent callers
  -- can satisfy it on the same row, others get 0 rows updated.
  UPDATE public.user_profiles
     SET last_daily_chest_at = now(),
         flex_coins          = COALESCE(flex_coins, 0) + v_coins_awarded
   WHERE id = v_uid
     AND (last_daily_chest_at IS NULL
          OR (last_daily_chest_at AT TIME ZONE 'UTC')::DATE < v_today_utc)
  RETURNING flex_coins, email INTO v_new_balance, v_email;

  IF v_new_balance IS NULL THEN
    -- The WHERE clause failed → today's chest is already claimed.
    -- Return current balance so the caller can sync state without
    -- raising an error (this isn't a failure, it's "you already did
    -- this today").
    SELECT flex_coins INTO v_new_balance
      FROM public.user_profiles
     WHERE id = v_uid;
    RETURN jsonb_build_object(
      'already_claimed', TRUE,
      'coins_awarded',   0,
      'new_balance',     COALESCE(v_new_balance, 0)
    );
  END IF;

  -- Grant the capsule. We're inside the claim's transaction; if this
  -- fails, the coin credit and last_daily_chest_at write also roll back.
  INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
  VALUES (v_uid, v_email, 'standard');

  RETURN jsonb_build_object(
    'already_claimed', FALSE,
    'coins_awarded',   v_coins_awarded,
    'capsule_type',    'standard',
    'new_balance',     v_new_balance
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_daily_chest() TO authenticated;

-- ── claim_quest_atomic RPC ──────────────────────────────────────────────
-- Replaces the read-modify-write claimQuest in src/lib/data/quests.js.
-- Atomically:
--   1. UPDATE user_daily_quests SET claimed_at = now()
--      WHERE id = $1 AND user_id = auth.uid()
--        AND completed_at IS NOT NULL AND claimed_at IS NULL
--      RETURNING coin_reward
--   2. If a row was returned, credit flex_coins via
--      `UPDATE ... SET flex_coins = COALESCE(flex_coins,0) + reward`
--      (race-safe because the WHERE pins to the user row).
--   3. Return the new balance + reward.
--
-- Concurrent double-tap: the WHERE clause's `claimed_at IS NULL` only
-- matches once — the second caller sees 0 rows updated and bails with
-- `already_claimed`. Concurrent coin grants from other paths (login
-- streak, marketplace credit, etc.) don't fight us because we use
-- delta-arithmetic on flex_coins, not absolute writes.

CREATE OR REPLACE FUNCTION public.claim_quest_atomic(p_quest_row_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_reward       INT;
  v_new_balance  INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_quest_row_id IS NULL THEN
    RAISE EXCEPTION 'quest_row_id required' USING ERRCODE = '22023';
  END IF;

  -- Atomic claim: only one caller wins the claimed_at flip.
  UPDATE public.user_daily_quests
     SET claimed_at = now()
   WHERE id           = p_quest_row_id
     AND user_id      = v_uid
     AND completed_at IS NOT NULL
     AND claimed_at   IS NULL
  RETURNING coin_reward INTO v_reward;

  IF v_reward IS NULL THEN
    -- Either the row doesn't exist for this user, isn't completed,
    -- or was already claimed. Return current balance so the caller
    -- can sync. The client treats this as a no-op success rather
    -- than an error, matching the original idempotent semantics.
    SELECT flex_coins INTO v_new_balance
      FROM public.user_profiles
     WHERE id = v_uid;
    RETURN jsonb_build_object(
      'success',         FALSE,
      'already_claimed', TRUE,
      'coins_awarded',   0,
      'new_balance',     COALESCE(v_new_balance, 0)
    );
  END IF;

  -- Credit coins via delta arithmetic — race-safe even if another
  -- coin-granting path runs concurrently on the same user row.
  UPDATE public.user_profiles
     SET flex_coins = COALESCE(flex_coins, 0) + v_reward
   WHERE id = v_uid
  RETURNING flex_coins INTO v_new_balance;

  RETURN jsonb_build_object(
    'success',         TRUE,
    'already_claimed', FALSE,
    'coins_awarded',   v_reward,
    'new_balance',     v_new_balance
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_quest_atomic(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
