-- 225_rival_types.sql
--
-- Adds the Rival TYPE dimension: a match is a Gym Rival (competes on
-- workout VOLUME) or a Cardio Rival (competes on DISTANCE). Net rating is
-- now type-specific — one metric per match, not a blend.
--
-- (Table + functions keep their gym_rival_* names for now; a follow-up
-- migration renames the DB identifiers to rival_*.)

-- ── Type column ────────────────────────────────────────────────────────────
ALTER TABLE public.gym_rival_assignments
  ADD COLUMN IF NOT EXISTS rival_type TEXT NOT NULL DEFAULT 'gym';

-- ── Type-aware net rating ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.gym_rival_net_rating(UUID, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.gym_rival_net_rating(p_uid UUID, p_since TIMESTAMPTZ, p_type TEXT DEFAULT 'gym')
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $gym_rival_net_rating$
DECLARE
  v_volume   NUMERIC := 0;
  v_distance NUMERIC := 0;
BEGIN
  IF p_type = 'cardio' THEN
    SELECT COALESCE(SUM(distance_meters), 0) INTO v_distance
      FROM public.cardio_logs
     WHERE user_id = p_uid AND date >= p_since::date;
    RETURN round((v_distance / 1000) * 20);
  ELSE
    SELECT COALESCE(SUM((s->>'weight')::numeric * (s->>'reps')::numeric), 0)
      INTO v_volume
      FROM public.workout_logs,
           jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
           jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
     WHERE user_id = p_uid
       AND created_at >= p_since
       AND (s->>'weight') ~ '^[0-9]+(\.[0-9]+)?$'
       AND (s->>'reps')   ~ '^[0-9]+$';
    RETURN round(v_volume / 100);
  END IF;
END;
$gym_rival_net_rating$;

REVOKE ALL ON FUNCTION public.gym_rival_net_rating(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC;

-- ── Roll now takes a type ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.gym_rival_roll();

CREATE OR REPLACE FUNCTION public.gym_rival_roll(p_type TEXT DEFAULT 'gym')
RETURNS SETOF public.gym_rival_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $gym_rival_roll$
DECLARE
  v_uid    UUID := auth.uid();
  v_my_xp  BIGINT;
  v_rival  UUID;
  v_new_id UUID;
  v_name   TEXT;
  v_type   TEXT := CASE WHEN p_type = 'cardio' THEN 'cardio' ELSE 'gym' END;
  v_label  TEXT := CASE WHEN p_type = 'cardio' THEN 'Cardio Rival' ELSE 'Gym Rival' END;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.gym_rival_assignments
     SET status = 'reassigned'
   WHERE status IN ('pending', 'active')
     AND (user_id = v_uid OR rival_id = v_uid);

  SELECT total_xp INTO v_my_xp FROM public.user_profiles WHERE id = v_uid;

  SELECT id INTO v_rival
    FROM public.user_profiles
   WHERE id <> v_uid
     AND COALESCE(nemesis_opt_out, FALSE) = FALSE
     AND username IS NOT NULL
     AND last_active_at IS NOT NULL
     AND last_active_at >= now() - interval '7 days'
     AND id NOT IN (
       SELECT user_id  FROM public.gym_rival_assignments WHERE status IN ('pending', 'active')
       UNION
       SELECT rival_id FROM public.gym_rival_assignments WHERE status IN ('pending', 'active')
     )
   ORDER BY abs(COALESCE(total_xp, 0) - COALESCE(v_my_xp, 0)) ASC, random()
   LIMIT 1;

  IF v_rival IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.gym_rival_assignments
    (user_id, rival_id, status, rival_type, initiator_confirmed, rival_confirmed)
  VALUES (v_uid, v_rival, 'pending', v_type, FALSE, FALSE)
  RETURNING id INTO v_new_id;

  SELECT username INTO v_name FROM public.user_profiles WHERE id = v_uid;
  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  SELECT
    v_rival, email, 'nemesis_assigned',
    '🎯 @' || COALESCE(v_name, 'someone') || ' wants to be your ' || v_label,
    'Confirm to start this week''s challenge — first one to go AFK forfeits.',
    '🎯', '/workout',
    jsonb_build_object('assignment_id', v_new_id, 'initiator_id', v_uid, 'rival_type', v_type)
  FROM auth.users WHERE id = v_rival;

  RETURN QUERY SELECT * FROM public.gym_rival_assignments WHERE id = v_new_id;
END;
$gym_rival_roll$;

REVOKE ALL    ON FUNCTION public.gym_rival_roll(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gym_rival_roll(TEXT) TO authenticated;

-- ── Settlement scores by the match's type ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.gym_rival_settle_week()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $gym_rival_settle_week$
DECLARE
  v_id UUID; v_owner UUID; v_rival UUID; v_accepted TIMESTAMPTZ; v_since TIMESTAMPTZ; v_type TEXT;
  v_net_a INT; v_net_b INT; v_winner UUID; v_loser UUID;
  v_xp INT; v_coins INT; v_caps INT;
  v_wemail TEXT; v_wname TEXT; v_lname TEXT; v_settled INT := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM public.gym_rival_assignments
     WHERE status = 'active'
       AND accepted_at IS NOT NULL
       AND date_trunc('week', accepted_at) + interval '7 days' <= now()
  LOOP
    SELECT user_id, rival_id, accepted_at, rival_type
      INTO v_owner, v_rival, v_accepted, v_type
      FROM public.gym_rival_assignments WHERE id = v_id;

    v_since := date_trunc('week', v_accepted);
    v_net_a := public.gym_rival_net_rating(v_owner, v_since, v_type);
    v_net_b := public.gym_rival_net_rating(v_rival, v_since, v_type);

    IF v_net_a > v_net_b THEN
      v_winner := v_owner; v_loser := v_rival;
    ELSIF v_net_b > v_net_a THEN
      v_winner := v_rival; v_loser := v_owner;
    ELSE
      v_winner := NULL; v_loser := NULL;
    END IF;

    IF v_winner IS NOT NULL THEN
      v_xp := 5000; v_coins := 500; v_caps := 5;

      PERFORM public.increment_user_xp(v_winner, v_xp);
      UPDATE public.user_profiles SET flex_coins = COALESCE(flex_coins, 0) + v_coins WHERE id = v_winner;

      SELECT email INTO v_wemail FROM auth.users WHERE id = v_winner;
      INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
      SELECT v_winner, v_wemail, 'standard' FROM generate_series(1, v_caps);

      SELECT username INTO v_lname FROM public.user_profiles WHERE id = v_loser;
      INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
      SELECT v_winner, email, 'nemesis_overthrown',
        '🏆 You won your Rival week!',
        'You out-trained @' || COALESCE(v_lname, 'your rival') || '. +' || v_xp || ' XP, +' || v_coins || ' coins, ' || v_caps || ' capsules.',
        '🏆', '/workout',
        jsonb_build_object('assignment_id', v_id, 'result', 'win', 'xp', v_xp, 'coins', v_coins, 'capsules', v_caps)
      FROM auth.users WHERE id = v_winner;

      SELECT username INTO v_wname FROM public.user_profiles WHERE id = v_winner;
      INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
      SELECT v_loser, email, 'nemesis_overthrown',
        'Your Rival week ended',
        '@' || COALESCE(v_wname, 'your rival') || ' edged you out this week. Roll a new rival and get them next time.',
        '🎯', '/workout',
        jsonb_build_object('assignment_id', v_id, 'result', 'loss')
      FROM auth.users WHERE id = v_loser;
    ELSE
      SELECT email INTO v_wemail FROM auth.users WHERE id = v_owner;
      INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
      VALUES (v_owner, v_wemail, 'nemesis_overthrown',
        'Your Rival week ended in a draw',
        'Dead even — no winner this week. Roll a new rival.',
        '🤝', '/workout', jsonb_build_object('assignment_id', v_id, 'result', 'draw'));

      SELECT email INTO v_wemail FROM auth.users WHERE id = v_rival;
      INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
      VALUES (v_rival, v_wemail, 'nemesis_overthrown',
        'Your Rival week ended in a draw',
        'Dead even — no winner this week. Roll a new rival.',
        '🤝', '/workout', jsonb_build_object('assignment_id', v_id, 'result', 'draw'));
    END IF;

    UPDATE public.gym_rival_assignments
       SET status = 'completed', winner_id = v_winner, settled_at = now()
     WHERE id = v_id;
    v_settled := v_settled + 1;
  END LOOP;

  RETURN v_settled;
END;
$gym_rival_settle_week$;

REVOKE ALL ON FUNCTION public.gym_rival_settle_week() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
