-- 205_referral_cap_and_bounty_escrow.sql
--
-- Closes two coin faucets found in the economy audit. Both features are
-- currently dormant (referrals: 0 rows, user-created bounties: 0), so these
-- change behaviour going forward with no data-migration risk.
--
-- (1) REFERRAL FARMING — claim_referral minted +200 coins AND an Elite
--     capsule to BOTH sides on every claim, with no per-referrer limit. A
--     user with N throwaway signups farmed N × (200 + Elite) on the referrer
--     side. Fix: cap the REFERRER reward at a lifetime maximum
--     (v_referrer_reward_cap). Past the cap the referral still records (stats
--     / relationship intact) but mints nothing more to the referrer. The
--     referee keeps their one-time signup bonus (bounded already by the
--     referrals_one_per_referee UNIQUE constraint). NOTE: a determined
--     multi-account farmer can still net the referee-side 200 via gifting;
--     fully closing that needs signup-level fraud controls (email
--     verification / device signals) which are out of DB scope.
--
-- (2) BOUNTY MINTING — complete_bounty_claim pays the winner `reward`
--     (60/100/175) but create_user_bounty never took those coins from the
--     creator, so the reward was minted from nothing. A user targets a bounty
--     at themselves and a second (colluding) account beats it, netting
--     ~reward - entry_fee per completion. Fix: ESCROW — create_user_bounty
--     now deducts `reward` from the creator up front, so a completion just
--     hands the stake to the winner (net zero) and an expiry refunds it. A
--     sweeper (cron, every 30 min) reopens bounties whose claim lapsed and
--     refunds creators of expired, uncompleted user-created bounties.
--     System-generated bounties (is_user_created = false) are unchanged.

