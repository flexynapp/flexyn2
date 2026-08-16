-- 364_gym_rival_matchmaking.sql
--
-- Gym Rival matchmaking, modelled on Crew Wars (kegan, 2026-08-16:
-- "make sure Gym Rival has an algorithm that matchmakes them with similar
-- users like the Crew Wars was setup").
--
-- WHAT IT REPLACES
--
-- gym_rival_roll ordered candidates by `abs(total_xp - my_xp)` and nothing
-- else. Lifetime XP is an account-age proxy, not a measure of how you train:
-- it ranks a five-month-old account that logs twice a month above a
-- three-week-old account that trains four times a week, and then matches you
-- with the one you have least in common with. It is also blind to the CONTEST
-- — a Cardio Rival week is decided on distance, and XP proximity says nothing
-- about how far anyone runs.
--
-- THE CREW WARS SHAPE, PORTED TO ONE LIFTER
--
-- crew_match_gap is a weighted distance normalised to [0,1] whose important
-- property is that a dimension unknown to EITHER side is dropped from the
-- numerator and the denominator both — so a missing bodyweight neither
-- penalises nor flatters anyone. That matters here: only 27 of 56 production
-- profiles carry weight_lbs. gym_rival_match_gap keeps that structure and
-- swaps in the per-lifter dimensions:
--
--   3.0  weekly OUTPUT in the contest's own metric   (relative difference)
--   2.0  training cadence, days per week             (capped at 4)
--   1.5  level                                        (capped at 10)
--   2.0  bodyweight-relative strength   — both known only
--   1.0  age                            — both known only
--
-- Output carries the most weight because it is what the week is actually
-- scored on, and it is type-aware: volume for a Gym Rival, distance for a
-- Cardio Rival. Strength reuses crew_match_strength's basis — best e1RM over
-- 90 days divided by bodyweight — so a heavyweight is not ranked above a
-- pound-for-pound stronger lifter and then matched against them.
--
-- TWO THINGS THE OLD ROLL HAD NO NOTION OF
--
--   * A REMATCH COOLDOWN. Nothing stopped the roll handing you the same
--     person every week. Pass 1 excludes anyone you have been paired with in
--     the last 21 days; if that empties the pool, pass 2 drops the rule
--     rather than telling an active user there is nobody to play — with 26
--     users active in the last 7 days, a strict cooldown would frequently
--     find nothing.
--   * NEAR-TIE JITTER. Taking the strict minimum makes the roll
--     deterministic, so "Reroll" would hand back the same person forever.
--     Candidates within 0.02 of the incumbent take a coin flip, which keeps
--     reroll meaningful without ever accepting a materially worse match.
--
-- match_gap is stored on the assignment so the UI can say how close the
-- matchup is rather than asserting it. 0 = identical, 1 = maximally far
-- apart on every dimension that could be compared.

ALTER TABLE public.gym_rival_assignments
  ADD COLUMN IF NOT EXISTS match_gap NUMERIC;

COMMENT ON COLUMN public.gym_rival_assignments.match_gap IS
  'Matchmaking distance in [0,1] from gym_rival_match_gap at roll time. 0 = identical. NULL on rows predating migration 364.';

-- == Per-lifter matchmaking signals =========================================

CREATE OR REPLACE FUNCTION public.gym_rival_user_stats(p_uid UUID, p_type TEXT DEFAULT 'gym')
RETURNS TABLE (
  weekly_output NUMERIC,
  cadence       NUMERIC,
  strength      NUMERIC,
  lifter_age    NUMERIC,
  lifter_level  INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_out    NUMERIC := 0;
  v_cad    NUMERIC := 0;
  v_str    NUMERIC;
  v_age    NUMERIC;
  v_lvl    INTEGER;
  v_weight NUMERIC;
  v_best   NUMERIC;
BEGIN
  SELECT weight_lbs, age, current_level
    INTO v_weight, v_age, v_lvl
    FROM public.user_profiles WHERE id = p_uid;

  -- A four-week window, averaged to per-week. Long enough that one missed
  -- session does not redefine someone, short enough to track a real change
  -- in how they train.
  IF p_type = 'cardio' THEN
    SELECT COALESCE(SUM(distance_meters), 0) / 4.0,
           COUNT(DISTINCT date)::numeric / 4.0
      INTO v_out, v_cad
      FROM public.cardio_logs
     WHERE user_id = p_uid AND date >= (now() - interval '28 days')::date;
  ELSE
    SELECT COALESCE(SUM((s->>'weight')::numeric * (s->>'reps')::numeric), 0) / 4.0
      INTO v_out
      FROM public.workout_logs,
           jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
           jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
     WHERE user_id = p_uid AND created_at >= now() - interval '28 days'
       AND (s->>'weight') ~ '^[0-9]+(\.[0-9]+)?$'
       AND (s->>'reps')   ~ '^[0-9]+$';

    SELECT COUNT(DISTINCT created_at::date)::numeric / 4.0
      INTO v_cad
      FROM public.workout_logs
     WHERE user_id = p_uid AND created_at >= now() - interval '28 days';
  END IF;

  -- Bodyweight-relative strength, the same basis crew_match_strength uses.
  -- NULL when bodyweight is unknown or nothing has been logged in 90 days —
  -- and NULL is meaningful here, because the gap function drops the
  -- dimension rather than guessing a value for it.
  IF v_weight IS NOT NULL AND v_weight > 0 THEN
    SELECT MAX((public._best_1rm_from_exercises(exercises)->>'e1rm')::numeric)
      INTO v_best
      FROM public.workout_logs
     WHERE user_id = p_uid AND created_at > now() - interval '90 days';
    IF v_best IS NOT NULL THEN
      v_str := v_best / v_weight;
    END IF;
  END IF;

  RETURN QUERY SELECT COALESCE(v_out, 0), COALESCE(v_cad, 0), v_str, v_age, v_lvl;
END;
$$;

REVOKE ALL ON FUNCTION public.gym_rival_user_stats(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gym_rival_user_stats(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.gym_rival_user_stats(UUID, TEXT) FROM authenticated;

-- == The distance ===========================================================
-- Same structure as crew_match_gap: weighted terms over the sum of the
-- weights that actually applied, so an absent dimension costs nothing.

CREATE OR REPLACE FUNCTION public.gym_rival_match_gap(
  p_out_a NUMERIC, p_cad_a NUMERIC, p_str_a NUMERIC, p_age_a NUMERIC, p_lvl_a INTEGER,
  p_out_b NUMERIC, p_cad_b NUMERIC, p_str_b NUMERIC, p_age_b NUMERIC, p_lvl_b INTEGER)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (
      3.0 * (ABS(COALESCE(p_out_a, 0) - COALESCE(p_out_b, 0))
             / GREATEST(COALESCE(p_out_a, 0), COALESCE(p_out_b, 0), 1))
    + 2.0 * LEAST(1.0, ABS(COALESCE(p_cad_a, 0) - COALESCE(p_cad_b, 0)) / 4.0)
    + 1.5 * LEAST(1.0, ABS(COALESCE(p_lvl_a, 1) - COALESCE(p_lvl_b, 1))::numeric / 10.0)
    + CASE WHEN p_str_a IS NOT NULL AND p_str_b IS NOT NULL
           THEN 2.0 * (ABS(p_str_a - p_str_b) / GREATEST(p_str_a, p_str_b, 1))
           ELSE 0.0 END
    + CASE WHEN p_age_a IS NOT NULL AND p_age_b IS NOT NULL
           THEN 1.0 * LEAST(1.0, ABS(p_age_a - p_age_b) / 20.0)
           ELSE 0.0 END
  ) / (
      6.5
    + CASE WHEN p_str_a IS NOT NULL AND p_str_b IS NOT NULL THEN 2.0 ELSE 0.0 END
    + CASE WHEN p_age_a IS NOT NULL AND p_age_b IS NOT NULL THEN 1.0 ELSE 0.0 END
  );
$$;

-- == The roll ===============================================================

CREATE OR REPLACE FUNCTION public.gym_rival_roll(p_type TEXT DEFAULT 'gym')
RETURNS SETOF gym_rival_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_type  TEXT := CASE WHEN p_type = 'cardio' THEN 'cardio' ELSE 'gym' END;
  v_label TEXT := CASE WHEN p_type = 'cardio' THEN 'Cardio Rival' ELSE 'Gym Rival' END;
  v_out_a NUMERIC; v_cad_a NUMERIC; v_str_a NUMERIC; v_age_a NUMERIC; v_lvl_a INTEGER;
  v_out_b NUMERIC; v_cad_b NUMERIC; v_str_b NUMERIC; v_age_b NUMERIC; v_lvl_b INTEGER;
  v_pass     INTEGER;
  v_cand     UUID;
  v_gap      NUMERIC;
  v_best_gap NUMERIC;
  v_rival    UUID;
  v_new_id   UUID;
  v_name     TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  UPDATE public.gym_rival_assignments SET status = 'reassigned'
   WHERE status IN ('pending', 'active') AND (user_id = v_uid OR rival_id = v_uid);

  SELECT weekly_output, cadence, strength, lifter_age, lifter_level
    INTO v_out_a, v_cad_a, v_str_a, v_age_a, v_lvl_a
    FROM public.gym_rival_user_stats(v_uid, v_type);

  -- Pass 1 honours the 21-day rematch cooldown; pass 2 drops it rather than
  -- reporting "no rivals available" on a small active pool.
  FOR v_pass IN 1..2 LOOP
    EXIT WHEN v_rival IS NOT NULL;

    FOR v_cand IN
      SELECT id FROM public.user_profiles
       WHERE id <> v_uid
         AND COALESCE(nemesis_opt_out, FALSE) = FALSE
         AND username IS NOT NULL
         AND last_active_at IS NOT NULL
         AND last_active_at >= now() - interval '7 days'
         AND id NOT IN (
           SELECT user_id FROM public.gym_rival_assignments WHERE status IN ('pending', 'active')
           UNION
           SELECT rival_id FROM public.gym_rival_assignments WHERE status IN ('pending', 'active'))
         AND (v_pass = 2 OR id NOT IN (
           SELECT rival_id FROM public.gym_rival_assignments
            WHERE user_id = v_uid AND assigned_at >= now() - interval '21 days'
           UNION
           SELECT user_id FROM public.gym_rival_assignments
            WHERE rival_id = v_uid AND assigned_at >= now() - interval '21 days'))
       LIMIT 200
    LOOP
      SELECT weekly_output, cadence, strength, lifter_age, lifter_level
        INTO v_out_b, v_cad_b, v_str_b, v_age_b, v_lvl_b
        FROM public.gym_rival_user_stats(v_cand, v_type);

      v_gap := public.gym_rival_match_gap(
        v_out_a, v_cad_a, v_str_a, v_age_a, v_lvl_a,
        v_out_b, v_cad_b, v_str_b, v_age_b, v_lvl_b);

      -- Strictly better wins; a near-tie takes a coin flip so that Reroll
      -- can actually produce someone else.
      IF v_best_gap IS NULL
         OR v_gap < v_best_gap - 0.02
         OR (ABS(v_gap - v_best_gap) <= 0.02 AND random() < 0.5) THEN
        v_best_gap := v_gap;
        v_rival    := v_cand;
      END IF;
    END LOOP;
  END LOOP;

  IF v_rival IS NULL THEN RETURN; END IF;

  INSERT INTO public.gym_rival_assignments
    (user_id, rival_id, status, rival_type, initiator_confirmed, rival_confirmed, match_gap)
  VALUES (v_uid, v_rival, 'pending', v_type, FALSE, FALSE, v_best_gap)
  RETURNING id INTO v_new_id;

  SELECT username INTO v_name FROM public.user_profiles WHERE id = v_uid;
  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  SELECT v_rival, email, 'nemesis_assigned',
    '🎯 @' || COALESCE(v_name, 'someone') || ' wants to be your ' || v_label,
    'Confirm to start this week''s challenge — first one to go AFK forfeits.',
    '🎯', '/workout',
    jsonb_build_object('assignment_id', v_new_id, 'initiator_id', v_uid, 'rival_type', v_type)
  FROM auth.users WHERE id = v_rival;

  RETURN QUERY SELECT * FROM public.gym_rival_assignments WHERE id = v_new_id;
END;
$$;
