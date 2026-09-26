-- 135_gym_businesses.sql
--
-- Gym Business Accounts foundation.
--
-- Architecture overview:
--   • user_profiles.account_type = 'user' | 'gym_owner' (defaults user)
--   • gym_businesses        — one row per verified physical location,
--                             owns a Flexyn Code, has geo-coords
--   • gym_verification_queue — pending business submissions awaiting
--                             admin review (status: pending/approved/rejected)
--   • gym_members           — junction: which users belong to which gyms
--                             (a user can be in N gyms — "My Gyms")
--   • gym_events            — events posted by gym owner or members
--   • gym_feed_posts        — local feed (separate from global hub_posts
--                             so RLS can scope visibility to members only)
--
-- Geo strategy: simple lat/lng columns + bounding-box queries for the
-- national map. PostGIS would be overkill for v1; bbox + a btree index
-- on (lat, lng) handles US-wide → street-level zoom efficiently.

-- ── 1. Account type on user_profiles ─────────────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'user'
    CHECK (account_type IN ('user', 'gym_owner'));

-- ── 2. Verification queue ────────────────────────────────────────────
-- Business owners submit details here BEFORE a gym_businesses row
-- exists. Flexyn admins review + approve, which atomically creates
-- the gym_businesses row + flips the owner's account_type if needed.

