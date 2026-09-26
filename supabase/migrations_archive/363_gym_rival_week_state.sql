-- 363_gym_rival_week_state.sql
--
-- Gym Rival: give the client a server-side view of the match week, and stop
-- Cardio Rival matches from voiding on a metric they do not use.
--
-- WHY THIS EXISTS
--
-- 1. The rival's column was structurally always zero.
--    GymRivalMenu called getWeeklyRivalStats(me, rivalId), which reads
--    workout_logs and cardio_logs for the RIVAL from the browser. Both tables
--    carry exactly one policy -- owner-only, `auth.email() = created_by OR
--    auth.uid() = user_id` -- with no rival exception. So every cross-user read
--    returned an empty set and the UI rendered a confident "0" next to the
--    rival's name, then concluded "Dead even -- keep training."  Measured on
--    production 2026-08-16: 0 of 44 assignment rows have ever been confirmed,
--    accepted, settled or won, so nobody has ever seen a real number there.
--
--    gym_rival_net_rating() (mig 225) already solves this cross-user, but it
--    returns the SCALED score (volume / 100) and takes no assignment, so it
--    cannot answer "who logged since we accepted" or "when does this end".
--    This migration adds one call that returns everything the screen needs,
--    in RAW units so the client can format with the user's own weight and
--    distance preferences.
--
-- 2. Cardio Rival voided on lifting.
--    gym_rival_void_stale_all() and gym_rival_void_stale() both tested
--    workout_logs only. A cardio match logs to cardio_logs, so two runners who
--    ran every day were still voided at the 48h mark unless one of them
--    happened to lift. Both functions now branch on rival_type.
--
-- SAFETY
--   * gym_rival_week_state is SECURITY DEFINER and gated on the caller being
--     one of the two participants -- it reads another user's logs, so that
--     check is the whole boundary. It returns aggregates and two booleans,
--     never rows.
--   * It is read-only. The cron-only functions with side effects
--     (gym_rival_settle_week, gym_rival_void_stale_all) stay REVOKEd from
--     anon and authenticated, as they already were.
--
-- The week window matches gym_rival_settle_week() exactly --
-- date_trunc('week', accepted_at) to +7 days -- so what the screen counts is
-- what the settler scores. Nothing else anchors on the calendar week.

-- == The match week, computed server-side ===================================

CREATE OR REPLACE FUNCTION public.gym_rival_week_state(p_assignment_id UUID)
RETURNS TABLE (
  week_since    TIMESTAMPTZ,
  week_ends     TIMESTAMPTZ,
  you_volume    NUMERIC,
  them_volume   NUMERIC,
  you_distance  NUMERIC,
  them_distance NUMERIC,
  you_logged    BOOLEAN,
  them_logged   BOOLEAN,
  afk_deadline  TIMESTAMPTZ,
  is_stalled    BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_owner    UUID;
  v_rival    UUID;
  v_status   TEXT;
  v_type     TEXT;
  v_accepted TIMESTAMPTZ;
  v_assigned TIMESTAMPTZ;
  v_you      UUID;
  v_them     UUID;
  v_since    TIMESTAMPTZ;
  v_ends     TIMESTAMPTZ;
  v_deadline TIMESTAMPTZ;
  v_yv       NUMERIC := 0;
  v_tv       NUMERIC := 0;
  v_yd       NUMERIC := 0;
  v_td       NUMERIC := 0;
  v_yl       BOOLEAN := FALSE;
  v_tl       BOOLEAN := FALSE;
  v_stalled  BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT user_id, rival_id, status, rival_type, accepted_at, assigned_at
    INTO v_owner, v_rival, v_status, v_type, v_accepted, v_assigned
    FROM public.gym_rival_assignments
   WHERE id = p_assignment_id;

  IF v_owner IS NULL OR (v_uid <> v_owner AND v_uid <> v_rival) THEN
    RAISE EXCEPTION 'not_part_of_match' USING ERRCODE = '42501';
  END IF;

  -- Orient the result to the CALLER, so the client never has to work out
  -- which side of the row it is on before reading a number.
  IF v_uid = v_owner THEN
    v_you := v_owner; v_them := v_rival;
  ELSE
    v_you := v_rival; v_them := v_owner;
  END IF;

  -- A live match with no accepted_at can never be settled: both
  -- gym_rival_settle_week() and gym_rival_void_stale_all() require
  -- accepted_at IS NOT NULL. Production carries three such rows, 69 to 77
  -- days old, left behind by the pre-221 client-side assign path. They are
  -- not "in progress" and the UI must not draw them a countdown.
  v_stalled := (v_status = 'active' AND v_accepted IS NULL);

  v_since    := date_trunc('week', COALESCE(v_accepted, v_assigned, now()));
  v_ends     := v_since + interval '7 days';
  v_deadline := v_accepted + interval '48 hours';

  -- Volume, from the exercises JSONB. workout_logs.total_volume is not used:
  -- the settler derives from the JSONB, and both sides must agree. The regex
  -- guards are what stop a free-text weight ("bodyweight") aborting the sum;
  -- this is the same expression gym_rival_net_rating() uses.
  SELECT COALESCE(SUM((s->>'weight')::numeric * (s->>'reps')::numeric), 0)
    INTO v_yv
    FROM public.workout_logs,
         jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
         jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
   WHERE user_id = v_you AND created_at >= v_since
     AND (s->>'weight') ~ '^[0-9]+(\.[0-9]+)?$'
     AND (s->>'reps')   ~ '^[0-9]+$';

  SELECT COALESCE(SUM((s->>'weight')::numeric * (s->>'reps')::numeric), 0)
    INTO v_tv
    FROM public.workout_logs,
         jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
         jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
   WHERE user_id = v_them AND created_at >= v_since
     AND (s->>'weight') ~ '^[0-9]+(\.[0-9]+)?$'
     AND (s->>'reps')   ~ '^[0-9]+$';

  SELECT COALESCE(SUM(distance_meters), 0) INTO v_yd
    FROM public.cardio_logs
   WHERE user_id = v_you AND date >= v_since::date;

  SELECT COALESCE(SUM(distance_meters), 0) INTO v_td
    FROM public.cardio_logs
   WHERE user_id = v_them AND date >= v_since::date;

  -- The 48h AFK gate, on the metric the match is actually scored on.
  IF v_accepted IS NOT NULL THEN
    IF v_type = 'cardio' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.cardio_logs
         WHERE user_id = v_you AND date >= v_accepted::date
      ) INTO v_yl;
      SELECT EXISTS (
        SELECT 1 FROM public.cardio_logs
         WHERE user_id = v_them AND date >= v_accepted::date
      ) INTO v_tl;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.workout_logs
         WHERE user_id = v_you AND created_at >= v_accepted
      ) INTO v_yl;
      SELECT EXISTS (
        SELECT 1 FROM public.workout_logs
         WHERE user_id = v_them AND created_at >= v_accepted
      ) INTO v_tl;
    END IF;
  END IF;

  RETURN QUERY SELECT v_since, v_ends, v_yv, v_tv, v_yd, v_td,
                      v_yl, v_tl, v_deadline, v_stalled;
