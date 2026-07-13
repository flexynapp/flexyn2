-- 206_public_profile_rpc.sql
--
-- The /@:username public profile page (PublicProfile.jsx) is the ONLY anon
-- reader of the public_profiles view. Because that view is SECURITY DEFINER
-- it bypasses RLS and returns EVERY row — including email — so the anon key
-- (which ships in the client bundle) can bulk-harvest every user's email.
-- The base user_profiles table is safe (RLS = own-row-only); the view is the
-- sole cross-user leak.
--
-- This RPC replaces PublicProfile's view read: it returns the public display
-- columns for a single username, and exposes email ONLY to authenticated
-- callers (one row at a time — no bulk enumeration). With PublicProfile moved
-- onto this RPC, anon SELECT on the view can be revoked (migration 207) to
-- close anonymous harvesting entirely. The authenticated-side enumeration via
-- the view remains until email is removed from it (a larger client refactor
-- across ~28 call-sites that key on email).

CREATE OR REPLACE FUNCTION public.get_public_profile_by_username(p_username text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_clean TEXT := regexp_replace(COALESCE(p_username, ''), '^@', '');
  v_authed BOOLEAN := (auth.uid() IS NOT NULL);
  v_result JSONB;
BEGIN
  IF v_clean = '' THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
    'id',                          id,
    'username',                    username,
    'full_name',                   full_name,
    'bio',                         bio,
    'avatar_url',                  avatar_url,
    'current_level',               current_level,
    'total_xp',                    total_xp,
    'prestige_level',              prestige_level,
    'workout_streak',              workout_streak,
    'longest_workout_streak',      longest_workout_streak,
    'achievements_unlocked_count', achievements_unlocked_count,
    'league_tier',                 league_tier,
    'is_private',                  is_private,
    'email',                       CASE WHEN v_authed THEN email ELSE NULL END
  )
  INTO v_result
  FROM public.user_profiles
  WHERE username = v_clean
  LIMIT 1;
  RETURN v_result;   -- NULL when no such username
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_public_profile_by_username(text) TO anon, authenticated;
