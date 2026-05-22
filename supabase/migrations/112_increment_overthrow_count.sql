-- 112_increment_overthrow_count.sql
--
-- Audit finding: the performOverthrow flow in src/lib/data/nemesis.js
-- has been silently failing to increment user_profiles.overthrow_count
-- since the feature shipped (mig 056). The client calls
-- `supabase.rpc('increment_overthrow_count', { p_user_id })` with a
-- .catch(() => {}) fallback "if RPC not deployed yet" — but that RPC
-- was NEVER deployed. The .catch swallows the 42883 ("function does
-- not exist") on every call.
--
-- Net effect: every user's overthrow_count has been 0 since launch,
-- regardless of how many nemeses they've actually overthrown. The
-- achievement system, UI displays, and any read on this column see
-- bad data.
--
-- This migration defines the function the client has been calling
-- the whole time. CREATE OR REPLACE makes it safe to re-run; same
-- shape pattern as increment_flex_coins (mig 030) — SECURITY
-- DEFINER, set search_path = public, accept a target user_id,
-- atomic UPDATE with GREATEST(0, ...) clamp to defend against any
-- accidental negative deltas in the future.
--
-- Restricted to authenticated users; the function gates internally
-- on matching user_id so a malicious client can't bump someone
-- else's counter.

CREATE OR REPLACE FUNCTION public.increment_overthrow_count(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $increment_overthrow_count$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_user_id <> v_uid THEN
    -- Only the user themselves can bump their own counter.
    RAISE EXCEPTION 'can only increment your own count' USING ERRCODE = '42501';
  END IF;
  UPDATE public.user_profiles
     SET overthrow_count = GREATEST(0, COALESCE(overthrow_count, 0) + 1)
   WHERE id = p_user_id;
END;
$increment_overthrow_count$;

REVOKE ALL ON FUNCTION public.increment_overthrow_count(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_overthrow_count(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
