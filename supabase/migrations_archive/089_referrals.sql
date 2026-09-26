-- 089_referrals.sql
--
-- Invite-a-friend referral system. Every user has a unique 6-char
-- referral code that goes into their share URL: flexyn.app/?ref=ABC123.
-- When a brand-new account signs up via that link, both parties get
-- 200 coins + 1 Elite capsule.
--
-- DESIGN PILLARS
-- ──────────────
--   1. Codes are short + collision-free. 6 chars from a 32-symbol
--      alphabet ([A-Z0-9] minus ambiguous I/O/0/1) → 32^6 = ~1B values.
--      Way more than user count for the foreseeable future.
--   2. One referral per referee. The UNIQUE constraint on referrals
--      .referee_id is the atomic cap. Prevents a single user from
--      claiming multiple codes for stacked rewards.
--   3. Self-referral blocked (referrer != referee).
--   4. Rewards are issued via existing RPCs (increment_flex_coins,
--      user_capsules INSERT). No new reward-emission paths.
--   5. Notifications fire to both parties via the existing 034
--      AFTER INSERT trigger — we just write the notifications row.
--   6. SECURITY DEFINER on the claim RPC: the referee writes a row
--      crediting someone they may not have permission to write for.
--      Server-enforced validation prevents abuse.

-- ── Schema ────────────────────────────────────────────────────────────

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_referral_code
  ON public.user_profiles (referral_code)
  WHERE referral_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.referrals (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referee_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT referrals_no_self CHECK (referrer_id <> referee_id),
  CONSTRAINT referrals_one_per_referee UNIQUE (referee_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer
  ON public.referrals (referrer_id, created_at DESC);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referrals: own as referrer or referee" ON public.referrals;
CREATE POLICY "referrals: own as referrer or referee"
  ON public.referrals FOR SELECT
  USING (referrer_id = auth.uid() OR referee_id = auth.uid());

-- No INSERT/UPDATE/DELETE policy — all writes go through the
-- SECURITY DEFINER claim_referral RPC below. Migration 085 already
-- grants service_role full DML on new RLS tables via ALTER DEFAULT
-- PRIVILEGES, so the RPC can write through.

-- ── Code generator ────────────────────────────────────────────────────
--
-- 6 chars from a 32-symbol alphabet, excluding I/O/0/1 (visually
-- ambiguous). Collision probability at 1M users ≈ (1e6 / 32^6) ≈ 0.1%
-- per insert. We retry on collision in the issuer RPC below.

CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 32 chars, no I/O/0/1
  v_code     TEXT := '';
  v_i        INT;
BEGIN
  FOR v_i IN 1..6 LOOP
    v_code := v_code || substring(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
  END LOOP;
  RETURN v_code;
END;
$$;

-- ── get_my_referral_code() ────────────────────────────────────────────
--
-- Read-or-create. Generates a new code on first call, persists it on
-- user_profiles, returns the (now stable) code on subsequent calls.
-- Retries on collision up to 10 times before giving up.

CREATE OR REPLACE FUNCTION public.get_my_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_existing TEXT;
  v_code     TEXT;
  v_attempts INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Fast path: already issued.
  SELECT referral_code INTO v_existing
    FROM public.user_profiles WHERE id = v_uid;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Issue a new one. Retry on collision (UNIQUE INDEX is the gate).
  LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > 10 THEN
      RAISE EXCEPTION 'could not allocate referral code after 10 attempts'
        USING ERRCODE = '23505';
    END IF;
    v_code := public.generate_referral_code();
    BEGIN
      UPDATE public.user_profiles
         SET referral_code = v_code
       WHERE id = v_uid
         AND referral_code IS NULL;
      IF FOUND THEN
        RETURN v_code;
      ELSE
        -- Concurrent issuer raced us. Re-read and return.
        SELECT referral_code INTO v_existing
          FROM public.user_profiles WHERE id = v_uid;
        IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      -- Code collision with another user. Loop and try again.
      CONTINUE;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_referral_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_referral_code() TO authenticated;

-- ── claim_referral(p_code) ────────────────────────────────────────────
--
-- Called once by a newly-signed-up user with the code they came in
-- on. Validates:
--   • Caller is authenticated.
--   • Caller hasn't claimed before (referrals.referee_id UNIQUE).
--   • Code resolves to a real, different user.
--
-- On success:
--   • Inserts the referrals row.
--   • Grants +200 coins to BOTH parties via increment_flex_coins
--     (the SECURITY DEFINER variant that bypasses RLS).
--   • Grants 1 Elite capsule to BOTH parties.
--   • Inserts notification rows for BOTH (the 034 trigger fans out
--     Web Push).
--
-- Returns a JSONB envelope: { ok, referrer_id?, reward_coins?, reason? }.
-- Never RAISEs on a normal failure (already claimed, code not found,
-- self-referral) — returns a structured error so the client can show a
-- specific toast. Only RAISEs on auth + database errors.

CREATE OR REPLACE FUNCTION public.claim_referral(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_code        TEXT := upper(trim(COALESCE(p_code, '')));
  v_referrer    UUID;
  v_already     INT;
  v_referee_email TEXT;
  v_referrer_email TEXT;
  v_referee_username TEXT;
  v_referrer_username TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF v_code = '' OR length(v_code) <> 6 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;

  -- Already claimed?
  SELECT COUNT(*) INTO v_already
    FROM public.referrals WHERE referee_id = v_uid;
  IF v_already > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed');
  END IF;

  -- Resolve code → referrer.
  SELECT id, email, username
    INTO v_referrer, v_referrer_email, v_referrer_username
    FROM public.user_profiles
   WHERE referral_code = v_code;
  IF v_referrer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'code_not_found');
  END IF;
  IF v_referrer = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'self_referral');
  END IF;

  -- Look up the referee's row for notification metadata.
  SELECT email, username
    INTO v_referee_email, v_referee_username
    FROM public.user_profiles
   WHERE id = v_uid;

  -- Write the audit row. UNIQUE on referee_id is the atomic cap if a
  -- second claim races us — second call falls into the EXCEPTION block
  -- and returns 'already_claimed'.
  BEGIN
    INSERT INTO public.referrals (referrer_id, referee_id, code)
    VALUES (v_referrer, v_uid, v_code);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed');
  END;

  -- Grant coins to BOTH. increment_flex_coins (migration 030) bypasses
  -- RLS via SECURITY DEFINER, so it works for the cross-user grant.
  -- The function operates on auth.uid() so we need a sibling that
  -- takes a target user_id. We fall back to a direct UPDATE if the
  -- multi-user variant doesn't exist — accepting the small read-modify-
  -- write race on referrer's flex_coins, which is bounded to ONE
  -- referral event per (referrer, referee) pair.
  BEGIN
    PERFORM public.grant_flex_coins(v_referrer, 200);
    PERFORM public.grant_flex_coins(v_uid,      200);
  EXCEPTION WHEN undefined_function THEN
    -- Fallback: direct UPDATEs. The audit row above + bounded fan-in
    -- (one row per referee, max 1 race per referrer per claim) keeps
    -- this safe enough.
    UPDATE public.user_profiles
       SET flex_coins = COALESCE(flex_coins, 0) + 200
     WHERE id IN (v_referrer, v_uid);
  END;

  -- Grant 1 Elite capsule to each.
  INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
  VALUES
    (v_referrer, v_referrer_email, 'elite'),
    (v_uid,      v_referee_email,  'elite');

  -- Notifications for both. Type 'referral_success' is unmapped in the
  -- 083 category function → falls through to "always deliver". Fine
  -- for an infrequent, celebratory event.
  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (v_referrer, v_referrer_email, 'referral_success',
     COALESCE(v_referee_username, 'A friend') || ' joined Flexyn via your code',
     '+200 coins and an Elite capsule are yours.',
     '🎁', '/hub',
     jsonb_build_object('referee_id', v_uid, 'code', v_code, 'reward_coins', 200)),
    (v_uid, v_referee_email, 'referral_success',
     'Welcome to Flexyn',
     '+200 coins and an Elite capsule for joining via ' || COALESCE(v_referrer_username, 'a friend') || '''s code.',
     '🎁', '/dashboard',
     jsonb_build_object('referrer_id', v_referrer, 'code', v_code, 'reward_coins', 200));

  RETURN jsonb_build_object(
    'ok',             true,
    'referrer_id',    v_referrer,
    'referrer_name',  v_referrer_username,
    'reward_coins',   200,
    'reward_capsule', 'elite'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_referral(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_referral(TEXT) TO authenticated;

-- ── my_referral_stats() ───────────────────────────────────────────────
-- Returns { code, total_referrals, total_coins_earned } for the
-- caller. Used by the ReferralCard UI.

CREATE OR REPLACE FUNCTION public.my_referral_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_code  TEXT;
  v_count INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT referral_code INTO v_code
    FROM public.user_profiles WHERE id = v_uid;

  SELECT COUNT(*) INTO v_count
    FROM public.referrals WHERE referrer_id = v_uid;

  RETURN jsonb_build_object(
    'code',                v_code,
    'total_referrals',     v_count,
    'total_coins_earned',  v_count * 200
  );
END;
$$;

REVOKE ALL ON FUNCTION public.my_referral_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_referral_stats() TO authenticated;

NOTIFY pgrst, 'reload schema';
