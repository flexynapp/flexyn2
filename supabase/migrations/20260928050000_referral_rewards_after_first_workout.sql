-- Reward economy audit, part two (2026-09-28): invite rewards pay out
-- once the new person has actually trained, not when a code is typed.
--
-- Reproduced on production in a rolled-back transaction: three throwaway
-- guest accounts each redeemed one person's code and that person received
-- 600 coins and three Elite capsules. Guests cost nothing to create, so a
-- single account could collect 5,000 coins and 25 Elite capsules, and each
-- guest's own 200 coins could be gifted back on top.
--
-- Kegan chose (2026-09-28): the code is recorded straight away, and BOTH
-- people are paid once the new person has saved a first workout on a real
-- (non-guest) account. That can happen in either order, so the payout is
-- checked from three places: the claim itself, every workout insert, and a
-- guest linking a real sign-in.
--
-- The referrer's 25-reward cap now counts PAID referrals, so pending codes
-- from alts that never qualify cannot use up a real person's slots.
--
-- production held zero referral rows when this was written, so there is
-- nothing to backfill.

ALTER TABLE public.referrals
  ADD COLUMN IF NOT EXISTS rewarded_at timestamptz;

COMMENT ON COLUMN public.referrals.rewarded_at IS
  'When both sides were paid. NULL while the referee has not yet saved a '
  'workout on a non-guest account. Written only by pay_referral_if_qualified().';

