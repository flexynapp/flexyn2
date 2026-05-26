-- 149_live_activity_rail_email_column.sql
--
-- Adds `email` to the get_active_followees() RPC return so the
-- LiveActivityRail can navigate to the canonical /hub?profile=<email>
-- profile route. The original mig 088 RPC returned user_id but no
-- email, so the rail's tap handler navigated to a dead /hub/profile/<id>
-- route that 404s. (Audit 10 #2.)
--
-- Idempotent CREATE OR REPLACE.

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
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;

  RETURN QUERY
    SELECT p.id, p.username, p.avatar_url, p.active_until, p.email
      FROM public.hub_follows hf
      JOIN public.user_profiles p ON p.email = hf.followee_email
     WHERE hf.follower_email = v_email
       AND p.active_until > now()
     ORDER BY p.active_until DESC
     LIMIT 50;
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_followees() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_followees() TO authenticated;

NOTIFY pgrst, 'reload schema';
