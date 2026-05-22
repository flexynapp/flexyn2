-- 100_quiet_hours_timezone_fix.sql
--
-- HOTFIX: migration 098's is_in_quiet_hours() function references
-- a column named `timezone_offset` on user_profiles. The actual
-- column from migration 035 is `timezone_offset_minutes`. The
-- SECURITY DEFINER function fails with `42703 column ... does not
-- exist` at runtime; the push trigger's EXCEPTION WHEN OTHERS
-- handler then swallows it silently, so quiet hours NEVER apply
-- and every push goes out 24/7 regardless of the user's setting.
--
-- Root cause: I wrote the function before checking the existing
-- column name. Mig 035 introduced `timezone_offset_minutes` (named
-- explicitly to disambiguate from the column you'd expect in a
-- different system). My function expected the shorter name.
--
-- Fix: re-create the function pointing at the correct column.
-- CREATE OR REPLACE is safe — same signature.

CREATE OR REPLACE FUNCTION public.is_in_quiet_hours(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_start  INTEGER;
  v_end    INTEGER;
  v_offset INTEGER;
  v_local_hour INTEGER;
BEGIN
  -- timezone_offset_minutes is the correct column from mig 035.
  SELECT quiet_hours_start, quiet_hours_end, COALESCE(timezone_offset_minutes, 0)
    INTO v_start, v_end, v_offset
    FROM public.user_profiles WHERE id = p_user_id;
  IF v_start IS NULL OR v_end IS NULL THEN RETURN FALSE; END IF;

  -- Compute user-local hour 0-23.
  v_local_hour := EXTRACT(HOUR FROM (now() + (v_offset || ' minutes')::interval))::int;

  IF v_start = v_end THEN
    RETURN FALSE; -- empty window, never quiet
  ELSIF v_start < v_end THEN
    -- Simple non-wrapping window.
    RETURN v_local_hour >= v_start AND v_local_hour < v_end;
  ELSE
    -- Wraps midnight: hours after start OR hours before end.
    RETURN v_local_hour >= v_start OR v_local_hour < v_end;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.is_in_quiet_hours(UUID) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