-- ── (1) Referral: per-referrer lifetime reward cap ─────────────────────
CREATE OR REPLACE FUNCTION public.claim_referral(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_code TEXT := upper(trim(COALESCE(p_code, '')));
  v_referrer UUID;
  v_already INT;
  v_ref_count INT;
  v_referrer_reward_cap CONSTANT INT := 25;
  v_referee_email TEXT; v_referrer_email TEXT;
  v_referee_username TEXT; v_referrer_username TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF v_code = '' OR length(v_code) <> 6 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;
  SELECT COUNT(*) INTO v_already FROM public.referrals WHERE referee_id = v_uid;
  IF v_already > 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed'); END IF;
  SELECT id, email, username INTO v_referrer, v_referrer_email, v_referrer_username
    FROM public.user_profiles WHERE referral_code = v_code;
  IF v_referrer IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'code_not_found'); END IF;
  IF v_referrer = v_uid THEN RETURN jsonb_build_object('ok', false, 'reason', 'self_referral'); END IF;
  SELECT email, username INTO v_referee_email, v_referee_username
    FROM public.user_profiles WHERE id = v_uid;

  -- How many rewarded referrals has this referrer already earned?
  SELECT COUNT(*) INTO v_ref_count FROM public.referrals WHERE referrer_id = v_referrer;

  BEGIN
    INSERT INTO public.referrals (referrer_id, referee_id, code)
    VALUES (v_referrer, v_uid, v_code);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed');
  END;

  -- Referee always gets their one-time signup bonus.
  UPDATE public.user_profiles
     SET flex_coins = COALESCE(flex_coins, 0) + 200
   WHERE id = v_uid;
  INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
  VALUES (v_uid, v_referee_email, 'elite');
  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (v_uid, v_referee_email, 'referral_success',
     'Welcome to Flexyn',
     '+200 coins and an Elite capsule for joining via ' || COALESCE(v_referrer_username, 'a friend') || '''s code.',
     '🎁', '/dashboard',
     jsonb_build_object('referrer_id', v_referrer, 'code', v_code, 'reward_coins', 200));

  -- Referrer reward only within the lifetime cap.
  IF v_ref_count < v_referrer_reward_cap THEN
    UPDATE public.user_profiles
       SET flex_coins = COALESCE(flex_coins, 0) + 200
     WHERE id = v_referrer;
    INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
    VALUES (v_referrer, v_referrer_email, 'elite');
    INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES
      (v_referrer, v_referrer_email, 'referral_success',
       COALESCE(v_referee_username, 'A friend') || ' joined Flexyn via your code',
       '+200 coins and an Elite capsule are yours.', '🎁', '/hub',
       jsonb_build_object('referee_id', v_uid, 'code', v_code, 'reward_coins', 200));
  END IF;

  RETURN jsonb_build_object('ok', true, 'referrer_id', v_referrer,
    'referrer_name', v_referrer_username, 'reward_coins', 200, 'reward_capsule', 'elite',
    'referrer_rewarded', (v_ref_count < v_referrer_reward_cap));
END;
$function$;

-- ── (2) Bounty escrow ──────────────────────────────────────────────────
ALTER TABLE public.bounties
  ADD COLUMN IF NOT EXISTS reward_refunded boolean NOT NULL DEFAULT false;

-- create_user_bounty now stakes (escrows) the reward from the creator.
CREATE OR REPLACE FUNCTION public.create_user_bounty(
  p_metric text, p_exercise_name text, p_target_value numeric,
  p_difficulty text, p_expires_at timestamp with time zone)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid(); v_username TEXT; v_avatar TEXT;
  v_entry INT; v_reward INT; v_id UUID; v_coins INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF p_metric NOT IN ('weekly_volume','session_volume','single_lift_weight','single_lift_reps') THEN
    RAISE EXCEPTION 'invalid metric' USING ERRCODE = '22023'; END IF;
  IF p_target_value IS NULL OR p_target_value <= 0 THEN
    RAISE EXCEPTION 'target_value must be positive' USING ERRCODE = '22023'; END IF;
  IF p_difficulty NOT IN ('easy','medium','hard') THEN
    RAISE EXCEPTION 'invalid difficulty' USING ERRCODE = '22023'; END IF;

  v_entry  := CASE p_difficulty WHEN 'easy' THEN 10 WHEN 'medium' THEN 15 ELSE 20 END;
  v_reward := CASE p_difficulty WHEN 'easy' THEN 60 WHEN 'medium' THEN 100 ELSE 175 END;

  SELECT username, avatar_url, flex_coins INTO v_username, v_avatar, v_coins
    FROM public.user_profiles WHERE id = v_uid FOR UPDATE;
  IF COALESCE(v_coins, 0) < v_reward THEN
    RAISE EXCEPTION 'insufficient_coins_to_stake' USING ERRCODE = '22023';
  END IF;

  -- Stake the reward: the winner is paid from this, or it's refunded on expiry.
  UPDATE public.user_profiles SET flex_coins = flex_coins - v_reward WHERE id = v_uid;

  INSERT INTO public.bounties (target_user_id, target_username, target_avatar_url,
    metric, exercise_name, target_value, difficulty, entry_fee, reward,
    is_user_created, expires_at)
  VALUES (v_uid, v_username, v_avatar, p_metric, p_exercise_name, p_target_value,
    p_difficulty, v_entry, v_reward, TRUE, COALESCE(p_expires_at, now() + INTERVAL '48 hours'))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;

-- Sweeper: reopen lapsed claims + refund expired uncompleted user bounties.
CREATE OR REPLACE FUNCTION public.sweep_expired_bounties()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_bid UUID; v_creator UUID; v_reward INT;
BEGIN
  -- (a) mark overdue active claims expired
  UPDATE public.bounty_claims SET status = 'expired'
   WHERE status = 'active' AND deadline < now();

  -- (b) reopen still-live bounties that no longer have an active/completed claim
  UPDATE public.bounties SET claimed_by_id = NULL
   WHERE claimed_by_id IS NOT NULL
     AND expires_at > now()
     AND id NOT IN (
       SELECT bounty_id FROM public.bounty_claims
        WHERE bounty_id IS NOT NULL AND status IN ('active','completed'));

  -- (c) refund creators of expired, uncompleted, user-created bounties
  FOR v_bid, v_creator, v_reward IN
    SELECT id, target_user_id, reward FROM public.bounties
     WHERE is_user_created AND NOT reward_refunded AND expires_at < now()
       AND id NOT IN (
         SELECT bounty_id FROM public.bounty_claims
          WHERE bounty_id IS NOT NULL AND status = 'completed')
     FOR UPDATE
  LOOP
    UPDATE public.user_profiles SET flex_coins = COALESCE(flex_coins, 0) + v_reward
     WHERE id = v_creator;
    UPDATE public.bounties SET reward_refunded = TRUE WHERE id = v_bid;
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.sweep_expired_bounties() FROM PUBLIC;

-- Schedule the sweeper (drop any prior copy by name first, no-op if absent).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sweep-expired-bounties';
SELECT cron.schedule('sweep-expired-bounties', '*/30 * * * *',
  $$SELECT public.sweep_expired_bounties();$$);