END;
$$;

REVOKE ALL ON FUNCTION public.gym_rival_week_state(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gym_rival_week_state(UUID) TO authenticated;

-- == AFK void: check the metric the match is scored on ======================

CREATE OR REPLACE FUNCTION public.gym_rival_void_stale(p_assignment_id UUID)
RETURNS SETOF gym_rival_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_owner    UUID;
  v_rival    UUID;
  v_status   TEXT;
  v_type     TEXT;
  v_accepted TIMESTAMPTZ;
  v_a_logged BOOLEAN;
  v_b_logged BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT user_id, rival_id, status, rival_type, accepted_at
    INTO v_owner, v_rival, v_status, v_type, v_accepted
    FROM public.gym_rival_assignments
   WHERE id = p_assignment_id;

  IF v_owner IS NULL OR (v_uid <> v_owner AND v_uid <> v_rival) THEN
    RAISE EXCEPTION 'not_part_of_match' USING ERRCODE = '42501';
  END IF;

  IF v_status <> 'active' OR v_accepted IS NULL
     OR now() < v_accepted + interval '48 hours' THEN
    RETURN QUERY SELECT * FROM public.gym_rival_assignments WHERE id = p_assignment_id;
    RETURN;
  END IF;

  IF v_type = 'cardio' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.cardio_logs WHERE user_id = v_owner AND date >= v_accepted::date
    ) INTO v_a_logged;
    SELECT EXISTS (
      SELECT 1 FROM public.cardio_logs WHERE user_id = v_rival AND date >= v_accepted::date
    ) INTO v_b_logged;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.workout_logs WHERE user_id = v_owner AND created_at >= v_accepted
    ) INTO v_a_logged;
    SELECT EXISTS (
      SELECT 1 FROM public.workout_logs WHERE user_id = v_rival AND created_at >= v_accepted
    ) INTO v_b_logged;
  END IF;

  IF NOT v_a_logged OR NOT v_b_logged THEN
    UPDATE public.gym_rival_assignments SET status = 'void' WHERE id = p_assignment_id;
  END IF;

  RETURN QUERY SELECT * FROM public.gym_rival_assignments WHERE id = p_assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.gym_rival_void_stale_all()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id       UUID;
  v_owner    UUID;
  v_rival    UUID;
  v_type     TEXT;
  v_accepted TIMESTAMPTZ;
  v_a        BOOLEAN;
  v_b        BOOLEAN;
  v_count    INT := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM public.gym_rival_assignments
     WHERE status = 'active'
       AND accepted_at IS NOT NULL
       AND now() >= accepted_at + interval '48 hours'
  LOOP
    SELECT user_id, rival_id, accepted_at, rival_type
      INTO v_owner, v_rival, v_accepted, v_type
      FROM public.gym_rival_assignments WHERE id = v_id;

    IF v_type = 'cardio' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.cardio_logs WHERE user_id = v_owner AND date >= v_accepted::date
      ) INTO v_a;
      SELECT EXISTS (
        SELECT 1 FROM public.cardio_logs WHERE user_id = v_rival AND date >= v_accepted::date
      ) INTO v_b;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.workout_logs WHERE user_id = v_owner AND created_at >= v_accepted
      ) INTO v_a;
      SELECT EXISTS (
        SELECT 1 FROM public.workout_logs WHERE user_id = v_rival AND created_at >= v_accepted
      ) INTO v_b;
    END IF;

    IF NOT v_a OR NOT v_b THEN
      UPDATE public.gym_rival_assignments SET status = 'void' WHERE id = v_id;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.gym_rival_void_stale_all() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gym_rival_void_stale_all() FROM anon;
REVOKE ALL ON FUNCTION public.gym_rival_void_stale_all() FROM authenticated;
