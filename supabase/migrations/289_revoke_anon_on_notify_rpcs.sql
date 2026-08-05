-- Migration 289: close two notify_X_for RPCs to `anon`
--
-- Caught by get_advisors immediately after 288, which is the reason
-- CLAUDE.md says to run it after touching any SECURITY DEFINER function.
-- 12 of the 14 notify_X_for RPCs are closed to anon. Two were not:
--
--   notify_friend_post_for(uuid, uuid)     — introduced by mig 288
--   notify_gym_rival_assigned_for(uuid)    — pre-existing
--
-- Neither is exploitable: both raise 'unauthenticated' when auth.uid() is
-- NULL, which is every anon caller. This closes the endpoint rather than
-- relying on that check, and puts them back in line with the other twelve.
--
-- THE TRAP WORTH REMEMBERING: `CREATE OR REPLACE FUNCTION` on an existing
-- function PRESERVES its grants — which is why notify_friend_follow_for
-- and notify_league_resolution_for came out of 288 still closed to anon.
-- But changing a function's SIGNATURE creates a NEW function, and a new
-- function is EXECUTE-able by PUBLIC (which includes anon) until it is
-- revoked. 288 changed notify_friend_post_for from three text params to a
-- post id and granted only `authenticated`, so the default PUBLIC grant
-- stayed and quietly re-opened it. An explicit GRANT to authenticated does
-- not displace the default grant to PUBLIC; you have to REVOKE.
--
-- Idempotent: REVOKE on an already-revoked privilege is a no-op.

REVOKE EXECUTE ON FUNCTION public.notify_friend_post_for(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_friend_post_for(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.notify_friend_post_for(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.notify_gym_rival_assigned_for(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_gym_rival_assigned_for(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.notify_gym_rival_assigned_for(uuid) TO authenticated;