CREATE TABLE IF NOT EXISTS public.gym_verification_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_email       TEXT NOT NULL,
  -- Submitted business details. Free-form during v1; structured
  -- validation will tighten later as we see what real submissions
  -- look like.
  business_name     TEXT NOT NULL,
  street_address    TEXT,
  city              TEXT,
  state_code        TEXT,           -- 2-char US state code (extensible)
  postal_code       TEXT,
  country_code      TEXT DEFAULT 'US',
  phone             TEXT,
  website_url       TEXT,
  proof_url         TEXT,           -- uploaded business license / lease
  -- Geo (provided by owner from the signup form OR geocoded later)
  latitude          DOUBLE PRECISION,
  longitude         DOUBLE PRECISION,
  -- Review state
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_at       TIMESTAMPTZ,
  reviewed_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gym_verification_owner_idx
  ON public.gym_verification_queue (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gym_verification_status_idx
  ON public.gym_verification_queue (status, created_at)
  WHERE status = 'pending';

ALTER TABLE public.gym_verification_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gym_verif: read own"     ON public.gym_verification_queue;
DROP POLICY IF EXISTS "gym_verif: insert own"   ON public.gym_verification_queue;
DROP POLICY IF EXISTS "gym_verif: admin read"   ON public.gym_verification_queue;

CREATE POLICY "gym_verif: read own"
  ON public.gym_verification_queue FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "gym_verif: insert own"
  ON public.gym_verification_queue FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- Admin reads are via service_role / admin RPCs only — no public
-- READ policy for arbitrary users.

GRANT SELECT, INSERT ON public.gym_verification_queue TO authenticated;

-- ── 3. gym_businesses — verified physical gyms ───────────────────────
CREATE TABLE IF NOT EXISTS public.gym_businesses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  verification_id   UUID UNIQUE REFERENCES public.gym_verification_queue(id),
  -- Business identity
  name              TEXT NOT NULL,
  description       TEXT,
  logo_url          TEXT,
  cover_url         TEXT,
  -- Location
  street_address    TEXT,
  city              TEXT,
  state_code        TEXT,
  postal_code       TEXT,
  country_code      TEXT DEFAULT 'US',
  latitude          DOUBLE PRECISION NOT NULL,
  longitude         DOUBLE PRECISION NOT NULL,
  -- The Flexyn Code (8 chars, unambiguous alphabet: A-Z minus I/O,
  -- 2-9 minus 0/1). 32-char alphabet × 8 positions = ~10^12 possible
  -- codes, so collisions during random generation are negligible until
  -- the millions of gyms range.
  flexyn_code       TEXT NOT NULL UNIQUE
                      CHECK (flexyn_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  -- Counters denormalized for cheap leaderboard / hub renders
  member_count      INTEGER NOT NULL DEFAULT 0,
  -- Contact
  phone             TEXT,
  website_url       TEXT,
  -- Lifecycle
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bounding-box queries hit a composite btree index. Lat-first because
-- US latitude spans ~25-50° (narrow) while longitude spans ~-125 to
-- -65° (wider); the leading column gets better selectivity per band.
CREATE INDEX IF NOT EXISTS gym_businesses_geo_idx
  ON public.gym_businesses (latitude, longitude)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS gym_businesses_owner_idx
  ON public.gym_businesses (owner_id);

CREATE INDEX IF NOT EXISTS gym_businesses_code_idx
  ON public.gym_businesses (flexyn_code);

ALTER TABLE public.gym_businesses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gym_businesses: read all"        ON public.gym_businesses;
DROP POLICY IF EXISTS "gym_businesses: owner update"    ON public.gym_businesses;

-- Anyone authenticated can SEE gyms — needed for the map + discovery.
-- The sensitive fields (owner_id, phone) are still readable but the
-- client should not surface them on non-owner views.
CREATE POLICY "gym_businesses: read all"
  ON public.gym_businesses FOR SELECT
  TO authenticated USING (TRUE);

CREATE POLICY "gym_businesses: owner update"
  ON public.gym_businesses FOR UPDATE
  TO authenticated USING (owner_id = auth.uid());

-- INSERT is gated through the approval RPC (SECURITY DEFINER) — no
-- direct client insert path.

GRANT SELECT, UPDATE ON public.gym_businesses TO authenticated;

-- ── 4. gym_members — user-gym junction ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.gym_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      UUID NOT NULL REFERENCES public.gym_businesses(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email  TEXT NOT NULL,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gym_id, user_id)
);

CREATE INDEX IF NOT EXISTS gym_members_user_idx
  ON public.gym_members (user_id, joined_at DESC);
CREATE INDEX IF NOT EXISTS gym_members_gym_idx
  ON public.gym_members (gym_id, joined_at DESC);

ALTER TABLE public.gym_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gym_members: read all"     ON public.gym_members;
DROP POLICY IF EXISTS "gym_members: join own"     ON public.gym_members;
DROP POLICY IF EXISTS "gym_members: leave own"    ON public.gym_members;

CREATE POLICY "gym_members: read all"
  ON public.gym_members FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "gym_members: join own"
  ON public.gym_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "gym_members: leave own"
  ON public.gym_members FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.gym_members TO authenticated;

-- Member-count trigger keeps the denormalized counter in sync.
CREATE OR REPLACE FUNCTION public.gym_members_count_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.gym_businesses
       SET member_count = COALESCE(member_count, 0) + 1
     WHERE id = NEW.gym_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.gym_businesses
       SET member_count = GREATEST(0, COALESCE(member_count, 0) - 1)
     WHERE id = OLD.gym_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_gym_members_count ON public.gym_members;
CREATE TRIGGER trg_gym_members_count
  AFTER INSERT OR DELETE ON public.gym_members
  FOR EACH ROW EXECUTE FUNCTION public.gym_members_count_sync();

-- ── 5. gym_events ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gym_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id       UUID NOT NULL REFERENCES public.gym_businesses(id) ON DELETE CASCADE,
  created_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  body         TEXT,
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ,
  location_note TEXT,                  -- e.g. "Squat rack 3"
  rsvp_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gym_events_gym_idx
  ON public.gym_events (gym_id, starts_at DESC);

ALTER TABLE public.gym_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gym_events: members read"   ON public.gym_events;
DROP POLICY IF EXISTS "gym_events: owner write"    ON public.gym_events;
DROP POLICY IF EXISTS "gym_events: member create"  ON public.gym_events;

-- Members + owner can read.
CREATE POLICY "gym_events: members read"
  ON public.gym_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.gym_members gm
       WHERE gm.gym_id = gym_events.gym_id AND gm.user_id = auth.uid()
    ) OR EXISTS (
      SELECT 1 FROM public.gym_businesses gb
       WHERE gb.id = gym_events.gym_id AND gb.owner_id = auth.uid()
    )
  );

-- Members can create (v1; later restrict to owner if spammy).
CREATE POLICY "gym_events: member create"
  ON public.gym_events FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.gym_members gm
       WHERE gm.gym_id = gym_events.gym_id AND gm.user_id = auth.uid()
    )
  );

CREATE POLICY "gym_events: owner write"
  ON public.gym_events FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.gym_businesses gb
       WHERE gb.id = gym_events.gym_id AND gb.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gym_events TO authenticated;

-- ── 6. gym_feed_posts — local community feed ─────────────────────────
-- Separate from global hub_posts so RLS can scope visibility to gym
-- members. Mirrors the hub_posts shape for client-side reuse.

CREATE TABLE IF NOT EXISTS public.gym_feed_posts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id       UUID NOT NULL REFERENCES public.gym_businesses(id) ON DELETE CASCADE,
  author_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_email TEXT NOT NULL,
  body         TEXT NOT NULL,
  media_url    TEXT,
  like_count   INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gym_feed_posts_gym_idx
  ON public.gym_feed_posts (gym_id, created_at DESC);

