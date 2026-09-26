-- 299_home_gym_custom.sql
--
-- "My gym isn't listed" — create a community gym from a typed name and
-- the user's own location, when OpenStreetMap has never heard of it.
--
-- ── Why this exists ──────────────────────────────────────────────────
--
-- Migration 275 gave every real gym a path onto Flexyn by PROMOTING an
-- OpenStreetMap feature into a `source='community'` row. That path has
-- one assumption baked into it: the gym is in OSM. Often it isn't.
--
-- The case that forced this: a beta tester in Sanford, Maine, whose
-- Planet Fitness is three miles away. It is not in OpenStreetMap — all
-- 1,905 named objects within five miles of the town centre were pulled
-- and searched, and not one tag anywhere mentions it. The nearest mapped
-- Planet Fitness is 14 miles away in New Hampshire. No search radius
-- reaches a place that isn't in the dataset, so widening the query (as
-- the client now does, out to 30 miles) could never have helped him.
--
-- Every route to a home gym before this needed an OSM feature to
-- promote, because set_home_gym_from_osm keys on (osm_type, osm_id). So
-- a user whose gym isn't mapped had no route at all — the feature simply
-- did not work where OSM coverage is thin, which is exactly where a
-- local gym community would be worth the most.
--
-- ── Keeping one gym to one row ───────────────────────────────────────
--
-- The whole value of 275 is that everyone who picks the same gym lands
-- on the same row and therefore the same leaderboard. For OSM gyms the
-- shared key does that work. A typed name has no such key, so this
-- reproduces the property two ways:
--
--   1. Before creating anything, look for an ACTIVE gym with the same
--      name within ~500 m — any source. That catches the common cases:
--      someone already typed it in, someone promoted it from OSM later,
--      or the real owner registered the business. Reuse beats forking
--      every time; a second row would split the members in half and
--      neither half would see the other on the board.
--   2. gym_businesses_custom_uniq, a partial unique index on
--      (lower(name), lat rounded to 3dp, lng rounded to 3dp) for
--      community rows with no osm_id. Three decimal places is ~110 m —
--      tight enough that two genuinely different gyms won't collide,
--      loose enough to absorb GPS scatter between two people standing
--      in the same building.
--
-- The index is the backstop for the race the lookup can't win, and the
-- INSERT catches unique_violation and re-reads the winner rather than
-- reporting a failure — the same shape as getOrCreateHomeSpace's 23505
-- branch (mig 271) and 275's own ON CONFLICT re-read.
--
-- Deliberately NOT `ON CONFLICT ... DO NOTHING` here. The arbiter would
-- be an EXPRESSION index, so the clause would have to restate all three
-- expressions AND the partial predicate exactly, and getting that subtly
-- wrong raises 42P10 at runtime rather than at deploy time — which is
-- precisely how 275 shipped broken through a migration-executes-cleanly
-- check. An exception block cannot be got wrong in that way.
--
-- ── Trusting a typed name, and the limits on that ────────────────────
--
-- This is weaker than the OSM path, which at least had a third party
-- asserting the place exists. What bounds it, all mirroring 275:
--
--   • trg_gym_text_profanity (mig 158) fires on INSERT and raises 23514
--     on a slur, the same gate owner-submitted names pass through.
--   • Name is trimmed, must be ≥2 characters, truncated to 120.
--   • Coordinates must be finite and in range — a row in the ocean is
--     worse than no row, because it pollutes the map for everyone.
--   • At most 20 community gyms per creator, ever, counted across BOTH
--     paths. Legitimate use creates ~1: re-picking moves home_gym_id, it
--     does not create.
--   • owner_id stays NULL. Nobody has proven they own the place, so
--     nobody gets owner controls — see 275 and mig 137 on why an owned
--     row that nobody owns is worse than an ownerless one.
--
-- The user supplies the coordinates from their own geolocation fix, not
-- a free-text address, so the gym lands where they are standing. That is
-- the point: the person adding it is the person who trains there.

-- ── Dedupe key for typed gyms ────────────────────────────────────────
-- Scoped to community rows with no osm_id so it can never collide with
-- the 25 seeded `demo:` rows (also osm_id NULL) or with owner-registered
-- businesses, which have their own identity and their own dedupe.
CREATE UNIQUE INDEX IF NOT EXISTS gym_businesses_custom_uniq
  ON public.gym_businesses (
    lower(btrim(name)),
    round(latitude::numeric, 3),
    round(longitude::numeric, 3)
  )
  WHERE osm_id IS NULL AND source = 'community';

