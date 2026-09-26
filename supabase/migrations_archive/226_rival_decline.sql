-- 226_rival_decline.sql
--
-- Decline a PENDING rival match (either party). Cancels it without rolling
-- a replacement and notifies the other player. Once both have accepted
-- (status='active') the match is locked — decline is a no-op. SECURITY
-- DEFINER so the rival (who only has SELECT on the row) can cancel too.
-- Paste-safe.

CREATE OR REPLACE FUNCTION public.gym_rival_decline(p_assignment_id UUID)
RETURNS SETOF public.gym_rival_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $gym_rival_decline$
DECLARE
  v_uid    UUID := auth.uid();
  v_owner  UUID;
  v_rival  UUID;
  v_status TEXT;
  v_other  UUID;
  v_name   TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT user_id, rival_id, status
    INTO v_owner, v_rival, v_status
    FROM public.gym_rival_assignments
   WHERE id = p_assignment_id
   FOR UPDATE;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'match_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_uid <> v_owner AND v_uid <> v_rival THEN
    RAISE EXCEPTION 'not_part_of_match' USING ERRCODE = '42501';
  END IF;

  -- Locked once live — you can only bail before both accept.
  IF v_status <> 'pending' THEN
    RETURN QUERY SELECT * FROM public.gym_rival_assignments WHERE id = p_assignment_id;
    RETURN;
  END IF;

  UPDATE public.gym_rival_assignments SET status = 'reassigned' WHERE id = p_assignment_id;

  -- Tell the other player.
  v_other := CASE WHEN v_uid = v_owner THEN v_rival ELSE v_owner END;
  SELECT username INTO v_name FROM public.user_profiles WHERE id = v_uid;
  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  SELECT v_other, email, 'nemesis_assigned',
    '@' || COALESCE(v_name, 'Your rival') || ' declined the challenge',
    'They backed out before the match started. Roll a new rival when you''re ready.',
    '🎯', '/workout',
    jsonb_build_object('assignment_id', p_assignment_id, 'result', 'declined')
  FROM auth.users WHERE id = v_other;

  RETURN QUERY SELECT * FROM public.gym_rival_assignments WHERE id = p_assignment_id;
END;
$gym_rival_decline$;

REVOKE ALL    ON FUNCTION public.gym_rival_decline(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gym_rival_decline(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
