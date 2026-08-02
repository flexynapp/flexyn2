-- 275_home_gym.sql
--
-- "My Gym" — a single home gym per user, picked during onboarding.
--
-- Beta feedback: testers loved the locator map but wanted to declare the
-- gym they actually train at, see it on the map, and race the people who
-- train there. gym_members already models "user belongs to N gyms"; this
-- adds the ONE that is theirs, and the path to create a gym for the ~95%
-- of real gyms that have never registered a Flexyn business account.
--
-- ── Why community gyms exist ─────────────────────────────────────────
--
-- gym_businesses only ever held rows created by approve_gym_verification
-- (a real owner proved they own the place) plus 25 seeded `Demo:` rows.
-- Nearly every gym a beta tester trains at is in NEITHER set — it shows
-- on the map only as a grey OpenStreetMap teardrop with no id, no
-- members and no leaderboard, because OSM pins are fetched live from
-- Overpass and never persisted.
--
-- So picking one has to PROMOTE it: the first user to choose an OSM gym
-- creates a persistent `source='community'` row seeded from that OSM
-- feature. Everyone who picks the same gym afterwards lands on the same
-- row and therefore the same leaderboard. That shared-row property is
-- the whole feature, and it is enforced by a unique index on
-- (osm_type, osm_id) rather than by client discipline.
--
-- Three tiers now coexist on the map, deliberately distinguishable:
--
--   source='owner'     purple bubble — a verified business, owner_id set
--   source='community' grey bubble   — member-created, owner_id NULL,
--                                      claimable later by a real owner
--   (no row)           grey teardrop — an OSM gym nobody has picked yet
--
-- ── owner_id IS NULL is correct here ─────────────────────────────────
--
-- Mig 137 dropped the NOT NULL so seeded demo gyms could exist without
-- an auth.users row, and CLAUDE.md warns against backfilling owners onto
-- ownerless rows because an owned demo gym grants a real user edit
-- rights over data they don't own. Community gyms take the same posture
-- for the same reason: nobody has proven they own the place, so nobody
-- gets the owner controls. A real owner claims it later through the
-- existing verification queue.
--
-- ── Trusting the client's OSM payload, and the limits on that ────────
--
-- set_home_gym_from_osm takes name/lat/lng from the client, because the
-- client is what talked to Overpass. A caller can therefore lie. What
-- bounds the damage:
--
--   • The existing trg_gym_text_profanity trigger (mig 158) fires on
--     INSERT, so a slur in the name is rejected by the same gate that
--     covers owner-submitted names.
--   • Name is truncated to 120 chars and must be non-empty.
--   • Coordinates must be finite and in range, or the row would land in
--     the ocean / break the bbox index's usefulness.
--   • A caller may create at most 20 community gyms, ever. Legitimate
--     use creates ~1 (re-picking moves home_gym_id, it does not create),
--     so this is invisible to real users and caps a spam run.
--
-- This is weaker than owner verification ON PURPOSE — the alternative is
-- an admin review queue for every gym anyone trains at, which is the
-- thing that would stop the feature working on day one.
--
-- Alias-free + paste-safe (no short `alias.column`, no record `.id`).
-- Idempotent: re-running is a no-op.

-- ═══════════════════════════════════════════════════════════════════
-- 1. gym_businesses — provenance columns
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.gym_businesses
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'owner';

ALTER TABLE public.gym_businesses
  ADD COLUMN IF NOT EXISTS osm_type TEXT;

ALTER TABLE public.gym_businesses
  ADD COLUMN IF NOT EXISTS osm_id BIGINT;

