-- 149_gym_checkins.sql
--
-- Gym Check-In streak/XP multiplier. A member scans the printable signage
-- QR (now a /checkin/<CODE> web link) — or types the gym's 8-char
-- flexyn_code — to check in. Checking in grants a 1.2x XP multiplier on
-- workouts logged that day (applied client-side at save via
-- has_gym_checkin_today). One check-in per (user, gym, UTC day).
--
-- Anti-abuse v1: check-in is gated by the gym's flexyn_code (printed on
-- the physical signage at the gym) and capped once/day/gym. The gym is
-- resolved SERVER-SIDE from the code so a client can't check into an
-- arbitrary gym_id. (Geofencing can layer on later.)
--
-- Alias-free + idempotent throughout.

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

-- ── Check in by the gym's printable code ────────────────────────────
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

-- ── Has the caller checked into ANY gym today? (drives the 1.2x XP) ──
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

NOTIFY pgrst, 'reload schema';
