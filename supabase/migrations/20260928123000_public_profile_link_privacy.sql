-- Shared profile links (/@username) stop leaking email and private stats.
--
-- get_public_profile_by_username is the one read behind a shared profile
-- link, and it is callable without signing in. Measured against production
-- on 2026-09-28, as a guest account (which anyone can create with one tap):
-- it returned the real email address of 21 users, one call per username,
-- and usernames are listed all over the Hub. It also ignored is_private and
-- blocks, so a private profile's bio, XP and streaks went to anyone, and a
-- person who blocked you still showed you their profile.
--
-- The page never displayed the email, so it is simply dropped. The rest now
-- follows the same rule as public_profiles:
--   * a viewer the owner blocked (or who blocked the owner) gets nothing;
--   * identity (username, name, avatar) is always returned, because you
--     have to see who someone is to follow them;
--   * bio, level, XP, prestige, streaks, badges and league are returned only
--     when the profile is public, is your own, or you follow it.
-- full_view tells the page which case it is in.

CREATE OR REPLACE FUNCTION public.get_public_profile_by_username(p_username text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_clean TEXT := regexp_replace(COALESCE(p_username, ''), '^@', '');
  v_row   public.user_profiles%ROWTYPE;
  v_full  BOOLEAN;
BEGIN
  IF v_clean = '' THEN RETURN NULL; END IF;

  SELECT * INTO v_row
    FROM public.user_profiles
   WHERE username = v_clean
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF public.viewer_is_blocked_by(v_row.email) THEN RETURN NULL; END IF;

  v_full := NOT COALESCE(v_row.is_private, FALSE)
            OR v_row.id = auth.uid()
            OR (auth.uid() IS NOT NULL AND public.viewer_follows(v_row.email));

  RETURN jsonb_build_object(
    'id',                          v_row.id,
    'username',                    v_row.username,
    'full_name',                   v_row.full_name,
    'avatar_url',                  v_row.avatar_url,
    'is_private',                  COALESCE(v_row.is_private, FALSE),
    'full_view',                   v_full,
    'bio',                         CASE WHEN v_full THEN v_row.bio END,
    'current_level',               CASE WHEN v_full THEN v_row.current_level END,
    'total_xp',                    CASE WHEN v_full THEN v_row.total_xp END,
    'prestige_level',              CASE WHEN v_full THEN v_row.prestige_level END,
    'workout_streak',              CASE WHEN v_full THEN v_row.workout_streak END,
    'longest_workout_streak',      CASE WHEN v_full THEN v_row.longest_workout_streak END,
    'achievements_unlocked_count', CASE WHEN v_full THEN v_row.achievements_unlocked_count END,
    'league_tier',                 CASE WHEN v_full THEN v_row.league_tier END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_public_profile_by_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile_by_username(text) TO anon, authenticated, service_role;

-- Probe: play the real call as the roles that make it, on seeded rows, and
-- roll every write back. Asserts both directions: the leak is closed AND a
-- public profile still shows its stats.
DO $probe$
DECLARE
  v_owner  uuid := gen_random_uuid();
  v_viewer uuid := gen_random_uuid();
  v_pub    uuid := gen_random_uuid();
  r        jsonb;
BEGIN
  INSERT INTO auth.users (id, email, aud, role)
  VALUES (v_owner,  'probe_owner_'  || v_owner  || '@probe.invalid', 'authenticated', 'authenticated'),
         (v_viewer, 'probe_viewer_' || v_viewer || '@probe.invalid', 'authenticated', 'authenticated'),
         (v_pub,    'probe_pub_'    || v_pub    || '@probe.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.user_profiles (id, email, username, is_private, bio, total_xp)
  VALUES (v_owner,  'probe_owner_'  || v_owner  || '@probe.invalid', 'probe_o_' || left(v_owner::text, 8),  TRUE,  'secret bio', 999)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, username = EXCLUDED.username,
     is_private = EXCLUDED.is_private, bio = EXCLUDED.bio, total_xp = EXCLUDED.total_xp;
  INSERT INTO public.user_profiles (id, email, username, is_private, bio, total_xp)
  VALUES (v_pub,    'probe_pub_'    || v_pub    || '@probe.invalid', 'probe_p_' || left(v_pub::text, 8),    FALSE, 'open bio', 500)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, username = EXCLUDED.username,
     is_private = EXCLUDED.is_private, bio = EXCLUDED.bio, total_xp = EXCLUDED.total_xp;
  INSERT INTO public.user_profiles (id, email, username)
  VALUES (v_viewer, 'probe_viewer_' || v_viewer || '@probe.invalid', 'probe_v_' || left(v_viewer::text, 8))
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, username = EXCLUDED.username;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL role authenticated';

  r := public.get_public_profile_by_username('probe_o_' || left(v_owner::text, 8));
  IF r ? 'email' THEN RAISE EXCEPTION 'probe: email still returned'; END IF;
  IF (r->>'full_view')::boolean OR r->>'bio' IS NOT NULL OR r->>'total_xp' IS NOT NULL THEN
    RAISE EXCEPTION 'probe: private stats returned to a non-follower: %', r;
  END IF;
  IF r->>'username' IS NULL THEN RAISE EXCEPTION 'probe: private identity missing'; END IF;

  r := public.get_public_profile_by_username('probe_p_' || left(v_pub::text, 8));
  IF NOT (r->>'full_view')::boolean OR r->>'bio' <> 'open bio' OR (r->>'total_xp')::int <> 500 THEN
    RAISE EXCEPTION 'probe: public profile lost its stats: %', r;
  END IF;

  EXECUTE 'RESET role';
  INSERT INTO public.hub_follows (created_by, follower_email, followee_email)
  VALUES ('probe_viewer_' || v_viewer || '@probe.invalid',
          'probe_viewer_' || v_viewer || '@probe.invalid', 'probe_owner_' || v_owner || '@probe.invalid');
  EXECUTE 'SET LOCAL role authenticated';
  r := public.get_public_profile_by_username('probe_o_' || left(v_owner::text, 8));
  IF NOT (r->>'full_view')::boolean OR r->>'bio' <> 'secret bio' THEN
    RAISE EXCEPTION 'probe: follower cannot see a private profile: %', r;
  END IF;

  EXECUTE 'RESET role';
  INSERT INTO public.user_blocks (blocker_id, blocker_email, blocked_email)
  VALUES (v_owner, 'probe_owner_' || v_owner || '@probe.invalid', 'probe_viewer_' || v_viewer || '@probe.invalid');
  EXECUTE 'SET LOCAL role authenticated';
  IF public.get_public_profile_by_username('probe_o_' || left(v_owner::text, 8)) IS NOT NULL THEN
    RAISE EXCEPTION 'probe: blocked viewer still sees the profile';
  END IF;

  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL role anon';
  r := public.get_public_profile_by_username('probe_p_' || left(v_pub::text, 8));
  IF r ? 'email' OR r->>'bio' <> 'open bio' THEN RAISE EXCEPTION 'probe: anon view wrong: %', r; END IF;
  r := public.get_public_profile_by_username('probe_o_' || left(v_owner::text, 8));
  IF r->>'bio' IS NOT NULL THEN RAISE EXCEPTION 'probe: anon sees private bio'; END IF;

  EXECUTE 'RESET role';
  RAISE EXCEPTION 'probe_ok';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
END;
$probe$;
