-- 108_pymk_auth_gate.sql
--
-- Fix a privacy leak in get_people_you_may_know (mig 103_hub_social_features).
--
-- The original function is SECURITY DEFINER and accepts an arbitrary
-- p_email parameter. There is no check that p_email belongs to the
-- caller — so any authenticated user can call
-- `rpc('get_people_you_may_know', { p_email: 'victim@example.com' })`
-- and learn who shares mutual followers with the victim.
--
-- The client (PeopleYouMayKnow.jsx) always passes user.email, so the
-- legitimate use case is unchanged by this fix. But the function as
-- written is a probe vector for harvesting social-graph information
-- about any account the attacker knows the email of.
--
-- Fix: resolve the caller's email server-side from auth.uid() and
-- require p_email to match. If they don't match (or auth.uid() is
-- null), raise 42501. Same behavior pattern as the other SECURITY
-- DEFINER RPCs in this codebase (claim_referral, get_my_referral_code,
-- get_friend_leaderboard, etc.).
--
-- We keep the p_email parameter for backward compatibility with the
-- existing client call sites rather than dropping it — the gate is
-- the protection, not the parameter shape.

CREATE OR REPLACE FUNCTION public.get_people_you_may_know(
  p_email  TEXT,
  p_limit  INT DEFAULT 8
)
RETURNS TABLE (
  email        TEXT,
  mutual_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $pymk$
DECLARE
  v_uid           UUID := auth.uid();
  v_caller_email  TEXT;
  v_limit         INT  := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 50);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Resolve the caller's canonical email from their auth row.
  -- Any p_email that doesn't match this is rejected — clients should
  -- pass their own email, and the SECURITY DEFINER posture makes
  -- relying on a client-supplied value unsafe.
  SELECT email INTO v_caller_email
    FROM public.user_profiles
   WHERE id = v_uid;

  IF v_caller_email IS NULL THEN
    -- No profile row for this user yet (signup race) — return empty
    -- rather than erroring; the UI gracefully falls back.
    RETURN;
  END IF;

  IF p_email IS NULL OR lower(p_email) <> lower(v_caller_email) THEN
    RAISE EXCEPTION 'p_email must match the caller'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH
    i_follow AS (
      SELECT followee_email AS fe
        FROM public.hub_follows
       WHERE follower_email = v_caller_email
    ),
    follow_me AS (
      SELECT follower_email AS fe
        FROM public.hub_follows
       WHERE followee_email = v_caller_email
    ),
    candidates AS (
      SELECT hf.followee_email AS candidate_email,
             COUNT(*)          AS mutual_count
        FROM public.hub_follows hf
        JOIN follow_me fm ON fm.fe = hf.follower_email
       WHERE hf.followee_email <> v_caller_email
         AND hf.followee_email NOT IN (SELECT fe FROM i_follow)
       GROUP BY hf.followee_email
    )
  SELECT c.candidate_email, c.mutual_count
    FROM candidates c
   ORDER BY c.mutual_count DESC
   LIMIT v_limit;
END;
$pymk$;

REVOKE ALL ON FUNCTION public.get_people_you_may_know(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_people_you_may_know(TEXT, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
