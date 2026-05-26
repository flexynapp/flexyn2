-- ─────────────────────────────────────────────────────────────────────
-- _deploy_149_to_151.sql — ONE-SHOT DEPLOY BUNDLE
--
-- Paste this entire file into the Supabase SQL Editor and click Run.
-- Migrations 149_gym_checkins, 149_live_activity_rail_email_column,
-- 150_gym_approval_geo_optional, 150_gym_consistency_leaderboard,
-- 151_signature_trophy — stitched together and rewritten paste-safe
-- per CLAUDE.md (no `alias.column` 2-char tokens, no `%ROWTYPE` +
-- dotted record access; scalar SELECT…INTO variables only).
--
-- All statements idempotent. Safe to re-run after partial apply.
--
-- After this lands:
--   ✅ Gym Check-In QR (1.2x XP day)            (149_gym_checkins)
--   ✅ Live Activity rail tap → profile route   (149_live_activity_rail_email_column)
--   ✅ Coord-less gyms can be approved          (150_gym_approval_geo_optional)
--   ✅ Effort/consistency gym leaderboard       (150_gym_consistency_leaderboard)
--   ✅ Pinned "signature trophy" on profile     (151_signature_trophy)
-- ─────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════
-- ── 149_gym_checkins.sql ──
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.gym_checkins (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gym_id       UUID NOT NULL REFERENCES public.gym_businesses(id) ON DELETE CASCADE,
  checkin_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, gym_id, checkin_date)
);

CREATE INDEX IF NOT EXISTS gym_checkins_user_date_idx
  ON public.gym_checkins (user_id, checkin_date DESC);

ALTER TABLE public.gym_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gym_checkins: owner select" ON public.gym_checkins;
CREATE POLICY "gym_checkins: owner select"
  ON public.gym_checkins FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.gym_checkins TO authenticated;