ALTER TABLE public.gym_feed_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gym_feed: members read"   ON public.gym_feed_posts;
DROP POLICY IF EXISTS "gym_feed: members write"  ON public.gym_feed_posts;
DROP POLICY IF EXISTS "gym_feed: author delete"  ON public.gym_feed_posts;

CREATE POLICY "gym_feed: members read"
  ON public.gym_feed_posts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.gym_members gm
       WHERE gm.gym_id = gym_feed_posts.gym_id AND gm.user_id = auth.uid()
    ) OR EXISTS (
      SELECT 1 FROM public.gym_businesses gb
       WHERE gb.id = gym_feed_posts.gym_id AND gb.owner_id = auth.uid()
    )
  );

CREATE POLICY "gym_feed: members write"
  ON public.gym_feed_posts FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.gym_members gm
       WHERE gm.gym_id = gym_feed_posts.gym_id AND gm.user_id = auth.uid()
    )
  );

CREATE POLICY "gym_feed: author delete"
  ON public.gym_feed_posts FOR DELETE TO authenticated
  USING (author_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.gym_feed_posts TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- RPCs
-- ─────────────────────────────────────────────────────────────────────

-- ── generate_flexyn_code ─────────────────────────────────────────────
-- Returns an unused 8-char code from the safe alphabet (no 0/1/I/O).
-- Loops until uniqueness; collisions essentially never happen at
-- realistic gym counts but the guard is here for correctness.

CREATE OR REPLACE FUNCTION public.generate_flexyn_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code     TEXT;
  v_n        INT;
  v_i        INT;
BEGIN
  FOR v_i IN 1..50 LOOP
    v_code := '';
    FOR v_n IN 1..8 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.gym_businesses WHERE flexyn_code = v_code) THEN
      RETURN v_code;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'could not generate unique flexyn code after 50 tries';
END;
$$;

REVOKE ALL ON FUNCTION public.generate_flexyn_code() FROM PUBLIC;