-- Who promoted this OSM gym. NOT an owner — it grants no edit rights
-- anywhere and no policy reads it. It exists so the creation cap in
-- set_home_gym_from_osm has something to count, and so a spam run is
-- attributable after the fact.
ALTER TABLE public.gym_businesses
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS gym_businesses_created_by_idx
  ON public.gym_businesses (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;

-- Backfill the seeded demo rows so `source` is meaningful from the
-- start. Mig 137 defines a demo gym as ownerless + `Demo:` prefixed.
UPDATE public.gym_businesses
   SET source = 'demo'
 WHERE owner_id IS NULL
   AND name LIKE 'Demo:%'
   AND source = 'owner';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gym_businesses_source_chk'
  ) THEN
    ALTER TABLE public.gym_businesses
      ADD CONSTRAINT gym_businesses_source_chk
      CHECK (source IN ('owner', 'demo', 'community'));
  END IF;
END $$;

-- The dedupe guarantee. Two users picking the same OSM gym MUST land on
-- the same row or they get two leaderboards for one gym floor.
CREATE UNIQUE INDEX IF NOT EXISTS gym_businesses_osm_uniq
  ON public.gym_businesses (osm_type, osm_id)
  WHERE osm_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gym_businesses_source_idx
  ON public.gym_businesses (source)
  WHERE is_active = TRUE;


-- ═══════════════════════════════════════════════════════════════════
-- 2. user_profiles.home_gym_id
-- ═══════════════════════════════════════════════════════════════════
--
-- ON DELETE SET NULL, not CASCADE: deleting a gym must never delete the
-- person who trained there.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS home_gym_id UUID
    REFERENCES public.gym_businesses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS user_profiles_home_gym_idx
  ON public.user_profiles (home_gym_id)
  WHERE home_gym_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════
-- 3. set_home_gym — adopt an EXISTING gym as home
-- ═══════════════════════════════════════════════════════════════════
--
-- Joining and setting home are one transaction on purpose. A home gym
-- the user is not a member of would read as a member on the map's count
-- but be rejected by is_gym_member_or_owner when the leaderboard loads —
-- i.e. a home gym whose own leaderboard 42501s at you.
--
-- Gated on auth.uid() server-side, never on a client-passed identifier
-- (mig 108 was a privacy leak from trusting a client-passed email).

CREATE OR REPLACE FUNCTION public.set_home_gym(p_gym_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID;
  v_email  TEXT;
  v_active BOOLEAN;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'NOT_AUTHENTICATED');
  END IF;

  IF p_gym_id IS NULL THEN
    -- Explicit clear — "I don't train anywhere in particular."
    UPDATE public.user_profiles SET home_gym_id = NULL WHERE id = v_uid;
    RETURN jsonb_build_object('ok', TRUE, 'gym_id', NULL, 'cleared', TRUE);
  END IF;

  SELECT is_active INTO v_active
    FROM public.gym_businesses
   WHERE id = p_gym_id;

  IF v_active IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'GYM_NOT_FOUND');
  END IF;
  IF v_active IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'GYM_INACTIVE');
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  -- Membership is what unlocks the leaderboard RPCs (mig 158's
  -- is_gym_member_or_owner gate). ON CONFLICT keeps re-picking cheap.
  INSERT INTO public.gym_members (gym_id, user_id, user_email)
  VALUES (p_gym_id, v_uid, COALESCE(v_email, ''))
  ON CONFLICT (gym_id, user_id) DO NOTHING;

  UPDATE public.user_profiles SET home_gym_id = p_gym_id WHERE id = v_uid;

  RETURN jsonb_build_object('ok', TRUE, 'gym_id', p_gym_id);
END;
$$;