CREATE OR REPLACE FUNCTION public.check_in_to_gym(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_gym_id UUID;
  v_name   TEXT;
  v_today  DATE := (now() AT TIME ZONE 'UTC')::date;
  v_rows   INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_code IS NULL OR length(btrim(p_code)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CODE_REQUIRED');
  END IF;

  SELECT id, name INTO v_gym_id, v_name
    FROM public.gym_businesses
   WHERE flexyn_code = upper(btrim(p_code)) AND is_active = TRUE;

  IF v_gym_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'GYM_NOT_FOUND');
  END IF;

  INSERT INTO public.gym_checkins (user_id, gym_id, checkin_date)
    VALUES (v_uid, v_gym_id, v_today)
    ON CONFLICT (user_id, gym_id, checkin_date) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok',       true,
    'gym_id',   v_gym_id,
    'gym_name', v_name,
    'already',  v_rows = 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_in_to_gym(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_in_to_gym(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_gym_checkin_today()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.gym_checkins
     WHERE user_id = auth.uid()
       AND checkin_date = (now() AT TIME ZONE 'UTC')::date
  );
$$;

REVOKE ALL ON FUNCTION public.has_gym_checkin_today() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_gym_checkin_today() TO authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- ── 149_live_activity_rail_email_column.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- Adds `email` to get_active_followees so the LiveActivityRail can
-- navigate to /hub?profile=<email>. Rewritten paste-safe — CTE renames
-- the join keys so the body has no `alias.column` 2-char tokens.

CREATE OR REPLACE FUNCTION public.get_active_followees()
RETURNS TABLE (
  user_id      UUID,
  username     TEXT,
  avatar_url   TEXT,
  active_until TIMESTAMPTZ,
  email        TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
#variable_conflict use_column
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;

  RETURN QUERY
    WITH following AS (
      SELECT followee_email AS f_email
        FROM public.hub_follows
       WHERE follower_email = v_email
    )
    SELECT public.user_profiles.id,
           public.user_profiles.username,
           public.user_profiles.avatar_url,
           public.user_profiles.active_until,
           public.user_profiles.email
      FROM public.user_profiles
      JOIN following ON f_email = public.user_profiles.email
     WHERE public.user_profiles.active_until > now()
     ORDER BY public.user_profiles.active_until DESC
     LIMIT 50;
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_followees() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_followees() TO authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- ── 150_gym_approval_geo_optional.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- Rewritten paste-safe — scalar SELECT…INTO variables instead of
-- %ROWTYPE + dotted record access.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='gym_businesses'
                AND column_name='latitude' AND is_nullable='NO') THEN
    EXECUTE 'ALTER TABLE public.gym_businesses ALTER COLUMN latitude  DROP NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='gym_businesses'
                AND column_name='longitude' AND is_nullable='NO') THEN
    EXECUTE 'ALTER TABLE public.gym_businesses ALTER COLUMN longitude DROP NOT NULL';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.approve_gym_verification(p_verif_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid            UUID := auth.uid();
  v_is_admin       BOOLEAN;
  v_status         TEXT;
  v_owner_id       UUID;
  v_business_name  TEXT;
  v_street         TEXT;
  v_city           TEXT;
  v_state          TEXT;
  v_postal         TEXT;
  v_country        TEXT;
  v_lat            NUMERIC;
  v_lng            NUMERIC;
  v_phone          TEXT;
  v_website        TEXT;
  v_code           TEXT;
  v_gym_id         UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT (username IN ('kegan', 'sean', 'admin')) INTO v_is_admin
    FROM public.user_profiles WHERE id = v_uid;
  IF NOT COALESCE(v_is_admin, FALSE) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  SELECT status, owner_id, business_name, street_address, city, state_code,
         postal_code, country_code, latitude, longitude, phone, website_url
    INTO v_status, v_owner_id, v_business_name, v_street, v_city, v_state,
         v_postal, v_country, v_lat, v_lng, v_phone, v_website
    FROM public.gym_verification_queue
   WHERE id = p_verif_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'verification record not found' USING ERRCODE = '22023';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'already %', v_status USING ERRCODE = '22023';
  END IF;

  -- Coord-less gyms are intentionally allowed; they just won't appear
  -- on the discovery map until the owner sets coords via GymEdit.

  v_code := public.generate_flexyn_code();

  INSERT INTO public.gym_businesses (
    owner_id, verification_id, name, street_address, city, state_code,
    postal_code, country_code, latitude, longitude, flexyn_code,
    phone, website_url
  )
  VALUES (
    v_owner_id, p_verif_id, v_business_name,
    v_street, v_city, v_state,
    v_postal, v_country, v_lat, v_lng, v_code,
    v_phone, v_website
  )
  RETURNING id INTO v_gym_id;

  UPDATE public.gym_verification_queue
     SET status = 'approved'
   WHERE id = p_verif_id;

  RETURN v_gym_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.approve_gym_verification(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_gym_verification(UUID) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- ── 150_gym_consistency_leaderboard.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- Already paste-safe (CTEs rename keys). Verbatim.

CREATE OR REPLACE FUNCTION public.get_gym_consistency_leaderboard(
  p_gym_id UUID,
  p_limit  INT DEFAULT 50
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
#variable_conflict use_column
BEGIN
  RETURN QUERY
    WITH members AS (
      SELECT user_id AS m_user_id, joined_at AS m_joined_at
        FROM public.gym_members
       WHERE gym_id = p_gym_id
    ),
    active AS (
      SELECT user_id AS a_user_id, COUNT(DISTINCT date) AS a_days
        FROM public.workout_logs
       WHERE date >= CURRENT_DATE - 6
         AND user_id IN (SELECT m_user_id FROM members)
       GROUP BY user_id
    ),
    ranked AS (
      SELECT
        id          AS lb_user_id,
        username    AS lb_username,
        avatar_url  AS lb_avatar_url,
        m_joined_at AS lb_joined_at,
        COALESCE(a_days, 0)::NUMERIC AS lb_value
      FROM public.user_profiles
      JOIN members ON m_user_id = id
      LEFT JOIN active ON a_user_id = id
    )
    SELECT lb_user_id, lb_username, lb_avatar_url, lb_value,
           RANK() OVER (ORDER BY lb_value DESC)::INT
      FROM ranked
     ORDER BY lb_value DESC, lb_joined_at ASC, lb_user_id ASC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.get_gym_consistency_leaderboard(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gym_consistency_leaderboard(UUID, INT) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- ── 151_signature_trophy.sql ──
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS signature_trophy TEXT DEFAULT NULL;


-- ─────────────────────────────────────────────────────────────────────
-- Final: nudge PostgREST to refresh its schema cache so the new
-- columns / RPCs are visible to the client immediately.
-- ─────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