-- ── submit_gym_verification ──────────────────────────────────────────
-- Owner submits their business for review. Sets account_type to
-- 'gym_owner' eagerly so the UI can branch correctly even before
-- approval (the user's identity is "pending business" until approved).

CREATE OR REPLACE FUNCTION public.submit_gym_verification(
  p_business_name TEXT,
  p_street_address TEXT,
  p_city           TEXT,
  p_state_code     TEXT,
  p_postal_code    TEXT,
  p_country_code   TEXT DEFAULT 'US',
  p_phone          TEXT DEFAULT NULL,
  p_website_url    TEXT DEFAULT NULL,
  p_proof_url      TEXT DEFAULT NULL,
  p_latitude       DOUBLE PRECISION DEFAULT NULL,
  p_longitude      DOUBLE PRECISION DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
  v_id    UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_business_name IS NULL OR length(trim(p_business_name)) < 2 THEN
    RAISE EXCEPTION 'business_name required' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  INSERT INTO public.gym_verification_queue (
    owner_id, owner_email, business_name, street_address, city, state_code,
    postal_code, country_code, phone, website_url, proof_url, latitude, longitude
  )
  VALUES (
    v_uid, v_email, p_business_name, p_street_address, p_city, p_state_code,
    p_postal_code, p_country_code, p_phone, p_website_url, p_proof_url,
    p_latitude, p_longitude
  )
  RETURNING id INTO v_id;

  -- Eager-flip account type so the UI knows this user is a pending owner.
  UPDATE public.user_profiles
     SET account_type = 'gym_owner'
   WHERE id = v_uid AND account_type = 'user';

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_gym_verification(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_gym_verification(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

-- ── approve_gym_verification ─────────────────────────────────────────
-- Admin-only. Creates the gym_businesses row, generates the code,
-- flips the verification row to approved.
--
-- The admin gate is on the caller's username matching the
-- ADMIN_USERNAMES list (mirrors src/lib/adminRoles.js). For v1 we
-- check via a small inline list; future: dedicated admin_users table.

CREATE OR REPLACE FUNCTION public.approve_gym_verification(p_verif_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_admin_check  BOOLEAN;
  v_verif        public.gym_verification_queue%ROWTYPE;
  v_code         TEXT;
  v_gym_id       UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  -- Admin check via app_admins.is_admin (set by the team manually)
  SELECT (username IN ('kegan', 'sean', 'admin')) INTO v_admin_check
    FROM public.user_profiles WHERE id = v_uid;
  IF NOT COALESCE(v_admin_check, FALSE) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_verif FROM public.gym_verification_queue WHERE id = p_verif_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'verification record not found' USING ERRCODE = '22023';
  END IF;
  IF v_verif.status <> 'pending' THEN
    RAISE EXCEPTION 'already %', v_verif.status USING ERRCODE = '22023';
  END IF;
  IF v_verif.latitude IS NULL OR v_verif.longitude IS NULL THEN
    RAISE EXCEPTION 'geo coords required before approval' USING ERRCODE = '22023';
  END IF;

  v_code := public.generate_flexyn_code();

  INSERT INTO public.gym_businesses (
    owner_id, verification_id, name, street_address, city, state_code,
    postal_code, country_code, latitude, longitude, flexyn_code,
    phone, website_url
  )
  VALUES (
    v_verif.owner_id, v_verif.id, v_verif.business_name, v_verif.street_address,
    v_verif.city, v_verif.state_code, v_verif.postal_code, v_verif.country_code,
    v_verif.latitude, v_verif.longitude, v_code,
    v_verif.phone, v_verif.website_url
  )
  RETURNING id INTO v_gym_id;

  UPDATE public.gym_verification_queue
     SET status = 'approved', reviewed_at = now(), reviewed_by = v_uid
   WHERE id = p_verif_id;

  RETURN v_gym_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_gym_verification(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_gym_verification(UUID) TO authenticated;

-- ── join_gym_by_code ─────────────────────────────────────────────────
-- User scans/types a code → joins the gym. Idempotent — a second
-- join attempt by the same user returns the existing membership.

CREATE OR REPLACE FUNCTION public.join_gym_by_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_email  TEXT;
  v_gym_id UUID;
  v_member_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_code IS NULL OR length(p_code) <> 8 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'INVALID_CODE');
  END IF;

  SELECT id INTO v_gym_id FROM public.gym_businesses
   WHERE flexyn_code = upper(trim(p_code)) AND is_active = TRUE;
  IF v_gym_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'CODE_NOT_FOUND');
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  INSERT INTO public.gym_members (gym_id, user_id, user_email)
  VALUES (v_gym_id, v_uid, v_email)
  ON CONFLICT (gym_id, user_id) DO NOTHING
  RETURNING id INTO v_member_id;

  RETURN jsonb_build_object('ok', TRUE, 'gymId', v_gym_id,
                            'memberId', v_member_id,
                            'alreadyMember', v_member_id IS NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.join_gym_by_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_gym_by_code(TEXT) TO authenticated;

-- ── get_gyms_in_bbox ─────────────────────────────────────────────────
-- Map query — returns active gyms inside the given bounding box.
-- Capped at 500 to keep nationwide-zoom payloads sane.

CREATE OR REPLACE FUNCTION public.get_gyms_in_bbox(
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
  member_count INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id, name, city, state_code, latitude, longitude, member_count
    FROM public.gym_businesses
   WHERE is_active = TRUE
     AND latitude  BETWEEN p_min_lat AND p_max_lat
     AND longitude BETWEEN p_min_lng AND p_max_lng
   ORDER BY member_count DESC, name ASC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
$$;

REVOKE ALL ON FUNCTION public.get_gyms_in_bbox(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gyms_in_bbox(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INT) TO authenticated;

-- ── get_gym_leaderboard ──────────────────────────────────────────────
-- Returns members of a gym ranked by their stat — defaults to total
-- volume lifted. Mode: 'volume' | 'xp' | 'streak'.

CREATE OR REPLACE FUNCTION public.get_gym_leaderboard(
  p_gym_id UUID,
  p_mode   TEXT DEFAULT 'volume',
  p_limit  INT  DEFAULT 50
) RETURNS TABLE (
  user_id     UUID,
  username    TEXT,
  avatar_url  TEXT,
  value       NUMERIC,
  rank        INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_mode TEXT := COALESCE(p_mode, 'volume');
BEGIN
  IF v_mode NOT IN ('volume', 'xp', 'streak') THEN
    RAISE EXCEPTION 'invalid mode' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
    WITH ranked AS (
      SELECT
        p.id          AS user_id,
        p.username,
        p.avatar_url,
        CASE v_mode
          WHEN 'volume' THEN COALESCE(p.total_volume_lbs, 0)::NUMERIC
          WHEN 'xp'     THEN COALESCE(p.total_xp,         0)::NUMERIC
          WHEN 'streak' THEN COALESCE(p.workout_streak,   0)::NUMERIC
        END AS value
      FROM public.gym_members gm
      JOIN public.user_profiles p ON p.id = gm.user_id
      WHERE gm.gym_id = p_gym_id
    )
    SELECT user_id, username, avatar_url, value,
           RANK() OVER (ORDER BY value DESC)::INT AS rank
      FROM ranked
     WHERE value > 0
     ORDER BY value DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.get_gym_leaderboard(UUID, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gym_leaderboard(UUID, TEXT, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