CREATE OR REPLACE FUNCTION public.set_home_gym_custom(
  p_name  TEXT,
  p_lat   DOUBLE PRECISION,
  p_lng   DOUBLE PRECISION,
  p_city  TEXT DEFAULT NULL,
  p_state TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID;
  v_email    TEXT;
  v_gym_id   UUID;
  v_name     TEXT;
  v_key      TEXT;
  v_code     TEXT;
  v_mine     INTEGER;
  v_lat_span DOUBLE PRECISION := 0.0045;
  v_lng_span DOUBLE PRECISION;
  v_created  BOOLEAN := FALSE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'NOT_AUTHENTICATED');
  END IF;

  v_name := btrim(COALESCE(p_name, ''));
  IF length(v_name) < 2 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'NAME_REQUIRED');
  END IF;
  v_name := left(v_name, 120);
  v_key  := lower(v_name);

  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat <  -90 OR p_lat >  90
     OR p_lng < -180 OR p_lng > 180 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'BAD_COORDS');
  END IF;

  -- 0.0045 degrees of latitude is ~500 m everywhere, but a degree of
  -- longitude shrinks by cos(latitude) — the same trap that made the
  -- client's "radius" under three miles in the axis that mattered. Scale
  -- the longitude span so the search box is ~500 m in BOTH directions.
  -- The floor keeps it finite near the poles.
  v_lng_span := v_lat_span / GREATEST(0.05, cos(radians(p_lat)));

  -- Already here under this name? Reuse it — any source. Checked before
  -- the spam cap so someone joining an existing gym is never blocked by
  -- their own past creations.
  SELECT id INTO v_gym_id
    FROM public.gym_businesses
   WHERE is_active
     AND lower(btrim(name)) = v_key
     AND latitude  BETWEEN p_lat - v_lat_span AND p_lat + v_lat_span
     AND longitude BETWEEN p_lng - v_lng_span AND p_lng + v_lng_span
   ORDER BY abs(latitude - p_lat) + abs(longitude - p_lng)
   LIMIT 1;

  IF v_gym_id IS NULL THEN
    SELECT count(*) INTO v_mine
      FROM public.gym_businesses
     WHERE source = 'community'
       AND created_by_user_id = v_uid;

    IF v_mine >= 20 THEN
      RETURN jsonb_build_object('ok', FALSE, 'error', 'CREATE_LIMIT');
    END IF;

    v_code := public.generate_flexyn_code();

    -- The profanity trigger from mig 158 fires here and raises 23514 on
    -- a bad name. That is NOT caught below — it must reach the client so
    -- it can say something better than "try again" for a name it will
    -- never accept.
    BEGIN
      INSERT INTO public.gym_businesses (
        owner_id, name, city, state_code,
        latitude, longitude, flexyn_code,
        source, osm_type, osm_id, created_by_user_id, is_active
      )
      VALUES (
        NULL, v_name, p_city, p_state,
        p_lat, p_lng, v_code,
        'community', NULL, NULL, v_uid, TRUE
      )
      RETURNING id INTO v_gym_id;
      v_created := TRUE;
    EXCEPTION WHEN unique_violation THEN
      -- Lost the race to a concurrent creator of the same gym.
      v_gym_id := NULL;
    END;

    IF v_gym_id IS NULL THEN
      SELECT id INTO v_gym_id
        FROM public.gym_businesses
       WHERE osm_id IS NULL
         AND source = 'community'
         AND lower(btrim(name)) = v_key
         AND round(latitude::numeric, 3)  = round(p_lat::numeric, 3)
         AND round(longitude::numeric, 3) = round(p_lng::numeric, 3)
       LIMIT 1;
    END IF;

    IF v_gym_id IS NULL THEN
      RETURN jsonb_build_object('ok', FALSE, 'error', 'CREATE_FAILED');
    END IF;
  END IF;

  -- Membership is not optional: the leaderboard RPCs gate on
  -- is_gym_member_or_owner (mig 158), so a home gym you aren't a member
  -- of is a home gym whose own board answers you with 42501.
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  INSERT INTO public.gym_members (gym_id, user_id, user_email)
  VALUES (v_gym_id, v_uid, COALESCE(v_email, ''))
  ON CONFLICT (gym_id, user_id) DO NOTHING;

  UPDATE public.user_profiles SET home_gym_id = v_gym_id WHERE id = v_uid;

  RETURN jsonb_build_object(
    'ok', TRUE, 'gym_id', v_gym_id, 'created', v_created);
END;
$$;

-- A new function is EXECUTE-able by PUBLIC until revoked, and every
-- public-schema function is a PostgREST endpoint. anon would get
-- NOT_AUTHENTICATED from the auth.uid() guard, so this is defence in
-- depth rather than a hole being closed — but it matches set_home_gym
-- and set_home_gym_from_osm, and an unauthenticated caller has no
-- business reaching a SECURITY DEFINER function that writes rows.
REVOKE ALL ON FUNCTION public.set_home_gym_custom(
  TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_home_gym_custom(
  TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) TO authenticated;