REVOKE ALL    ON FUNCTION public.set_home_gym(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_home_gym(UUID) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- 4. set_home_gym_from_osm — promote an OSM gym, then adopt it
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_home_gym_from_osm(
  p_osm_type TEXT,
  p_osm_id   BIGINT,
  p_name     TEXT,
  p_lat      DOUBLE PRECISION,
  p_lng      DOUBLE PRECISION,
  p_city     TEXT DEFAULT NULL,
  p_state    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID;
  v_email   TEXT;
  v_gym_id  UUID;
  v_name    TEXT;
  v_type    TEXT;
  v_code    TEXT;
  v_mine    INTEGER;
  v_created BOOLEAN := FALSE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'NOT_AUTHENTICATED');
  END IF;

  -- ── Validate the client-supplied OSM payload ──────────────────────
  v_type := lower(COALESCE(p_osm_type, ''));
  IF v_type NOT IN ('node', 'way', 'relation') THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'BAD_OSM_TYPE');
  END IF;

  IF p_osm_id IS NULL OR p_osm_id <= 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'BAD_OSM_ID');
  END IF;

  v_name := btrim(COALESCE(p_name, ''));
  IF v_name = '' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'NAME_REQUIRED');
  END IF;
  v_name := left(v_name, 120);

  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat <  -90 OR p_lat >  90
     OR p_lng < -180 OR p_lng > 180 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'BAD_COORDS');
  END IF;

  -- ── Reuse the existing row if this OSM gym is already promoted ─────
  -- Checked before the spam cap so a user who picks an already-created
  -- gym is never blocked by their own past creations.
  SELECT id INTO v_gym_id
    FROM public.gym_businesses
   WHERE osm_type = v_type
     AND osm_id   = p_osm_id;

  IF v_gym_id IS NULL THEN
    SELECT count(*) INTO v_mine
      FROM public.gym_businesses
     WHERE source = 'community'
       AND created_by_user_id = v_uid;

    IF v_mine >= 20 THEN
      RETURN jsonb_build_object('ok', FALSE, 'error', 'CREATE_LIMIT');
    END IF;

    v_code := public.generate_flexyn_code();

    -- owner_id stays NULL — see the head comment. The profanity trigger
    -- from mig 158 fires here and will raise 23514 on a bad name.
    INSERT INTO public.gym_businesses (
      owner_id, name, city, state_code,
      latitude, longitude, flexyn_code,
      source, osm_type, osm_id, created_by_user_id, is_active
    )
    VALUES (
      NULL, v_name, p_city, p_state,
      p_lat, p_lng, v_code,
      'community', v_type, p_osm_id, v_uid, TRUE
    )
    -- The `WHERE osm_id IS NOT NULL` is NOT decoration: the arbiter is
    -- the PARTIAL index gym_businesses_osm_uniq, and Postgres only
    -- matches a partial index when the ON CONFLICT clause repeats its
    -- predicate. Without it this raises 42P10 ("no unique or exclusion
    -- constraint matching the ON CONFLICT specification") on the very
    -- first gym anyone promotes — caught by exercising the RPC as a real
    -- authenticated user, not by checking the migration merely executes.
    ON CONFLICT (osm_type, osm_id) WHERE osm_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_gym_id;

    v_created := v_gym_id IS NOT NULL;

    -- Lost the race against a concurrent promoter of the same gym —
    -- re-read the winner rather than reporting a failure. Same shape as
    -- getOrCreateHomeSpace's 23505 branch (mig 271).
    IF v_gym_id IS NULL THEN
      SELECT id INTO v_gym_id
        FROM public.gym_businesses
       WHERE osm_type = v_type
         AND osm_id   = p_osm_id;
    END IF;

    IF v_gym_id IS NULL THEN
      RETURN jsonb_build_object('ok', FALSE, 'error', 'CREATE_FAILED');
    END IF;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  INSERT INTO public.gym_members (gym_id, user_id, user_email)
  VALUES (v_gym_id, v_uid, COALESCE(v_email, ''))
  ON CONFLICT (gym_id, user_id) DO NOTHING;

  UPDATE public.user_profiles SET home_gym_id = v_gym_id WHERE id = v_uid;

  RETURN jsonb_build_object(
    'ok', TRUE, 'gym_id', v_gym_id, 'created', v_created);
END;
$$;

REVOKE ALL ON FUNCTION public.set_home_gym_from_osm(
  TEXT, BIGINT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_home_gym_from_osm(
  TEXT, BIGINT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- 5. get_gym_community_progress — the shared-goal number
-- ═══════════════════════════════════════════════════════════════════
--
-- The leaderboard ranks members against each other; this is the figure
-- they move TOGETHER. Rolling 7 days, so it always has something in it.
--
-- Gated on membership like every other gym aggregate (mig 158), because
-- it reports how many people train at a named physical address and when
-- — that is not a fact to hand to any authenticated stranger.

CREATE OR REPLACE FUNCTION public.get_gym_community_progress(p_gym_id UUID)
RETURNS TABLE (
  member_count   BIGINT,
  active_members BIGINT,
  workout_count  BIGINT,
  total_volume   NUMERIC,
  active_days    BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.is_gym_member_or_owner(p_gym_id, auth.uid()) THEN
    RAISE EXCEPTION 'not a member' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    WITH members AS (
      SELECT user_id AS m_user_id
        FROM public.gym_members
       WHERE gym_id = p_gym_id
    ),
    logs AS (
      SELECT user_id       AS w_user_id,
             date          AS w_date,
             total_volume  AS w_volume
        FROM public.workout_logs
       WHERE date >= CURRENT_DATE - 6
         AND user_id IN (SELECT m_user_id FROM members)
    )
    SELECT
      (SELECT count(*) FROM members),
      (SELECT count(DISTINCT w_user_id) FROM logs),
      (SELECT count(*) FROM logs),
      (SELECT COALESCE(sum(w_volume), 0)::NUMERIC FROM logs),
      (SELECT count(DISTINCT (w_user_id, w_date)) FROM logs);
END;
$$;

REVOKE ALL    ON FUNCTION public.get_gym_community_progress(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gym_community_progress(UUID) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- 6. get_gyms_in_bbox — widen so the map can style by tier
-- ═══════════════════════════════════════════════════════════════════
--
-- DROP first: CREATE OR REPLACE cannot change a function's return type,
-- and this adds three OUT columns. Dropping a SECURITY DEFINER function
-- the client calls is a few milliseconds of 404 on an unrunning
-- migration — acceptable, and unavoidable.
--
-- `osm_id` is returned so the map can suppress the live Overpass
-- teardrop for a gym that has already been promoted. Without it the
-- promoted gym renders twice: once as a grey community bubble from the
-- database and once as a grey OSM pin from Overpass, at coordinates a
-- few metres apart.

DROP FUNCTION IF EXISTS public.get_gyms_in_bbox(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INT);

CREATE FUNCTION public.get_gyms_in_bbox(
  p_min_lat DOUBLE PRECISION,
  p_max_lat DOUBLE PRECISION,
  p_min_lng DOUBLE PRECISION,
  p_max_lng DOUBLE PRECISION,
  p_limit   INT DEFAULT 500
) RETURNS TABLE (
  id           UUID,
  name         TEXT,
  city         TEXT,
  state_code   TEXT,
  latitude     DOUBLE PRECISION,
  longitude    DOUBLE PRECISION,
  member_count INTEGER,
  source       TEXT,
  osm_type     TEXT,
  osm_id       BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id, name, city, state_code, latitude, longitude, member_count,
         source, osm_type, osm_id
    FROM public.gym_businesses
   WHERE is_active = TRUE
     AND latitude  BETWEEN p_min_lat AND p_max_lat
     AND longitude BETWEEN p_min_lng AND p_max_lng
   ORDER BY member_count DESC, name ASC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
$$;

REVOKE ALL ON FUNCTION public.get_gyms_in_bbox(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gyms_in_bbox(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INT) TO authenticated;
-- Deliberately NOT granted to anon — matching mig 135. The public gym
-- landing reads gym_businesses directly under mig 142's anon policy;
-- this RPC has always been authenticated-only and widening it here
-- would be an unrelated scope change smuggled into a feature migration.

NOTIFY pgrst, 'reload schema';
