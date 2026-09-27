-- Profiles were invisible to everyone, and the Duels search had no one to find.
--
-- Kegan, 2026-09-27: "currently can't search for users to duel". Measured as a
-- real authenticated user against production: `public_profiles` returned ONE
-- row, the viewer's own. The view carries `security_invoker = true` (it is in
-- the 2026-09-26 baseline dump, so it was flipped before then), which makes it
-- run under user_profiles' own-row-only RLS. CLAUDE.md ("Privacy boundaries
-- that are enforced") names this exact flag as the thing not to set: every
-- profile page, @mention, follow suggestion, leaderboard name and duel search
-- silently goes blank. The view applies its own predicate instead (blocks
-- hidden, stats gated on `full_view`), selects no email, and `anon` has no
-- SELECT grant, so running it as its owner is the intended design.
--
-- The Duels picker also needs what the view cannot say: whether a user is a
-- guest (guests cannot duel, 42 of 48 guests have a username and would show up
-- as dead ends) and whether they asked to be left out of search.
-- `duel_opponent_candidates` answers both.

ALTER VIEW public.public_profiles SET (security_invoker = false);

-- ── Duel opponent picker ───────────────────────────────────────────────────
-- p_query of two or more characters searches usernames and display names.
-- Anything shorter returns the people the caller follows. Either way: never
-- the caller, never a guest, never someone hidden from search, never either
-- side of a block. Level is withheld on a private profile the caller does not
-- follow, matching the view's full_view rule.

CREATE OR REPLACE FUNCTION public.duel_opponent_candidates(p_query TEXT DEFAULT NULL)
RETURNS TABLE (id UUID, username TEXT, display_name TEXT, avatar_url TEXT, current_level INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
  v_q     TEXT := lower(btrim(COALESCE(p_query, '')));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT p.email INTO v_email FROM public.user_profiles p WHERE p.id = v_uid;
  v_q := ltrim(v_q, '@');
  -- LIKE wildcards in the query are literal characters.
  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');

  RETURN QUERY
  SELECT p.id, p.username, p.display_name, p.avatar_url,
         CASE WHEN NOT COALESCE(p.is_private, FALSE) OR public.viewer_follows(p.email)
              THEN p.current_level END
    FROM public.user_profiles p
    JOIN auth.users u ON u.id = p.id
   WHERE p.id <> v_uid
     AND p.username IS NOT NULL
     AND NOT COALESCE(u.is_anonymous, FALSE) AND u.email IS NOT NULL
     AND NOT COALESCE(p.hide_from_search, FALSE)
     AND NOT public.is_blocked(v_uid, p.email)
     AND CASE
           WHEN length(v_q) >= 2 THEN
             lower(p.username) LIKE '%' || v_q || '%'
             OR lower(COALESCE(p.display_name, '')) LIKE '%' || v_q || '%'
           ELSE EXISTS (SELECT 1 FROM public.hub_follows f
                         WHERE f.followee_id = p.id AND lower(f.follower_email) = lower(v_email))
         END
   ORDER BY (lower(p.username) LIKE v_q || '%') DESC,
            p.last_active_at DESC NULLS LAST,
            p.username
   LIMIT 20;
END;
$$;

REVOKE ALL ON FUNCTION public.duel_opponent_candidates(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duel_opponent_candidates(TEXT) TO authenticated;

-- ── Attempt it ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  a UUID := gen_random_uuid();   -- viewer
  b UUID := gen_random_uuid();   -- public lifter
  p UUID := gen_random_uuid();   -- private lifter
  g UUID := gen_random_uuid();   -- guest with a username
  n INTEGER;
  v_failed BOOLEAN;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    VALUES (a, 'pp-probe-a-' || a || '@example.invalid', 'authenticated', 'authenticated', FALSE),
           (b, 'pp-probe-b-' || b || '@example.invalid', 'authenticated', 'authenticated', FALSE),
           (p, 'pp-probe-p-' || p || '@example.invalid', 'authenticated', 'authenticated', FALSE),
           (g, NULL, 'authenticated', 'authenticated', TRUE);
    INSERT INTO public.user_profiles (id, email, username, is_private, total_xp, current_level)
    VALUES (a, 'pp-probe-a-' || a || '@example.invalid', 'zqprobea' || left(a::text, 6), FALSE, 10, 2),
           (b, 'pp-probe-b-' || b || '@example.invalid', 'zqprobeb' || left(b::text, 6), FALSE, 10, 2),
           (p, 'pp-probe-p-' || p || '@example.invalid', 'zqprobep' || left(p::text, 6), TRUE, 10, 2),
           (g, 'guest_' || g || '@flexyn.guest',        'zqprobeg' || left(g::text, 6), FALSE, 10, 2)
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, username = EXCLUDED.username,
      is_private = EXCLUDED.is_private, total_xp = EXCLUDED.total_xp, current_level = EXCLUDED.current_level;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    -- The view shows other people again, and still gates a private profile's stats.
    IF NOT EXISTS (SELECT 1 FROM public.public_profiles WHERE id = b) THEN
      RESET ROLE; RAISE EXCEPTION 'probe: a public profile is invisible to another user';
    END IF;
    IF (SELECT total_xp FROM public.public_profiles WHERE id = p) IS NOT NULL THEN
      RESET ROLE; RAISE EXCEPTION 'probe: a private profile leaked its XP';
    END IF;

    -- The picker finds registered lifters, not guests or the caller.
    SELECT count(*) INTO n FROM public.duel_opponent_candidates('zqprobe');
    IF n <> 2 THEN RESET ROLE; RAISE EXCEPTION 'probe: picker returned % rows, expected 2', n; END IF;
    IF EXISTS (SELECT 1 FROM public.duel_opponent_candidates('zqprobe') c WHERE c.id = p AND c.current_level IS NOT NULL) THEN
      RESET ROLE; RAISE EXCEPTION 'probe: picker leaked a private level';
    END IF;
    IF EXISTS (SELECT 1 FROM public.duel_opponent_candidates('%') c) THEN
      RESET ROLE; RAISE EXCEPTION 'probe: a wildcard query listed everyone';
    END IF;
    RESET ROLE;

    -- Signed out: no access to the view at all.
    SET LOCAL ROLE anon;
    v_failed := FALSE;
    BEGIN PERFORM 1 FROM public.public_profiles LIMIT 1; EXCEPTION WHEN insufficient_privilege THEN v_failed := TRUE; END;
    RESET ROLE;
    IF NOT v_failed THEN RAISE EXCEPTION 'probe: anon can read public_profiles'; END IF;

    RAISE EXCEPTION 'pp-probe-ok';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'pp-probe-ok' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