-- ---------------------------------------------------------------------
-- The payout. Internal: takes the referee as a parameter.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pay_referral_if_qualified(p_referee uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  c_cap CONSTANT int := 25;
  v_ref       public.referrals%ROWTYPE;
  v_paid      int;
  v_referee_email  text; v_referee_username  text;
  v_referrer_email text; v_referrer_username text;
BEGIN
  IF p_referee IS NULL THEN RETURN FALSE; END IF;

  SELECT * INTO v_ref FROM public.referrals
   WHERE referee_id = p_referee AND rewarded_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  -- A real account.
  IF NOT EXISTS (SELECT 1 FROM auth.users
                  WHERE id = p_referee AND NOT COALESCE(is_anonymous, FALSE)) THEN
    RETURN FALSE;
  END IF;

  -- A saved workout the plausibility check did not flag.
  IF NOT EXISTS (SELECT 1 FROM public.workout_logs
                  WHERE user_id = p_referee AND NOT COALESCE(implausible, FALSE)) THEN
    RETURN FALSE;
  END IF;

  UPDATE public.referrals SET rewarded_at = now() WHERE id = v_ref.id;

  SELECT email, username INTO v_referee_email, v_referee_username
    FROM public.user_profiles WHERE id = p_referee;
  SELECT email, username INTO v_referrer_email, v_referrer_username
    FROM public.user_profiles WHERE id = v_ref.referrer_id;

  UPDATE public.user_profiles SET flex_coins = COALESCE(flex_coins, 0) + 200
   WHERE id = p_referee;
  INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
  VALUES (p_referee, v_referee_email, 'elite');
  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (p_referee, v_referee_email, 'referral_success',
          'Invite reward unlocked',
          '+200 coins and an Elite capsule for joining via '
            || COALESCE(v_referrer_username, 'a friend') || '''s code.',
          '🎁', '/dashboard',
          jsonb_build_object('referrer_id', v_ref.referrer_id, 'code', v_ref.code, 'reward_coins', 200));

  SELECT count(*) INTO v_paid FROM public.referrals
   WHERE referrer_id = v_ref.referrer_id AND rewarded_at IS NOT NULL AND id <> v_ref.id;

  IF v_paid < c_cap THEN
    UPDATE public.user_profiles SET flex_coins = COALESCE(flex_coins, 0) + 200
     WHERE id = v_ref.referrer_id;
    INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
    VALUES (v_ref.referrer_id, v_referrer_email, 'elite');
    INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES (v_ref.referrer_id, v_referrer_email, 'referral_success',
            COALESCE(v_referee_username, 'A friend') || ' finished their first workout',
            '+200 coins and an Elite capsule for inviting them.', '🎁', '/hub',
            jsonb_build_object('referee_id', p_referee, 'code', v_ref.code, 'reward_coins', 200));
  END IF;

  RETURN TRUE;
END;
$function$;

REVOKE ALL ON FUNCTION public.pay_referral_if_qualified(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- The claim records the code and pays only if the caller already
-- qualifies (a real account that has trained).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_referral(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_code TEXT := upper(trim(COALESCE(p_code, '')));
  v_referrer UUID;
  v_referrer_username TEXT;
  v_paid BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF v_code = '' OR length(v_code) <> 6 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code'); END IF;
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referee_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed'); END IF;
  SELECT id, username INTO v_referrer, v_referrer_username
    FROM public.user_profiles WHERE referral_code = v_code;
  IF v_referrer IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'code_not_found'); END IF;
  IF v_referrer = v_uid THEN RETURN jsonb_build_object('ok', false, 'reason', 'self_referral'); END IF;

  BEGIN
    INSERT INTO public.referrals (referrer_id, referee_id, code)
    VALUES (v_referrer, v_uid, v_code);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed');
  END;

  v_paid := public.pay_referral_if_qualified(v_uid);

  RETURN jsonb_build_object('ok', true, 'referrer_id', v_referrer,
    'referrer_name', v_referrer_username, 'reward_coins', 200, 'reward_capsule', 'elite',
    'rewarded', v_paid, 'pending', NOT v_paid);
END;
$function$;

-- ---------------------------------------------------------------------
-- Stats count only paid referrals as earnings.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_referral_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          UUID := auth.uid();
  v_code         TEXT;
  v_count        INT;
  v_paid         INT;
  v_claimed_code TEXT;
  v_claim_paid   BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT referral_code INTO v_code FROM public.user_profiles WHERE id = v_uid;

  SELECT count(*), count(*) FILTER (WHERE rewarded_at IS NOT NULL)
    INTO v_count, v_paid
    FROM public.referrals WHERE referrer_id = v_uid;

  SELECT code, rewarded_at IS NOT NULL INTO v_claimed_code, v_claim_paid
    FROM public.referrals WHERE referee_id = v_uid;

  RETURN jsonb_build_object(
    'code',                v_code,
    'total_referrals',     v_count,
    'rewarded_referrals',  v_paid,
    'pending_referrals',   v_count - v_paid,
    'total_coins_earned',  LEAST(v_paid, 25) * 200,
    'has_claimed',         v_claimed_code IS NOT NULL,
    'claimed_code',        v_claimed_code,
    'claim_rewarded',      COALESCE(v_claim_paid, FALSE)
  );
END;
$function$;

-- ---------------------------------------------------------------------
-- The two later moments a referee can qualify.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.referral_on_workout_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NEW.user_id IS NOT NULL AND NOT COALESCE(NEW.implausible, FALSE)
     AND EXISTS (SELECT 1 FROM public.referrals
                  WHERE referee_id = NEW.user_id AND rewarded_at IS NULL) THEN
    PERFORM public.pay_referral_if_qualified(NEW.user_id);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- An invite reward is never worth losing a workout over.
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.referral_on_workout_log() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS referral_on_workout_log ON public.workout_logs;
CREATE TRIGGER referral_on_workout_log
  AFTER INSERT ON public.workout_logs
  FOR EACH ROW EXECUTE FUNCTION public.referral_on_workout_log();

CREATE OR REPLACE FUNCTION public.referral_on_account_linked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF COALESCE(OLD.is_anonymous, FALSE) AND NOT COALESCE(NEW.is_anonymous, FALSE) THEN
    PERFORM public.pay_referral_if_qualified(NEW.id);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Never block a sign-in over a reward.
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.referral_on_account_linked() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS referral_on_account_linked ON auth.users;
CREATE TRIGGER referral_on_account_linked
  AFTER UPDATE OF is_anonymous ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.referral_on_account_linked();

-- ---------------------------------------------------------------------
-- Probe, rolled back. P0003 is the success signal.
-- ---------------------------------------------------------------------
DO $probe$
DECLARE
  r     uuid := gen_random_uuid();
  g     uuid;
  code  text := upper(substr(md5(gen_random_uuid()::text), 1, 6));
  res   jsonb;
  coins int;
  caps  int;
  i     int;
BEGIN
  INSERT INTO auth.users (id, email, aud, role, is_anonymous)
  VALUES (r, 'ref-probe-' || r || '@example.invalid', 'authenticated', 'authenticated', FALSE);
  INSERT INTO public.user_profiles (id, email) VALUES (r, 'ref-probe-' || r || '@example.invalid')
  ON CONFLICT (id) DO NOTHING;
  UPDATE public.user_profiles SET referral_code = code, flex_coins = 0 WHERE id = r;

  -- Three guests redeem and even log a workout: nobody is paid.
  FOR i IN 1..3 LOOP
    g := gen_random_uuid();
    INSERT INTO auth.users (id, aud, role, is_anonymous) VALUES (g, 'authenticated', 'authenticated', TRUE);
    INSERT INTO public.user_profiles (id, email) VALUES (g, 'guest_' || g || '@flexyn.guest')
    ON CONFLICT (id) DO NOTHING;
    UPDATE public.user_profiles SET flex_coins = 0 WHERE id = g;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', g, 'role', 'authenticated', 'is_anonymous', TRUE)::text, TRUE);
    SET LOCAL ROLE authenticated;
    res := public.claim_referral(code);
    IF NOT (res->>'ok')::boolean OR (res->>'rewarded')::boolean THEN
      RAISE EXCEPTION 'probe: guest claim returned %', res;
    END IF;
    INSERT INTO public.workout_logs (user_id, created_by, "date", exercises)
    VALUES (g, 'guest_' || g || '@flexyn.guest', current_date,
            '[{"name":"Bench Press","sets":[{"weight":100,"reps":10}]}]'::jsonb);
    RESET ROLE;
  END LOOP;

  SELECT flex_coins INTO coins FROM public.user_profiles WHERE id = r;
  SELECT count(*) INTO caps FROM public.user_capsules WHERE user_id = r;
  IF coins <> 0 OR caps <> 0 THEN
    RAISE EXCEPTION 'probe: guests paid the referrer % coins, % capsules', coins, caps;
  END IF;

  -- The last guest links a real sign-in: both sides are paid once.
  UPDATE auth.users SET is_anonymous = FALSE, email = 'linked-' || g || '@example.invalid' WHERE id = g;
  SELECT flex_coins INTO coins FROM public.user_profiles WHERE id = r;
  SELECT count(*) INTO caps FROM public.user_capsules WHERE user_id = r AND capsule_type = 'elite';
  IF coins <> 200 OR caps <> 1 THEN
    RAISE EXCEPTION 'probe: referrer after link has % coins, % capsules', coins, caps;
  END IF;
  SELECT flex_coins INTO coins FROM public.user_profiles WHERE id = g;
  IF coins <> 200 THEN RAISE EXCEPTION 'probe: referee got % coins', coins; END IF;

  -- A second workout pays nothing more.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', g, 'role', 'authenticated')::text, TRUE);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.workout_logs (user_id, created_by, "date", exercises)
  VALUES (g, 'guest_' || g || '@flexyn.guest', current_date,
          '[{"name":"Squat","sets":[{"weight":100,"reps":5}]}]'::jsonb);
  -- And the payout cannot be called directly.
  BEGIN
    PERFORM public.pay_referral_if_qualified(g);
    RAISE EXCEPTION 'probe: pay_referral_if_qualified is callable by clients';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  SELECT flex_coins INTO coins FROM public.user_profiles WHERE id = r;
  IF coins <> 200 THEN RAISE EXCEPTION 'probe: referrer paid twice (% coins)', coins; END IF;

  RAISE EXCEPTION USING ERRCODE = 'P0003', MESSAGE = 'probe ok';
EXCEPTION WHEN SQLSTATE 'P0003' THEN
  RAISE NOTICE 'referral payout probe passed';
END
$probe$;
