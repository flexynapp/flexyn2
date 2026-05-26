-- 150_gym_approval_geo_optional.sql
--
-- Unblocks the admin gym-verification queue. Previously
-- approve_gym_verification raised "geo coords required before approval"
-- when the submitter left lat/lng blank — but the registration form
-- explicitly invited blank coords ("Or leave blank — we can geocode
-- from the address"), and there was no server-side geocoder. So those
-- submissions sat in pending forever. (Audit 12 #2.)
--
-- After:
--   1. gym_businesses.latitude / longitude become NULLABLE so a gym can
--      live in the database without coords until the owner sets them
--      via GymEdit. The map query (get_gyms_in_bbox) filters by
--      lat BETWEEN minLat AND maxLat; NULL coords naturally drop out
--      of the bbox so no map clutter from coord-less gyms.
--   2. approve_gym_verification no longer enforces the required check.
--      Gyms without coords get approved, the owner can join via code,
--      and the gym appears on the map once they enter coords via
--      GymEdit.

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

-- Rewrite approve_gym_verification to allow NULL geo. The rest of the
-- function body is unchanged from mig 135.
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
  -- Admin check via app_admins.is_admin (set by the team manually).
  -- TODO: move to is_app_admin() once that lands consistently.
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
  -- NOTE: the explicit "geo coords required" check from mig 135 is
  -- removed here intentionally. Coord-less gyms are allowed and simply
  -- won't appear on the discovery map until the owner sets coords via
  -- GymEdit. The owner can still share the join code and members can
  -- join via the code path.

  v_code := public.generate_flexyn_code();

  INSERT INTO public.gym_businesses (
    owner_id, verification_id, name, street_address, city, state_code,
    postal_code, country_code, latitude, longitude, flexyn_code,
    phone, website_url
  )
  VALUES (
    v_verif.owner_id, v_verif.id, v_verif.business_name,
    v_verif.street_address, v_verif.city, v_verif.state_code,
    v_verif.postal_code, v_verif.country_code,
    v_verif.latitude, v_verif.longitude, v_code,
    v_verif.phone, v_verif.website_url
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

NOTIFY pgrst, 'reload schema';
