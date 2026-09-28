-- The gym leaderboard is for members only, like every other gym board.
--
-- Migration 301 closed gym_members so only members can read a gym's roster,
-- and get_gym_consistency_leaderboard / get_gym_community_progress both
-- refuse non-members with 42501. get_gym_leaderboard (volume, XP, streak)
-- never got the gate: measured 2026-09-28 as a guest who belongs to no gym,
-- RLS on gym_members showed 0 rows for a gym while this function returned
-- its member with username, avatar and XP. Gym ids are on every map pin, so
-- any signed-in user could list who trains at any gym.
--
-- The app only shows this board inside a gym you belong to (GymHub renders
-- the tabs for members and the owner), so nobody legitimate loses anything.
-- The body is the installed one with the same gate the consistency board
-- uses added at the top.

CREATE OR REPLACE FUNCTION public.get_gym_leaderboard(p_gym_id uuid, p_mode text DEFAULT 'volume'::text, p_limit integer DEFAULT 50)
 RETURNS TABLE(user_id uuid, username text, avatar_url text, value numeric, rank integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_mode TEXT := COALESCE(p_mode, 'volume');
BEGIN
  IF NOT public.is_gym_member_or_owner(p_gym_id, auth.uid()) THEN
    RAISE EXCEPTION 'not a member' USING ERRCODE = '42501';
  END IF;
  IF v_mode NOT IN ('volume', 'xp', 'streak') THEN
    RAISE EXCEPTION 'invalid mode' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
    WITH membership AS (
      SELECT user_id AS member_user_id, joined_at AS member_joined_at
        FROM public.gym_members
       WHERE gym_id = p_gym_id
    ),
    ranked AS (
      SELECT
        id               AS lb_user_id,
        username         AS lb_username,
        avatar_url       AS lb_avatar_url,
        member_joined_at AS lb_joined_at,
        CASE v_mode
          WHEN 'volume' THEN COALESCE(total_volume_lbs, 0)::NUMERIC
          WHEN 'xp'     THEN COALESCE(total_xp,         0)::NUMERIC
          WHEN 'streak' THEN COALESCE(workout_streak,   0)::NUMERIC
        END AS lb_value
      FROM public.user_profiles
      JOIN membership ON member_user_id = id
    )
    SELECT lb_user_id, lb_username, lb_avatar_url, lb_value,
           RANK() OVER (ORDER BY lb_value DESC)::INT
      FROM ranked
     ORDER BY lb_value DESC, lb_joined_at ASC, lb_user_id ASC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$function$;

-- Probe, rolled back: a non-member is refused, a member still gets the board.
DO $probe$
DECLARE
  v_gym      uuid := gen_random_uuid();
  v_member   uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_n        integer;
BEGIN
  INSERT INTO auth.users (id, email, aud, role)
  VALUES (v_member,   'probe_m_' || v_member   || '@probe.invalid', 'authenticated', 'authenticated'),
         (v_stranger, 'probe_s_' || v_stranger || '@probe.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.user_profiles (id, email) VALUES
    (v_member,   'probe_m_' || v_member   || '@probe.invalid'),
    (v_stranger, 'probe_s_' || v_stranger || '@probe.invalid')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.gym_businesses (id, name, source, flexyn_code)
  VALUES (v_gym, 'Probe gym', 'community', 'PRB' || upper(left(md5(v_gym::text), 8)));
  INSERT INTO public.gym_members (gym_id, user_id, user_email)
  VALUES (v_gym, v_member, 'probe_m_' || v_member || '@probe.invalid');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL role authenticated';
  BEGIN
    PERFORM * FROM public.get_gym_leaderboard(v_gym, 'xp', 20);
    RAISE EXCEPTION 'probe: non-member read the gym leaderboard';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.get_gym_leaderboard(v_gym, 'xp', 20);
  IF v_n <> 1 THEN RAISE EXCEPTION 'probe: member got % rows, expected 1', v_n; END IF;

  EXECUTE 'RESET role';
  RAISE EXCEPTION 'probe_ok';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
END;
$probe$;
