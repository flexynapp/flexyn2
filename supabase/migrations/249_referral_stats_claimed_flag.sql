-- 249_referral_stats_claimed_flag.sql
--
-- Adds `has_claimed` + `claimed_code` to my_referral_stats().
--
-- WHY
-- ───
-- The profile's Invite Friends sheet now lets a user type in a friend's
-- invite code (the claim_referral RPC from migration 089 previously only
-- ever fired automatically from a ?ref= link at signup). But the client had
-- no way to know whether the viewer had ALREADY claimed one, so the field
-- rendered enabled for everybody and a user who'd already redeemed found
-- out only by submitting and getting an 'already_claimed' rejection back.
--
-- referrals_one_per_referee (migration 089) already guarantees at most one
-- row per referee, so this is a single-row lookup, and the RLS SELECT policy
-- on public.referrals already covers "referee_id = auth.uid()" — this just
-- surfaces it in the same payload the card is already fetching, rather than
-- making the client run a second query.
--
-- Additive only: the three existing keys keep their names and types, so a
-- client built before this migration keeps working unchanged.

CREATE OR REPLACE FUNCTION public.my_referral_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_code         TEXT;
  v_count        INT;
  v_claimed_code TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT referral_code INTO v_code
    FROM public.user_profiles WHERE id = v_uid;

  SELECT COUNT(*) INTO v_count
    FROM public.referrals WHERE referrer_id = v_uid;

  -- At most one row: referrals_one_per_referee is UNIQUE (referee_id).
  SELECT code INTO v_claimed_code
    FROM public.referrals WHERE referee_id = v_uid;

  RETURN jsonb_build_object(
    'code',                v_code,
    'total_referrals',     v_count,
    'total_coins_earned',  v_count * 200,
    'has_claimed',         v_claimed_code IS NOT NULL,
    'claimed_code',        v_claimed_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.my_referral_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_referral_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_referral_stats() TO authenticated;

NOTIFY pgrst, 'reload schema';
